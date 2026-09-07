"""Install a verified Node 22 runtime for WSL's configured MCP services."""
import hashlib
import os
from pathlib import Path
import platform
import re
import tarfile
import urllib.request


assert os.geteuid() == 0 and platform.machine() == 'x86_64'
base = 'https://nodejs.org/dist/latest-v22.x/'
manifest = urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=30).read().decode()
entries = re.findall(r'^([0-9a-f]{64})  (node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz)$', manifest, re.M)
assert len(entries) == 1
digest, filename = entries[0]
directory = filename.removesuffix('.tar.xz')
root = Path('/opt/hermes-node22')
assert root.resolve() == root
target = root / directory
links = {name: Path('/usr/local/bin') / name for name in ('node', 'npm', 'npx')}
for name, link in links.items():
    if link.exists() or link.is_symlink():
        assert link.is_symlink() and link.readlink() == target / 'bin' / name, f'{name} already configured'
if not (target / 'bin/node').is_file():
    archive = Path('/tmp') / filename
    with urllib.request.urlopen(base + filename, timeout=60) as response, archive.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == digest
    root.mkdir(mode=0o755, exist_ok=True)
    with tarfile.open(archive) as package:
        assert all(member.name.startswith(directory + '/') or member.name == directory for member in package)
        package.extractall(root, filter='data')
for name, link in links.items():
    if not link.is_symlink():
        link.symlink_to(target / 'bin' / name)
print({'runtime': str(target), 'sha256': digest})
