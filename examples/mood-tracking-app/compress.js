const fs = require('fs');
const path = 'moodTracking-poc.md';
let content = fs.readFileSync(path, 'utf8');

const turn12Index = content.indexOf('### [Agent 4] (QA SDET Engineer - UI/UX & Compression) | Turn 12');
const compressedContextStart = content.indexOf('## COMPRESSED CONTEXT');
const messageLogStart = content.indexOf('## MESSAGE LOG');

if (turn12Index > -1 && compressedContextStart > -1) {
  const header = content.substring(0, compressedContextStart);
  
  const newCompressedContext = `## COMPRESSED CONTEXT

**Project one-liner:** Mood tracking app — log mood, view history, simple insights.

**Phase:** Build (see \`state.json\`).

**Team:** Agent 1 = PM; Agent 2 = Fullstack Dev; Agent 3 = QA SDET; Agent 4 = QA SDET (UI/UX + compression).

**Summary of Turns 1-11:**
- **MVP Scope Established:** Users can log mood (one-tap) with optional note/tags. History view shows entries and supports date-range and tag filtering. Simple insights show most common mood and week-over-week trends.
- **Implementation:** Backend uses Node/Express + SQLite (\`data/mood.db\`). Frontend is a minimal, responsive, no-framework HTML/JS app (\`public/index.html\`).
- **Testing:** Test suite (\`test/run.js\`) covers health, GET/POST mood, insights, tag filters, and date-range filters.
- **Accessibility (A11y):** Mood buttons use \`aria-pressed\`. Focus styles (\`:focus-visible\`) are implemented for mood buttons, submit, and the filter Apply button.
- **Documentation:** README includes a run/deploy section.

**Current Open Risks (from earlier turns):**
- Deployment/Runbook is documented, but the app is not yet fully "production-ready" in terms of environment isolation.

---

## MESSAGE LOG

*(Append new messages below. Each message: \`[Agent N] (role) | Turn T\`, then Introduction/Status, Decision, Action, Handoff.)*

---

`;

  const remainingMessages = content.substring(turn12Index);
  
  fs.writeFileSync(path, header + newCompressedContext + remainingMessages);
  console.log('Compression successful');
} else {
  console.log('Could not find markers for compression');
}
