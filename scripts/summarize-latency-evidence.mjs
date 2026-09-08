import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node summarize-latency-evidence.mjs INPUT OUTPUT');
const summaries = [];
for (const file of (await readdir(input)).filter(name => /^\d+-.*\.json$/.test(name)).sort()) {
  const { summary: s } = JSON.parse(await readFile(join(input, file), 'utf8'));
  summaries.push({ scenario: s.name, index: s.index, startedAt: s.startedAt,
    enqueueMs: s.enqueueMs, lifecycleRequestAcceptedMs: s.requestBoundaryMs,
    firstTokenMs: s.firstTokenMs, terminalMs: s.terminalMs, terminal: s.terminal,
    deliverySamples: (s.deliverySamples || []).map(({ type, stage, observedMs, sourceToClientMs }) =>
      ({ type, stage, observedMs, sourceToClientMs })),
  });
}
await writeFile(output, JSON.stringify({
  boundary: 'Client-observed lifecycle request.accepted; direct TUI acceptance is not the SDK wire boundary.',
  clocks: 'Delivery samples have not been corrected for cross-host clock offset.',
  summaries,
}, null, 2));
console.log(JSON.stringify({ file: output, scenarios: summaries.length }));
