"""Expose the host's existing OpenCode route to its PC worker profile.

Run on WSL as the Hermes service user. No credentials leave this machine and
the worker's default model, identity, memory and account data stay independent.
"""
from copy import deepcopy
import json
import os
from pathlib import Path
import time

from hermes_cli.config import (
    _cross_process_write_lock, _load_user_config_for_mutation, atomic_config_write,
)


root = Path('/mnt/d/Hermes/home')
source = _load_user_config_for_mutation(root / 'config.yaml')
entries = [item for item in source.get('custom_providers', [])
           if isinstance(item, dict) and item.get('name') == 'opencode.ai']
assert len(entries) == 1 and entries[0].get('base_url')
target = root / 'profiles/pc-worker/config.yaml'
assert target.is_file() and not target.is_symlink()
with _cross_process_write_lock(target):
    config = _load_user_config_for_mutation(target)
    before = deepcopy(config)
    providers = list(config.get('custom_providers') or [])
    if not any(item.get('name') == 'opencode.ai' for item in providers):
        backup = target.with_name('config.before-local-provider-' + str(time.time_ns()) + '.yaml')
        with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
            out.write(target.read_bytes())
        providers.append(deepcopy(entries[0]))
        config['custom_providers'] = providers
        atomic_config_write(target, config, sort_keys=False)
    current = _load_user_config_for_mutation(target)
    assert current.get('model') == before.get('model')
    assert {k: v for k, v in current.items() if k != 'custom_providers'} == {
        k: v for k, v in before.items() if k != 'custom_providers'}
print(json.dumps({'profile': 'pc-worker', 'provider': 'opencode.ai', 'default_model_unchanged': True}))
