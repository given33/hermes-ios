"""Synchronize every native Hermes font from pinned WebUI sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any

import brotli
import fontTools
from fontTools.ttLib import TTFont


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_MANIFEST = PROJECT_ROOT / "scripts" / "font-sources.json"
FONT_OUTPUT = PROJECT_ROOT / "assets" / "fonts"
PROVENANCE_FILE = FONT_OUTPUT / "PROVENANCE.json"
CATALOG_OUTPUT = PROJECT_ROOT / "src" / "design" / "native-font-faces.generated.ts"
ASSET_MAP_OUTPUT = PROJECT_ROOT / "src" / "app" / "native-font-assets.generated.ts"
APP_CONFIG = PROJECT_ROOT / "app.json"
PRESERVED_TABLES = ("cmap", "GSUB", "GPOS")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(url: str, user_agent: str) -> bytes:
    for attempt in range(1, 4):
        request = urllib.request.Request(url, headers={"User-Agent": user_agent})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except Exception as error:
            if attempt == 3:
                raise RuntimeError(
                    f"Failed to fetch {url} after {attempt} attempts"
                ) from error
            time.sleep(attempt)
    raise AssertionError("unreachable")


def read_name(font: TTFont, name_id: int) -> str | None:
    for record in font["name"].names:
        if record.nameID != name_id:
            continue
        try:
            value = record.toUnicode().strip()
        except UnicodeDecodeError:
            continue
        if value:
            return value
    return None


def name_metadata(font: TTFont) -> dict[str, str]:
    fields = {
        "copyright": 0,
        "family": 1,
        "subfamily": 2,
        "postscriptName": 6,
        "license": 13,
        "licenseUrl": 14,
    }
    return {
        field: value
        for field, name_id in fields.items()
        if (value := read_name(font, name_id)) is not None
    }


def font_details(font: TTFont) -> dict[str, Any]:
    outline_table = "glyf" if "glyf" in font else "CFF " if "CFF " in font else None
    if outline_table is None:
        raise RuntimeError("Font has no supported TrueType or CFF outline table")
    os2 = font["OS/2"]
    is_italic = bool(os2.fsSelection & 0x01)
    if "head" in font:
        is_italic = is_italic or bool(font["head"].macStyle & 0x02)
    metadata = name_metadata(font)
    for field in ("copyright", "family", "subfamily", "postscriptName"):
        if not metadata.get(field):
            raise RuntimeError(f"Font name table is missing {field}")
    return {
        "sfnt": "OTTO" if font.sfntVersion == "OTTO" else "TrueType",
        "outlineTable": outline_table.strip(),
        "outlineSha256": sha256_bytes(font.getTableData(outline_table)),
        "glyphCount": len(font.getGlyphOrder()),
        "actualWeight": int(os2.usWeightClass),
        "actualStyle": "italic" if is_italic else "normal",
        "nameMetadata": metadata,
    }


def inspect_font(path: Path) -> dict[str, Any]:
    font = TTFont(path, recalcBBoxes=False, recalcTimestamp=False)
    try:
        return font_details(font)
    finally:
        font.close()


def convert_woff2(source: Path, output: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    font = TTFont(source, recalcBBoxes=False, recalcTimestamp=False)
    source_tables = set(font.keys())
    source_glyph_order = font.getGlyphOrder()
    source_cmap = font.getBestCmap()
    source_details = font_details(font)
    outline_key = "CFF " if source_details["outlineTable"] == "CFF" else "glyf"
    compared_tables = [
        table for table in (*PRESERVED_TABLES, outline_key) if table in font
    ]
    source_table_data = {
        table: font.getTableData(table) for table in compared_tables
    }
    font.flavor = None
    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output)
    font.close()

    converted = TTFont(output, recalcBBoxes=False, recalcTimestamp=False)
    try:
        if set(converted.keys()) != source_tables:
            raise RuntimeError(f"Table set changed while converting {source.name}")
        if converted.getGlyphOrder() != source_glyph_order:
            raise RuntimeError(f"Glyph order changed while converting {source.name}")
        if converted.getBestCmap() != source_cmap:
            raise RuntimeError(f"Character map changed while converting {source.name}")
        for table, expected in source_table_data.items():
            if converted.getTableData(table) != expected:
                raise RuntimeError(f"{table} changed while converting {source.name}")
        output_details = font_details(converted)
    finally:
        converted.close()

    if source_details["nameMetadata"] != output_details["nameMetadata"]:
        raise RuntimeError(f"Name metadata changed while converting {source.name}")
    if source_details["outlineSha256"] != output_details["outlineSha256"]:
        raise RuntimeError(f"Outlines changed while converting {source.name}")
    return source_details, output_details


def parse_google_css(css: str) -> dict[tuple[str, int, str], str]:
    faces: dict[tuple[str, int, str], str] = {}
    for block in re.findall(r"@font-face\s*\{(.*?)\}", css, flags=re.DOTALL):
        family_match = re.search(r"font-family:\s*['\"]([^'\"]+)['\"]", block)
        style_match = re.search(r"font-style:\s*([^;]+);", block)
        weight_match = re.search(r"font-weight:\s*(\d+);", block)
        source_match = re.search(r"src:\s*url\(([^)]+)\)\s*format\(['\"]truetype['\"]\)", block)
        if not all((family_match, style_match, weight_match, source_match)):
            continue
        key = (
            family_match.group(1),
            int(weight_match.group(1)),
            style_match.group(1).strip(),
        )
        if key in faces:
            raise RuntimeError(f"Google CSS contains duplicate face {key}")
        faces[key] = source_match.group(1).strip("'\"")
    return faces


def family_token(family: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", family)


def generated_face(
    source: str,
    css_family: str,
    weight: int,
    style: str,
    runtime_family: str,
    output_file: str,
) -> dict[str, Any]:
    return {
        "source": source,
        "cssFamily": css_family,
        "weight": weight,
        "style": style,
        "runtimeFamily": runtime_family,
        "assetFile": output_file,
    }


def license_record(
    license_id: str,
    url: str,
    output_file: str,
    user_agent: str,
    expected_hash: str | None,
) -> dict[str, str]:
    data = fetch(url, user_agent)
    actual_hash = sha256_bytes(data)
    if expected_hash and actual_hash != expected_hash:
        raise RuntimeError(
            f"License hash changed for {url}: {actual_hash} != {expected_hash}"
        )
    destination = FONT_OUTPUT / output_file
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return {
        "id": license_id,
        "url": url,
        "file": output_file.replace("\\", "/"),
        "sha256": actual_hash,
    }


def ensure_commit(hermes_root: Path, expected: str) -> None:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=hermes_root,
        check=True,
        capture_output=True,
        text=True,
    )
    actual = result.stdout.strip()
    if actual != expected:
        raise RuntimeError(f"Hermes source commit is {actual}, expected {expected}")


def tracked_faces(
    sources: dict[str, Any],
    hermes_root: Path,
    terminal_license: dict[str, str],
) -> list[dict[str, Any]]:
    faces: list[dict[str, Any]] = []
    for source_kind, entries in (
        ("tracked-ui", sources["trackedWebUi"]),
        ("tracked-terminal", sources["trackedTerminal"]),
    ):
        for entry in entries:
            source_path = hermes_root / entry["sourceFile"]
            source_hash = sha256_file(source_path)
            if source_hash != entry["sourceSha256"]:
                raise RuntimeError(
                    f"Source hash mismatch for {source_path}: {source_hash}"
                )
            output_path = FONT_OUTPUT / entry["outputFile"]
            source_details, output_details = convert_woff2(source_path, output_path)
            output_hash = sha256_file(output_path)
            expected_output_hash = entry.get("outputSha256")
            if expected_output_hash and output_hash != expected_output_hash:
                raise RuntimeError(
                    f"Existing output changed for {entry['outputFile']}: {output_hash}"
                )
            license_data: dict[str, str]
            if source_kind == "tracked-terminal":
                license_data = terminal_license
                embedded_license = source_details["nameMetadata"].get("license", "")
                embedded_url = source_details["nameMetadata"].get("licenseUrl", "")
                if "Open Font License" not in embedded_license:
                    raise RuntimeError(f"{source_path.name} does not embed OFL metadata")
                if "openfontlicense.org" not in embedded_url:
                    raise RuntimeError(f"{source_path.name} has an unexpected license URL")
                if output_details["actualWeight"] != entry["metadataWeight"]:
                    raise RuntimeError(f"Weight mismatch for {source_path.name}")
                if output_details["actualStyle"] != entry["metadataStyle"]:
                    raise RuntimeError(f"Style mismatch for {source_path.name}")
                if (
                    output_details["nameMetadata"]["subfamily"]
                    != entry["metadataSubfamily"]
                ):
                    raise RuntimeError(f"Subfamily mismatch for {source_path.name}")
            else:
                license_data = {
                    "id": "Embedded-EULA",
                    "embedded": source_details["nameMetadata"].get(
                        "license",
                        "Rights retained in the source font copyright/name metadata",
                    ),
                }
            faces.append(
                {
                    "source": source_kind,
                    "cssFamily": entry["cssFamily"],
                    "weight": entry["weight"],
                    "style": entry["style"],
                    "runtimeFamily": entry["runtimeFamily"],
                    "sourceFile": f"hermes-agent/{entry['sourceFile']}",
                    "sourceSha256": source_hash,
                    "outputFile": entry["outputFile"],
                    "outputSha256": output_hash,
                    "sfnt": output_details["sfnt"],
                    "outlineTable": output_details["outlineTable"],
                    "sourceOutlineSha256": source_details["outlineSha256"],
                    "outputOutlineSha256": output_details["outlineSha256"],
                    "glyphCount": output_details["glyphCount"],
                    "actualWeight": output_details["actualWeight"],
                    "actualStyle": output_details["actualStyle"],
                    "nameMetadata": output_details["nameMetadata"],
                    "license": license_data,
                }
            )
    return faces


def google_faces(
    sources: dict[str, Any],
    previous: dict[str, Any] | None,
    refresh: bool,
) -> list[dict[str, Any]]:
    user_agent = sources["googleCssUserAgent"]
    prior_faces = {
        (face["cssFamily"], face["weight"], face["style"]): face
        for face in (previous or {}).get("faces", [])
        if face.get("source") == "google"
    }
    faces: list[dict[str, Any]] = []
    for family in sources["googleFamilies"]:
        css_faces: dict[tuple[str, int, str], str] = {}
        if refresh:
            css = fetch(family["cssUrl"], user_agent).decode("utf-8")
            css_faces = parse_google_css(css)

        family_prior = next(
            (
                face
                for key, face in prior_faces.items()
                if key[0] == family["family"]
            ),
            None,
        )
        license_url = sources["googleLicense"]["urlTemplate"].format(
            slug=family["slug"]
        )
        license_file = sources["googleLicense"]["outputTemplate"].format(
            slug=family["slug"]
        )
        expected_license_hash = None
        if not refresh and family_prior:
            expected_license_hash = family_prior["license"]["sha256"]
        family_license = license_record(
            sources["googleLicense"]["id"],
            license_url,
            license_file,
            user_agent,
            expected_license_hash,
        )
        metadata_url = sources["googleLicense"]["metadataUrlTemplate"].format(
            slug=family["slug"]
        )
        metadata_file = sources["googleLicense"]["metadataOutputTemplate"].format(
            slug=family["slug"]
        )
        metadata_data = fetch(metadata_url, user_agent)
        metadata_hash = sha256_bytes(metadata_data)
        if not refresh and family_prior:
            expected_metadata_hash = family_prior["license"]["metadataSha256"]
            if metadata_hash != expected_metadata_hash:
                raise RuntimeError(
                    f"Google metadata hash changed for {family['family']}: "
                    f"{metadata_hash} != {expected_metadata_hash}"
                )
        metadata_text = metadata_data.decode("utf-8")
        if not re.search(r'^license:\s*"OFL"\s*$', metadata_text, re.MULTILINE):
            raise RuntimeError(f"Google metadata is not OFL for {family['family']}")
        if not re.search(
            rf'^name:\s*"{re.escape(family["family"])}"\s*$',
            metadata_text,
            re.MULTILINE,
        ):
            raise RuntimeError(f"Google metadata family mismatch for {family['family']}")
        metadata_destination = FONT_OUTPUT / metadata_file
        metadata_destination.parent.mkdir(parents=True, exist_ok=True)
        metadata_destination.write_bytes(metadata_data)
        family_license.update(
            {
                "metadataUrl": metadata_url,
                "metadataFile": metadata_file,
                "metadataSha256": metadata_hash,
            }
        )

        for style in family["styles"]:
            for weight in family["weights"]:
                key = (family["family"], weight, style)
                prior = prior_faces.get(key)
                if refresh:
                    asset_url = css_faces.get(key)
                    if not asset_url:
                        raise RuntimeError(f"Google CSS is missing {key}")
                    expected_source_hash = None
                else:
                    if not prior:
                        raise RuntimeError(
                            f"No pinned Google face for {key}; use --refresh-google"
                        )
                    asset_url = prior["assetUrl"]
                    expected_source_hash = prior["sourceSha256"]

                data = fetch(asset_url, user_agent)
                source_hash = sha256_bytes(data)
                if expected_source_hash and source_hash != expected_source_hash:
                    raise RuntimeError(
                        f"Google source hash changed for {key}: {source_hash}"
                    )
                token = family_token(family["family"])
                style_token = style.title()
                output_file = f"Google-{token}-{weight}-{style_token}.ttf"
                output_path = FONT_OUTPUT / output_file
                output_path.write_bytes(data)
                details = inspect_font(output_path)
                if details["actualWeight"] != weight:
                    raise RuntimeError(
                        f"Google font weight mismatch for {key}: {details['actualWeight']}"
                    )
                if details["actualStyle"] != style:
                    raise RuntimeError(
                        f"Google font style mismatch for {key}: {details['actualStyle']}"
                    )
                runtime_family = (
                    f"HermesGoogle-{token}-{weight}-{style_token}"
                )
                faces.append(
                    {
                        "source": "google",
                        "cssFamily": family["family"],
                        "weight": weight,
                        "style": style,
                        "runtimeFamily": runtime_family,
                        "cssUrl": family["cssUrl"],
                        "assetUrl": asset_url,
                        "sourceSha256": source_hash,
                        "outputFile": output_file,
                        "outputSha256": source_hash,
                        "sfnt": details["sfnt"],
                        "outlineTable": details["outlineTable"],
                        "sourceOutlineSha256": details["outlineSha256"],
                        "outputOutlineSha256": details["outlineSha256"],
                        "glyphCount": details["glyphCount"],
                        "actualWeight": details["actualWeight"],
                        "actualStyle": details["actualStyle"],
                        "nameMetadata": details["nameMetadata"],
                        "license": family_license,
                    }
                )
    return faces


def write_generated_catalog(faces: list[dict[str, Any]]) -> None:
    catalog_faces = [
        generated_face(
            face["source"],
            face["cssFamily"],
            face["weight"],
            face["style"],
            face["runtimeFamily"],
            face["outputFile"],
        )
        for face in faces
    ]
    CATALOG_OUTPUT.write_text(
        "// Generated by scripts/sync-native-fonts.py. Do not edit.\n"
        f"export const GENERATED_NATIVE_FONT_FACES = {json.dumps(catalog_faces, ensure_ascii=True, indent=2)} as const;\n",
        encoding="utf-8",
    )


def write_generated_asset_map(faces: list[dict[str, Any]]) -> None:
    generated = [face for face in faces if face["source"] != "tracked-ui"]
    lines = [
        "// Generated by scripts/sync-native-fonts.py. Do not edit.",
        "export const GENERATED_NATIVE_FONT_ASSETS = {",
    ]
    for face in generated:
        runtime = json.dumps(face["runtimeFamily"])
        asset_path = json.dumps(f"../../assets/fonts/{face['outputFile']}")
        lines.append(f"  [{runtime}]: require({asset_path}),")
    lines.extend(["} as const;", ""])
    ASSET_MAP_OUTPUT.write_text("\n".join(lines), encoding="utf-8")


def update_app_config(faces: list[dict[str, Any]]) -> None:
    app_config = json.loads(APP_CONFIG.read_text(encoding="utf-8"))
    font_plugin = next(
        plugin
        for plugin in app_config["expo"]["plugins"]
        if isinstance(plugin, list) and plugin[0] == "expo-font"
    )
    font_plugin[1]["fonts"] = [
        f"./assets/fonts/{face['outputFile']}" for face in faces
    ]
    APP_CONFIG.write_text(
        json.dumps(app_config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def legacy_ui_provenance(faces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "sourceFile": face["sourceFile"],
            "sourceSha256": face["sourceSha256"],
            "outputFile": face["outputFile"],
            "outputSha256": face["outputSha256"],
            "sfnt": face["sfnt"],
            "outlineTable": face["outlineTable"],
            "glyphCount": face["glyphCount"],
            "nameMetadata": face["nameMetadata"],
        }
        for face in faces
        if face["source"] == "tracked-ui"
    ]


def clean_generated_assets(faces: list[dict[str, Any]]) -> None:
    expected = {face["outputFile"] for face in faces}
    for pattern in ("Google-*.ttf", "Terminal-*.ttf"):
        for path in FONT_OUTPUT.glob(pattern):
            if path.name not in expected:
                path.unlink()


def write_provenance(sources: dict[str, Any], faces: list[dict[str, Any]]) -> None:
    provenance = {
        "schemaVersion": 2,
        "canonicalCommit": sources["canonicalCommit"],
        "sourcePackage": "@nous-research/ui@0.18.2",
        "sourcePackageLicense": (
            "MIT (code/package metadata; fonts retain embedded EULAs)"
        ),
        "sourceCommit": "e2a9b5369",
        "conversion": (
            "Tracked WOFF2 decompression to sfnt with unchanged outlines; "
            "official Google TTF bytes copied unchanged"
        ),
        "command": (
            "python scripts/sync-native-fonts.py "
            "--hermes-root <hermes-agent>"
        ),
        "fontToolsVersion": fontTools.__version__,
        "brotliVersion": brotli.__version__,
        "googleCssUserAgent": sources["googleCssUserAgent"],
        "fonts": legacy_ui_provenance(faces),
        "faces": faces,
    }
    PROVENANCE_FILE.write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def verify_outputs() -> None:
    provenance = json.loads(PROVENANCE_FILE.read_text(encoding="utf-8"))
    faces = provenance.get("faces", [])
    if len(faces) != 50:
        raise RuntimeError(f"Expected 50 provenance faces, found {len(faces)}")
    for face in faces:
        output = FONT_OUTPUT / face["outputFile"]
        if sha256_file(output) != face["outputSha256"]:
            raise RuntimeError(f"Output hash mismatch for {output.name}")
        details = inspect_font(output)
        if details["outlineSha256"] != face["outputOutlineSha256"]:
            raise RuntimeError(f"Outline hash mismatch for {output.name}")
        if details["nameMetadata"] != face["nameMetadata"]:
            raise RuntimeError(f"Name metadata mismatch for {output.name}")
        if face["source"] == "google":
            if details["actualWeight"] != face["weight"]:
                raise RuntimeError(f"Weight mismatch for {output.name}")
            if details["actualStyle"] != face["style"]:
                raise RuntimeError(f"Style mismatch for {output.name}")
        elif face["source"] == "tracked-terminal":
            if details["actualWeight"] != face["actualWeight"]:
                raise RuntimeError(f"Embedded weight mismatch for {output.name}")
            if details["actualStyle"] != face["actualStyle"]:
                raise RuntimeError(f"Embedded style mismatch for {output.name}")
        license_file = face["license"].get("file")
        if license_file:
            license_path = FONT_OUTPUT / license_file
            if sha256_file(license_path) != face["license"]["sha256"]:
                raise RuntimeError(f"License hash mismatch for {license_path}")
        metadata_file = face["license"].get("metadataFile")
        if metadata_file:
            metadata_path = FONT_OUTPUT / metadata_file
            if sha256_file(metadata_path) != face["license"]["metadataSha256"]:
                raise RuntimeError(f"Metadata hash mismatch for {metadata_path}")
    print(f"Verified {len(faces)} native font faces")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-root", type=Path)
    parser.add_argument("--refresh-google", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    if args.verify_only:
        verify_outputs()
        return
    if args.hermes_root is None:
        parser.error("--hermes-root is required unless --verify-only is used")

    sources = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    ensure_commit(args.hermes_root, sources["canonicalCommit"])
    previous = None
    if PROVENANCE_FILE.is_file():
        previous = json.loads(PROVENANCE_FILE.read_text(encoding="utf-8"))
    if not args.refresh_google and not (previous or {}).get("faces"):
        raise RuntimeError("No Google pins exist; run once with --refresh-google")

    terminal_license_previous = next(
        (
            face["license"]
            for face in (previous or {}).get("faces", [])
            if face.get("source") == "tracked-terminal"
        ),
        None,
    )
    terminal_license = license_record(
        sources["terminalLicense"]["id"],
        sources["terminalLicense"]["url"],
        sources["terminalLicense"]["outputFile"],
        sources["googleCssUserAgent"],
        None if args.refresh_google or not terminal_license_previous else terminal_license_previous["sha256"],
    )
    faces = tracked_faces(sources, args.hermes_root, terminal_license)
    faces.extend(google_faces(sources, previous, args.refresh_google))
    source_order = {"tracked-ui": 0, "google": 1, "tracked-terminal": 2}
    faces.sort(key=lambda face: source_order[face["source"]])
    if len(faces) != 50:
        raise RuntimeError(f"Expected 50 faces, generated {len(faces)}")
    if len({face["runtimeFamily"] for face in faces}) != len(faces):
        raise RuntimeError("Runtime font families must be unique")
    if len({face["outputFile"] for face in faces}) != len(faces):
        raise RuntimeError("Font output filenames must be unique")

    clean_generated_assets(faces)
    write_generated_catalog(faces)
    write_generated_asset_map(faces)
    update_app_config(faces)
    write_provenance(sources, faces)
    verify_outputs()


if __name__ == "__main__":
    main()
