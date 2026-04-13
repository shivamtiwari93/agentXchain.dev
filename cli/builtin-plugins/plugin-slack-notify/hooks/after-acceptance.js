import { readEnvelope, sendSlackMessage, writeResult } from './_shared.js';

const envelope = await readEnvelope();
const payload = envelope.payload || {};

const result = await sendSlackMessage('AgentXchain accepted turn', [
  `run: ${envelope.run_id || 'unknown'}`,
  `phase: ${payload.phase || 'unknown'}`,
  `role: ${payload.role_id || 'unknown'}`,
  `turn: ${payload.turn_id || 'unknown'}`,
  `decisions: ${payload.decisions_count ?? 0}`,
  `objections: ${payload.objections_count ?? 0}`,
  `status: ${payload.run_status || 'unknown'}`,
]);

writeResult(result);
