import { readEnvelope, sendSlackMessage, writeResult } from './_shared.js';

const envelope = await readEnvelope();
const payload = envelope.payload || {};

const title = payload.gate_type === 'run_completion'
  ? 'AgentXchain run completion awaiting approval'
  : 'AgentXchain phase gate awaiting approval';

const result = await sendSlackMessage(title, [
  `run: ${envelope.run_id || 'unknown'}`,
  `gate type: ${payload.gate_type || 'unknown'}`,
  `current phase: ${payload.current_phase || 'unknown'}`,
  `target phase: ${payload.target_phase || 'n/a'}`,
  `history length: ${payload.history_length ?? 0}`,
]);

writeResult(result);
