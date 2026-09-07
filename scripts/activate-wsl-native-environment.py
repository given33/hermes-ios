"""Activate a pre-copied Python environment on WSL's native filesystem."""
from __future__ import annotations

import fcntl
import importlib.util
import json
import os
from pathlib import Path
import pwd
import subprocess
import time


ROOT = Path('/mnt/d/Hermes/hermes-agent')
STATE = Path('/var/lib/hermes-agent-fabric-update/wsl')
CACHE = Path('/var/lib/hermes-python-wsl/03bce72fc8')
COMMIT = '03bce72fc8dfcc8bc7de280a7f32ab774921b0ea'


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True,
                          timeout=kwargs.pop('timeout', 120), **kwargs)


def replace_link(path, target):
    temporary = path.with_name(path.name + '.native-new')
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, path)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root so systemd user services can be restarted')
    spec = importlib.util.spec_from_file_location('runtime_update', ROOT / 'deploy/automation/sync-runtime-code.py')
    update = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(update)
    node = update.NODES['wsl']
    native = CACHE / '.venv'
    with (STATE / 'runtime-update.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receipt = json.loads((STATE / 'runtime-release.json').read_text())
        if not update.runtime_is_current(ROOT, receipt, COMMIT):
            raise RuntimeError('The installed code must match the verified release')
        if CACHE.resolve() != CACHE or native.is_symlink() or not (native / 'bin/python').is_file():
            raise RuntimeError('The prepared environment must be a real directory in the native cache')
        if update.has_active_execution(node['homes']):
            raise RuntimeError('A task is still active; retry when it has finished')
        links = [ROOT / 'venv', ROOT / '.fabric-generations' / COMMIT / '.venv']
        if not all(path.is_symlink() for path in links):
            raise RuntimeError('Only existing environment symlinks can be replaced')
        previous = {str(path): os.readlink(path) for path in links}
        before = update.protected_config_hashes(node['homes'])
        # Reinstall only the current source entry points, with no dependency download.
        run([str(native / 'bin/python'), '-m', 'pip', 'install', '--no-deps',
             '--no-build-isolation', '-e', str(ROOT)], timeout=180)
        if str(native / 'bin/python') not in (native / 'bin/hermes').read_text().splitlines()[0]:
            raise RuntimeError('The Hermes entry point still points to the old interpreter')
        dependency_hash = update.digest_file(ROOT / 'deploy/public/runtime-requirements.lock')
        (CACHE / '.dependencies-ready').write_text(dependency_hash)
        if not update.reusable_environment(native, ROOT / 'deploy/public/runtime-requirements.lock'):
            raise RuntimeError('The updater cannot reuse this environment')
        owner = pwd.getpwnam('hermes')
        control = ['runuser', '-u', 'hermes', '--', 'env', f'XDG_RUNTIME_DIR=/run/user/{owner.pw_uid}',
                   f'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{owner.pw_uid}/bus', 'systemctl', '--user']
        units = [unit + '.service' for unit in node['user_units']]
        rollback = CACHE / 'activation.json'
        rollback.write_text(json.dumps({'commit': COMMIT, 'previous_links': previous, 'status': 'prepared'}, indent=2))
        if update.has_active_execution(node['homes']):
            raise RuntimeError('A task arrived during preparation; activation deferred')
        try:
            run(control + ['stop', *units])
            for path in links:
                replace_link(path, native)
            run(control + ['start', *units])
            time.sleep(5)
            for unit in units:
                run(control + ['is-active', '--quiet', unit])
            if update.protected_config_hashes(node['homes']) != before:
                raise RuntimeError('Profile configuration changed during activation')
            if not update.runtime_is_current(ROOT, receipt, COMMIT):
                raise RuntimeError('Runtime code changed during activation')
        except Exception:
            run(control + ['stop', *units])
            for path in links:
                replace_link(path, previous[str(path)])
            run(control + ['start', *units])
            raise
        rollback.write_text(json.dumps({'commit': COMMIT, 'previous_links': previous,
                                       'status': 'active', 'environment': str(native)}, indent=2))
        print(json.dumps({'commit': COMMIT, 'environment': str(native),
                          'services_active': True, 'profile_configuration_unchanged': True}))


if __name__ == '__main__':
    main()
