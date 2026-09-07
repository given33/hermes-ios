"""Repack a downloaded GitHub release, preserving exactly its runtime files."""
import hashlib
import io
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

source, target = map(Path, sys.argv[1:3])
spec = importlib.util.spec_from_file_location('updater', '/opt/hermes-agent/deploy/automation/sync-runtime-code.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
expected = {}
with tarfile.open(source) as original, tarfile.open(target, 'w:gz') as output:
    for member in original:
        name = '/'.join(PurePosixPath(member.name).parts[1:])
        if not updater.code_member(name) or not member.isfile():
            continue
        with original.extractfile(member) as content:
            data = content.read()
        expected[name] = hashlib.sha256(data).hexdigest()
        output.addfile(member, io.BytesIO(data))
with tarfile.open(target) as packed:
    actual = {'/'.join(PurePosixPath(item.name).parts[1:]): hashlib.sha256(packed.extractfile(item).read()).hexdigest() for item in packed}
assert actual == expected
print(json.dumps({'files': len(actual), 'bytes': target.stat().st_size, 'manifest_sha256': hashlib.sha256(json.dumps(actual, sort_keys=True).encode()).hexdigest()}))
