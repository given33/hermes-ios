"""Convert the tracked Hermes WebUI WOFF2 fonts into native iOS sfnt files."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import brotli
import fontTools
from fontTools.ttLib import TTFont


SOURCE_HASHES = {
    "Collapse-Bold.woff2": "cb1bc6803168cffb3ef7b8113f95f82480a6d0f46d6e37edc854259377c6c00b",
    "Collapse-Regular.woff2": "ce8c481f56da3a46074ab696c16481bea49ea83e75e7eb7cb42fd2114593f33a",
    "Mondwest-Regular.woff2": "9cf6e6e1cba70f7e991a92ce4225785725b6cc9a48cc77cbfaabeba26c18f072",
    "RulesCompressed-Medium.woff2": "d865cf7154121265d3d65c0931ec27dc289aa438cd62ffad2f38e05ae79956a3",
    "RulesCompressed-Regular.woff2": "3bcbc330183f49cd49c72d4cdb3d1fbc675cf4e3000b06fd1c606ffc31b73e5f",
    "RulesExpanded-Bold.woff2": "f2295406de2272086d5395af32b50ac51b15d75294c25a04094c8b1f85757931",
    "RulesExpanded-Regular.woff2": "e8062ac4889b0f05de94035571e86991b6efd03539775cfe0790e37da75434db",
}

PRESERVED_TABLES = ("cmap", "GSUB", "GPOS")
STALE_OUTPUTS = ("Collapse-Bold.ttf", "Collapse-Regular.ttf")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def name_metadata(font: TTFont) -> dict[str, str]:
    names = font["name"]
    fields = {
        "copyright": 0,
        "family": 1,
        "subfamily": 2,
        "postscriptName": 6,
        "license": 13,
        "licenseUrl": 14,
    }
    metadata: dict[str, str] = {}
    for field, name_id in fields.items():
        records = names.names
        for record in records:
            if record.nameID != name_id:
                continue
            try:
                metadata[field] = record.toUnicode()
                break
            except UnicodeDecodeError:
                continue
    return metadata


def convert_font(source: Path, output_directory: Path) -> dict[str, Any]:
    expected_hash = SOURCE_HASHES[source.name]
    actual_hash = sha256(source)
    if actual_hash != expected_hash:
        raise RuntimeError(
            f"Source hash mismatch for {source.name}: {actual_hash} != {expected_hash}"
        )

    font = TTFont(source, recalcBBoxes=False, recalcTimestamp=False)
    outline_table = "glyf" if "glyf" in font else "CFF " if "CFF " in font else None
    if outline_table is None:
        raise RuntimeError(f"{source.name} has no supported outline table")
    output_extension = ".otf" if outline_table == "CFF " else ".ttf"
    output = output_directory / source.name.replace(".woff2", output_extension)

    source_tables = set(font.keys())
    source_glyph_order = font.getGlyphOrder()
    source_cmap = font.getBestCmap()
    tables_to_compare = [
        table
        for table in (*PRESERVED_TABLES, outline_table)
        if table in font
    ]
    source_table_data = {
        table: font.getTableData(table) for table in tables_to_compare
    }
    metadata = name_metadata(font)

    font.flavor = None
    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output)
    font.close()

    converted = TTFont(output, recalcBBoxes=False, recalcTimestamp=False)
    if set(converted.keys()) != source_tables:
        raise RuntimeError(f"Table set changed while converting {source.name}")
    if converted.getGlyphOrder() != source_glyph_order:
        raise RuntimeError(f"Glyph order changed while converting {source.name}")
    if converted.getBestCmap() != source_cmap:
        raise RuntimeError(f"Character map changed while converting {source.name}")
    if name_metadata(converted) != metadata:
        raise RuntimeError(f"Name metadata changed while converting {source.name}")
    for table, expected_data in source_table_data.items():
        if converted.getTableData(table) != expected_data:
            raise RuntimeError(f"{table} table changed while converting {source.name}")

    output_sfnt = "OTTO" if converted.sfntVersion == "OTTO" else "TrueType"
    glyph_count = len(converted.getGlyphOrder())
    converted.close()

    return {
        "sourceFile": f"hermes-agent/web/public/fonts/{source.name}",
        "sourceSha256": actual_hash,
        "outputFile": output.name,
        "outputSha256": sha256(output),
        "sfnt": output_sfnt,
        "outlineTable": outline_table.strip(),
        "glyphCount": glyph_count,
        "nameMetadata": metadata,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="Path to hermes-agent/web/public/fonts",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets" / "fonts",
    )
    args = parser.parse_args()

    for stale_name in STALE_OUTPUTS:
        stale_output = args.output / stale_name
        if stale_output.is_file():
            stale_output.unlink()

    converted_fonts = []
    for source_name in SOURCE_HASHES:
        source = args.source / source_name
        converted_fonts.append(convert_font(source, args.output))

    provenance = {
        "sourcePackage": "@nous-research/ui@0.18.2",
        "sourcePackageLicense": (
            "MIT (code/package metadata; fonts retain embedded EULAs)"
        ),
        "sourceCommit": "e2a9b5369",
        "conversion": "WOFF2 decompression to sfnt; glyph outlines are unchanged",
        "command": (
            "py -3.14 scripts/convert-webui-fonts.py "
            "--source <hermes-agent>/web/public/fonts"
        ),
        "fontToolsVersion": fontTools.__version__,
        "brotliVersion": brotli.__version__,
        "fonts": converted_fonts,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "PROVENANCE.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
