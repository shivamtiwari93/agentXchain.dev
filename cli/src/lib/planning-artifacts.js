import { basename } from 'node:path';
import { buildSystemSpecContent } from './governed-templates.js';

export const GOVERNED_BASELINE_PLANNING_PATHS = Object.freeze([
  '.planning/PM_SIGNOFF.md',
  '.planning/ROADMAP.md',
  '.planning/SYSTEM_SPEC.md',
  '.planning/IMPLEMENTATION_NOTES.md',
  '.planning/acceptance-matrix.md',
  '.planning/ship-verdict.md',
  '.planning/RELEASE_NOTES.md',
]);

const PHASE_DISPLAY_NAMES = Object.freeze({
  qa: 'QA',
});

function formatPhaseDisplayName(phaseKey) {
  if (PHASE_DISPLAY_NAMES[phaseKey]) {
    return PHASE_DISPLAY_NAMES[phaseKey];
  }
  return phaseKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildRoadmapPhaseTable(routing, roles) {
  const rows = Object.entries(routing).map(([phaseKey, phaseConfig]) => {
    const phaseName = formatPhaseDisplayName(phaseKey);
    const entryRole = phaseConfig.entry_role;
    const role = roles[entryRole];
    const goal = role?.mandate || phaseName;
    const status = phaseKey === Object.keys(routing)[0] ? 'In progress' : 'Pending';
    return `| ${phaseName} | ${goal} | ${status} |`;
  });
  return `| Phase | Goal | Status |\n|-------|------|--------|\n${rows.join('\n')}\n`;
}

export function interpolateTemplateContent(contentTemplate, projectName) {
  return contentTemplate.replaceAll('{{project_name}}', projectName);
}

export function appendAcceptanceHints(baseMatrix, acceptanceHints) {
  if (!Array.isArray(acceptanceHints) || acceptanceHints.length === 0) {
    return baseMatrix;
  }

  const hintLines = acceptanceHints.map((hint) => `- [ ] ${hint}`).join('\n');
  return `${baseMatrix}\n\n## Template Guidance\n${hintLines}\n`;
}

export function generateWorkflowKitPlaceholder(artifact, projectName) {
  const filename = basename(artifact.path);
  const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

  if (artifact.semantics === 'section_check' && artifact.semantics_config?.required_sections?.length) {
    const sections = artifact.semantics_config.required_sections
      .map((section) => `${section}\n\n(Content here.)\n`)
      .join('\n');
    return `# ${title} — ${projectName}\n\n${sections}`;
  }

  return `# ${title} — ${projectName}\n\n(Operator fills this in.)\n`;
}

export function buildGovernedPlanningArtifacts({ projectName, routing, roles, template, workflowKitConfig }) {
  const artifacts = [
    {
      path: '.planning/PM_SIGNOFF.md',
      source: 'core',
      content: `# PM Signoff — ${projectName}\n\nApproved: NO\n\n> This scaffold starts blocked on purpose. Change this to \`Approved: YES\` only after a human reviews the planning artifacts and is ready to open the planning gate.\n\n## Discovery Checklist\n- [ ] Target user defined\n- [ ] Core pain point defined\n- [ ] Core workflow defined\n- [ ] MVP scope defined\n- [ ] Out-of-scope list defined\n- [ ] Success metric defined\n\n## Notes for team\n(PM and human add final kickoff notes here.)\n`,
    },
    {
      path: '.planning/ROADMAP.md',
      source: 'core',
      content: `# Roadmap — ${projectName}\n\n## Phases\n\n${buildRoadmapPhaseTable(routing, roles)}`,
    },
    {
      path: '.planning/SYSTEM_SPEC.md',
      source: 'core',
      content: buildSystemSpecContent(projectName, template?.system_spec_overlay),
    },
    {
      path: '.planning/IMPLEMENTATION_NOTES.md',
      source: 'core',
      content: `# Implementation Notes — ${projectName}\n\n## Changes\n\n(Dev fills this during implementation)\n\n## Verification\n\n(Dev fills this during implementation)\n\n## Unresolved Follow-ups\n\n(Dev lists any known gaps, tech debt, or follow-up items here.)\n`,
    },
    {
      path: '.planning/acceptance-matrix.md',
      source: 'core',
      content: appendAcceptanceHints(
        `# Acceptance Matrix — ${projectName}\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| (QA fills this from ROADMAP.md) | | | | | |\n`,
        template?.acceptance_hints,
      ),
    },
    {
      path: '.planning/ship-verdict.md',
      source: 'core',
      content: `# Ship Verdict — ${projectName}\n\n## Verdict: PENDING\n\n## QA Summary\n\n(QA writes the final ship/no-ship assessment here.)\n\n## Open Blockers\n\n(List any blocking issues.)\n\n## Conditions\n\n(List any conditions for shipping.)\n`,
    },
    {
      path: '.planning/RELEASE_NOTES.md',
      source: 'core',
      content: `# Release Notes — ${projectName}\n\n## User Impact\n\n(QA fills this during the QA phase)\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n\n## Upgrade Notes\n\n(QA fills this during the QA phase)\n\n## Known Issues\n\n(QA fills this during the QA phase)\n`,
    },
  ];

  for (const artifact of template?.planning_artifacts || []) {
    artifacts.push({
      path: `.planning/${artifact.filename}`,
      source: 'template',
      content: interpolateTemplateContent(artifact.content_template, projectName),
    });
  }

  const seenPaths = new Set(GOVERNED_BASELINE_PLANNING_PATHS);
  if (workflowKitConfig?.phases && typeof workflowKitConfig.phases === 'object') {
    for (const phaseConfig of Object.values(workflowKitConfig.phases)) {
      if (!Array.isArray(phaseConfig.artifacts)) continue;
      for (const artifact of phaseConfig.artifacts) {
        if (!artifact.path || seenPaths.has(artifact.path)) continue;
        seenPaths.add(artifact.path);
        artifacts.push({
          path: artifact.path,
          source: 'workflow_kit',
          content: generateWorkflowKitPlaceholder(artifact, projectName),
        });
      }
    }
  }

  return artifacts;
}
