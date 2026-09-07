"""Sample a connector and its next worker without reading task or credential data."""
import json
from pathlib import Path
import subprocess
import sys
import time


connector = int(sys.argv[1])
sampler = sys.argv[2]
started = time.monotonic()
worker = None
observed = None
next_sample = 0
while time.monotonic() - started < 55:
    if worker is None:
        children = Path(f'/proc/{connector}/task/{connector}/children').read_text().split()
        for child in children:
            try:
                command = Path(f'/proc/{child}/cmdline').read_bytes().split(b'\0')
            except OSError:
                continue
            if b'--cli' in command and any(arg.startswith(b'work kanban task ') for arg in command):
                worker, observed = int(child), time.monotonic()
                print(json.dumps({'worker_pid': worker, 'observed_at': time.time()}), flush=True)
                break
    if time.monotonic() >= next_sample:
        target = worker or connector
        sample = subprocess.run([sampler, 'dump', '--pid', str(target)], capture_output=True,
                                text=True, timeout=5)
        print(json.dumps({'phase': 'worker' if worker else 'connector', 'at': time.time(),
                          'stack': sample.stdout}), flush=True)
        next_sample = time.monotonic() + 2
    if observed and time.monotonic() - observed >= 18:
        break
    time.sleep(0.2)
