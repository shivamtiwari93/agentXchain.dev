import { readEnvelope, writeReport } from './_shared.js';

const envelope = await readEnvelope();
writeReport('@agentxchain/plugin-json-report', envelope);
