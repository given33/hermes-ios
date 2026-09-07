import json
import sys
from pathlib import Path
import yaml

root = Path('/var/lib/hermes-agent/collaboration')
state = json.loads((root / 'single.json').read_text())
for item in state.get('conversations', []):
    for turn_id, turn in (item.get('hosted_turns') or {}).items():
        if turn_id != (sys.argv[1] if len(sys.argv) > 1 else 'hosted-mtrbdsi1-a203a097-f58b-4325-91f7-b2f6af4c624e'):
            continue
        print(json.dumps({'probe_turn': turn_id, 'status': turn.get('status'), 'stage': turn.get('stage'),
                          'result': str(turn.get('result') or '')[:500],
                          'remote': [{key: value.get(key) for key in ('id', 'profile', 'connector_id', 'created_at', 'started_at', 'lease_until', 'status', 'execution_state', 'checkpoint_cursor', 'execution_progress_at', 'summary', 'error')} for value in (turn.get('remote_runs') or {}).values()]}))
for item in sorted(state.get('conversations', []), key=lambda value: len(json.dumps(value)), reverse=True)[:8]:
    sizes = {key: len(json.dumps(value)) for key, value in item.items()}
    print(json.dumps({'id': item['id'], 'archived': item.get('archived'), 'restored': item.get('restored_from_archive_at'), 'bytes': sum(sizes.values()), 'largest': sorted(sizes.items(), key=lambda value: value[1], reverse=True)[:5], 'turns': [{key: turn.get(key) for key in ('id', 'status', 'stage', 'updated_at', 'cancel_requested')} for turn in (item.get('hosted_turns') or {}).values()]}))
print(json.dumps({'records': len(state.get('conversations', [])), 'bytes': (root / 'single.json').stat().st_size}))
for home in [root.parent, root.parent / 'profiles/acct-674fd4cfd17720f1ee3d-37a8eec1ce19']:
    config = yaml.safe_load((home / 'config.yaml').read_text()) or {}
    model = config.get('model') or {}
    print(json.dumps({'profile': home.name, 'model': {key: model.get(key) for key in ('default', 'provider')} if isinstance(model, dict) else model,
                      'reasoning_effort': (config.get('agent') or {}).get('reasoning_effort')}))
