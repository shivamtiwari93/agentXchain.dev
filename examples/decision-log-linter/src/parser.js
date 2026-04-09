const DECISION_HEADING = /^##\s+(DEC-[A-Za-z0-9_-]+)\s*[-:]\s*(.+)$/;

export function parseDecisionLog(source) {
  const lines = String(source).split(/\r?\n/);
  const decisions = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(DECISION_HEADING);
    if (headingMatch) {
      if (current) {
        current.body = current.bodyLines.join('\n').trim();
        delete current.bodyLines;
        decisions.push(current);
      }

      current = {
        id: headingMatch[1],
        title: headingMatch[2].trim(),
        bodyLines: [],
      };
      continue;
    }

    if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) {
    current.body = current.bodyLines.join('\n').trim();
    delete current.bodyLines;
    decisions.push(current);
  }

  return decisions;
}

export function extractStatus(body) {
  const match = String(body).match(/^Status\s*:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}
