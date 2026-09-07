import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

pid = sys.argv[1]
env = dict(part.split('=', 1) for part in Path(f'/proc/{pid}/environ').read_text().split('\0') if '=' in part)
safe = {key: value for key, value in env.items() if key in (
    'HERMES_HOME', 'HERMES_CONNECTOR_ID', 'DBB3_CONNECTOR_ID', 'HERMES_WORKER_NODE_ID',
    'HERMES_CONNECTOR_STATE_FILE', 'DBB3_CONNECTOR_STATE_FILE', 'HERMES_CONNECTOR_DRAIN_FILE',
)}
for key, value in env.items():
    if ('URL' in key or 'PROXY' in key.upper()) and value.startswith(('http:', 'https:')):
        parsed = urlsplit(value)
        safe[key] = f'{parsed.scheme}://{parsed.hostname}:{parsed.port or ""}{parsed.path}'
print(json.dumps(safe))
home = Path(env.get('HERMES_HOME') or '/home/hermes/.hermes')
marker = home / '.drain_request.json'
print(json.dumps({'drain': json.loads(marker.read_text()) if marker.is_file() else None}))
state = json.loads(Path(env.get('DBB3_CONNECTOR_STATE_FILE') or '/home/hermes/.local/state/dbb3-cloud-connector/checkpoint.json').read_text())
print(json.dumps({'runs': len(state.get('runs', {})), 'active': [
    {key: item.get(key) for key in ('remote_run_id', 'profile', 'execution_profile', 'status', 'root_task_id', 'acked')}
    for item in state.get('runs', {}).values() if item.get('status') not in ('completed', 'failed', 'cancelled')
]}))
