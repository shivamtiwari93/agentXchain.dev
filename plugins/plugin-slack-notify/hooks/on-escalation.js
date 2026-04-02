import { readEnvelope, sendSlackMessage, writeResult } from './_shared.js';

const envelope = await readEnvelope();
const payload = envelope.payload || {};

const result = await sendSlackMessage('AgentXchain escalation', [
  `run: ${envelope.run_id || 'unknown'}`,
  `blocked reason: ${payload.blocked_reason || 'unknown'}`,
  `recovery: ${payload.recovery_action || 'unknown'}`,
  `role: ${payload.failed_role || 'unknown'}`,
  `turn: ${payload.failed_turn_id || 'unknown'}`,
  `error: ${payload.last_error || 'unknown'}`,
]);

writeResult(result);
