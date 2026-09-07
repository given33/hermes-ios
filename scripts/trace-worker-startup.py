"""Sample only a newly dispatched Hermes worker, without reading its environment."""
import json
import subprocess
import sys
import time
from pathlib import Path

connector = int(sys.argv[1])
sampler = sys.argv[2]
seen = set()
deadline = time.monotonic() + 55
while time.monotonic() < deadline:
    output = subprocess.run(["ps", "-o", "pid=,args=", "--ppid", str(connector)], capture_output=True, text=True).stdout
    for line in output.splitlines():
        if "--cli" not in line or "work kanban task" not in line:
            continue
        pid = int(line.strip().split(None, 1)[0])
        if pid in seen:
            continue
        seen.add(pid)
        print(json.dumps({"worker_pid": pid, "observed_at": time.time()}), flush=True)
        for index in range(8):
            sample = subprocess.run([sampler, "dump", "--pid", str(pid)], capture_output=True, text=True)
            print(json.dumps({"sample": index, "at": time.time(), "stack": sample.stdout}), flush=True)
            time.sleep(2)
        raise SystemExit(0)
    time.sleep(0.25)
raise SystemExit("No new worker observed")
