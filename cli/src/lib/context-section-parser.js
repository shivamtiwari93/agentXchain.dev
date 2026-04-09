const CONTEXT_TITLE = '# Execution Context';

const SECTION_DEFINITIONS = [
  { id: 'current_state', header: 'Current State', required: true },
  { id: 'budget', header: null, required: false },
  { id: 'last_turn_header', header: 'Last Accepted Turn', required: true },
  { id: 'last_turn_summary', header: null, required: false },
  { id: 'last_turn_decisions', header: null, required: false },
  { id: 'last_turn_objections', header: null, required: false },
  { id: 'last_turn_verification', header: null, required: false },
  { id: 'blockers', header: 'Blockers', required: true },
  { id: 'escalation', header: 'Escalation', required: true },
  { id: 'workflow_artifacts', header: 'Workflow Artifacts', required: false },
  { id: 'gate_required_files', header: 'Gate Required Files', required: false },
  { id: 'phase_gate_status', header: 'Phase Gate Status', required: false },
];

const REQUIRED_BY_ID = new Map(SECTION_DEFINITIONS.map((section) => [section.id, section.required]));
const HEADER_TO_ID = new Map(
  SECTION_DEFINITIONS
    .filter((section) => section.header)
    .map((section) => [section.header, section.id])
);

const BUDGET_LINE_PATTERN = /^- \*\*Budget (spent|remaining):\*\*/;
const SUMMARY_LINE_PATTERN = /^- \*\*Summary:\*\*/;
const DECISIONS_LINE_PATTERN = /^- \*\*Decisions:\*\*/;
const OBJECTIONS_LINE_PATTERN = /^- \*\*Objections:\*\*/;

export { CONTEXT_TITLE, SECTION_DEFINITIONS };

export function parseContextSections(contextMd) {
  const normalized = normalizeNewlines(contextMd);
  const topLevelSections = splitTopLevelSections(normalized);
  const parsedSections = [];

  const currentStateBody = topLevelSections.get('Current State');
  if (currentStateBody) {
    const budgetLines = currentStateBody.filter((line) => BUDGET_LINE_PATTERN.test(line));
    const stickyLines = currentStateBody.filter((line) => !BUDGET_LINE_PATTERN.test(line));

    pushSection(parsedSections, 'current_state', stickyLines);
    pushSection(parsedSections, 'budget', budgetLines);
  }

  const lastAcceptedTurnBody = topLevelSections.get('Last Accepted Turn');
  if (lastAcceptedTurnBody) {
    const {
      headerLines,
      summaryLines,
      decisionsLines,
      objectionsLines,
      verificationLines,
    } = splitLastAcceptedTurn(lastAcceptedTurnBody);

    pushSection(parsedSections, 'last_turn_header', headerLines);
    pushSection(parsedSections, 'last_turn_summary', summaryLines);
    pushSection(parsedSections, 'last_turn_decisions', decisionsLines);
    pushSection(parsedSections, 'last_turn_objections', objectionsLines);
    pushSection(parsedSections, 'last_turn_verification', verificationLines);
  }

  for (const [header, id] of HEADER_TO_ID.entries()) {
    if (header === 'Current State' || header === 'Last Accepted Turn') continue;
    pushSection(parsedSections, id, topLevelSections.get(header));
  }

  return SECTION_DEFINITIONS
    .map((definition) => parsedSections.find((section) => section.id === definition.id))
    .filter(Boolean);
}

export function renderContextSections(sections) {
  const sectionMap = new Map((sections || []).map((section) => [section.id, section]));
  const lines = [CONTEXT_TITLE, ''];

  appendTopLevelSection(lines, 'Current State', [
    sectionMap.get('current_state')?.content,
    sectionMap.get('budget')?.content,
  ]);

  appendTopLevelSection(lines, 'Last Accepted Turn', [
    sectionMap.get('last_turn_header')?.content,
    sectionMap.get('last_turn_summary')?.content,
    sectionMap.get('last_turn_decisions')?.content,
    sectionMap.get('last_turn_objections')?.content,
    sectionMap.get('last_turn_verification')?.content,
  ]);

  appendTopLevelSection(lines, 'Blockers', [sectionMap.get('blockers')?.content]);
  appendTopLevelSection(lines, 'Escalation', [sectionMap.get('escalation')?.content]);
  appendTopLevelSection(lines, 'Workflow Artifacts', [sectionMap.get('workflow_artifacts')?.content]);
  appendTopLevelSection(lines, 'Gate Required Files', [sectionMap.get('gate_required_files')?.content]);
  appendTopLevelSection(lines, 'Phase Gate Status', [sectionMap.get('phase_gate_status')?.content]);

  return `${lines.join('\n')}\n`;
}

function appendTopLevelSection(lines, header, fragments) {
  const validFragments = fragments
    .filter((fragment) => typeof fragment === 'string' && fragment.length > 0);

  if (validFragments.length === 0) return;

  // Join fragments with a blank-line separator before sub-headings (###)
  const contentParts = [];
  for (const fragment of validFragments) {
    if (contentParts.length > 0 && fragment.startsWith('###')) {
      contentParts.push('');
    }
    contentParts.push(fragment);
  }
  const content = contentParts.join('\n');

  lines.push(`## ${header}`);
  lines.push('');
  lines.push(...content.split('\n'));
  lines.push('');
}

function splitTopLevelSections(contextMd) {
  const lines = normalizeNewlines(contextMd).split('\n');
  const sectionStarts = [];
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inCodeBlock && lines[index].startsWith('## ')) {
      sectionStarts.push(index);
    }
  }

  const sections = new Map();
  for (let index = 0; index < sectionStarts.length; index += 1) {
    const start = sectionStarts[index];
    const end = sectionStarts[index + 1] ?? lines.length;
    const header = lines[start].slice(3).trim();
    const bodyLines = trimBlankLines(lines.slice(start + 1, end));
    sections.set(header, bodyLines);
  }

  return sections;
}

function splitLastAcceptedTurn(lines) {
  const headerLines = [];
  let summaryLines = [];
  let decisionsLines = [];
  let objectionsLines = [];
  let verificationLines = [];

  let inVerification = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith('### Verification')) {
      inVerification = true;
      verificationLines.push(line);
      continue;
    }

    if (inVerification) {
      // A new heading at level 2 or 3 ends the verification block
      if (line.startsWith('## ') || (line.startsWith('### ') && !line.startsWith('### Verification'))) {
        inVerification = false;
        headerLines.push(line);
        continue;
      }
      verificationLines.push(line);
      continue;
    }

    if (SUMMARY_LINE_PATTERN.test(line)) {
      summaryLines = [line];
      continue;
    }

    if (DECISIONS_LINE_PATTERN.test(line)) {
      const { blockLines, nextIndex } = consumeIndentedBlock(lines, index);
      decisionsLines = blockLines;
      index = nextIndex - 1;
      continue;
    }

    if (OBJECTIONS_LINE_PATTERN.test(line)) {
      const { blockLines, nextIndex } = consumeIndentedBlock(lines, index);
      objectionsLines = blockLines;
      index = nextIndex - 1;
      continue;
    }

    headerLines.push(line);
  }

  return {
    headerLines: trimBlankLines(headerLines),
    summaryLines: trimBlankLines(summaryLines),
    decisionsLines: trimBlankLines(decisionsLines),
    objectionsLines: trimBlankLines(objectionsLines),
    verificationLines: trimBlankLines(verificationLines),
  };
}

function consumeIndentedBlock(lines, startIndex) {
  const blockLines = [lines[startIndex]];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('  ') || line.trim() === '') {
      blockLines.push(line);
      index += 1;
      continue;
    }
    break;
  }

  return {
    blockLines: trimBlankLines(blockLines),
    nextIndex: index,
  };
}

function pushSection(target, id, lines) {
  const normalizedLines = trimBlankLines(lines || []);
  if (!normalizedLines.length) return;

  target.push({
    id,
    content: normalizedLines.join('\n'),
    required: REQUIRED_BY_ID.get(id) === true,
  });
}

function trimBlankLines(lines) {
  return trimTrailingBlankLines(trimLeadingBlankLines(lines));
}

function trimLeadingBlankLines(lines) {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') {
    start += 1;
  }
  return lines.slice(start);
}

function trimTrailingBlankLines(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') {
    end -= 1;
  }
  return lines.slice(0, end);
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n/g, '\n');
}
