"""Pin WSL's filesystem MCP executable so worker startup never invokes npx."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import time

from hermes_cli.config import (
    _cross_process_write_lock, _load_user_config_for_mutation, atomic_config_write,
)


assert os.geteuid() == 0
version = '2026.8.31'
runtime = Path('/opt/hermes-mcp') / ('filesystem-' + version)
package = runtime / 'node_modules/@modelcontextprotocol/server-filesystem'
if not (package / 'dist/index.js').is_file():
    runtime.mkdir(parents=True, mode=0o755, exist_ok=True)
    subprocess.run(['/usr/local/bin/npm', 'install', '--prefix', str(runtime),
                    '--userconfig', '/dev/null', '--globalconfig', '/dev/null',
                    '--ignore-scripts', '--no-audit', '--no-fund',
                    '--registry=https://registry.npmjs.org',
                    '@modelcontextprotocol/server-filesystem@' + version], check=True, timeout=180)
assert json.loads((package / 'package.json').read_text())['version'] == version
target = Path('/mnt/d/Hermes/home/profiles/pc-worker/config.yaml')
with _cross_process_write_lock(target):
    config = _load_user_config_for_mutation(target)
    original = deepcopy(config)
    server = config['mcp_servers']['filesystem']
    # Preserve the exact directory allowlist from this host's existing config.
    args = [value for value in server.get('args', []) if value != '--args']
    if server.get('command') == 'npx':
        index = args.index('@modelcontextprotocol/server-filesystem')
        allowed = args[index + 1:]
        assert allowed and all(Path(value).is_absolute() for value in allowed)
        backup = target.with_name('config.before-pinned-mcp-' + str(time.time_ns()) + '.yaml')
        stat = target.stat()
        with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
            out.write(target.read_bytes())
        os.chown(backup, stat.st_uid, stat.st_gid)
        server.update(command='/usr/local/bin/node', args=[str(package / 'dist/index.js'), *allowed])
        atomic_config_write(target, config, sort_keys=False)
        os.chown(target, stat.st_uid, stat.st_gid)
    assert config['model'] == original['model']
    assert server['command'] == '/usr/local/bin/node'
print(json.dumps({'profile': 'pc-worker', 'filesystem_version': version, 'startup_download': False}))
