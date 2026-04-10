function cloneJsonCompatible(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const WORKFLOW_KIT_PHASE_TEMPLATE_REGISTRY = Object.freeze({
  'planning-default': {
    description: 'Core planning proof surface for governed repos.',
    artifacts: [
      { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
      { path: '.planning/SYSTEM_SPEC.md', semantics: 'system_spec', required: true },
      { path: '.planning/ROADMAP.md', semantics: null, required: true },
    ],
  },
  'implementation-default': {
    description: 'Implementation proof surface for governed repos.',
    artifacts: [
      { path: '.planning/IMPLEMENTATION_NOTES.md', semantics: 'implementation_notes', required: true },
    ],
  },
  'qa-default': {
    description: 'QA and ship-verdict proof surface for governed repos.',
    artifacts: [
      { path: '.planning/acceptance-matrix.md', semantics: 'acceptance_matrix', required: true },
      { path: '.planning/ship-verdict.md', semantics: 'ship_verdict', required: true },
      { path: '.planning/RELEASE_NOTES.md', semantics: 'release_notes', required: true },
    ],
  },
  'architecture-review': {
    description: 'Structured architecture-review document with required sections.',
    artifacts: [
      {
        path: '.planning/ARCHITECTURE.md',
        semantics: 'section_check',
        semantics_config: {
          required_sections: ['## Context', '## Proposed Design', '## Trade-offs', '## Risks'],
        },
        required: true,
      },
    ],
  },
  'security-review': {
    description: 'Structured security-review document with required sections.',
    artifacts: [
      {
        path: '.planning/SECURITY_REVIEW.md',
        semantics: 'section_check',
        semantics_config: {
          required_sections: ['## Threat Model', '## Findings', '## Verdict'],
        },
        required: true,
      },
    ],
  },
});

export const VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS = Object.freeze(
  Object.keys(WORKFLOW_KIT_PHASE_TEMPLATE_REGISTRY),
);

const DEFAULT_WORKFLOW_KIT_PHASE_TEMPLATE_BY_PHASE = Object.freeze({
  planning: 'planning-default',
  implementation: 'implementation-default',
  qa: 'qa-default',
});

export function listWorkflowKitPhaseTemplates() {
  return VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS.map((id) => loadWorkflowKitPhaseTemplate(id));
}

export function isWorkflowKitPhaseTemplateId(templateId) {
  return VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS.includes(templateId);
}

export function loadWorkflowKitPhaseTemplate(templateId) {
  if (!isWorkflowKitPhaseTemplateId(templateId)) {
    throw new Error(
      `Unknown workflow-kit phase template "${templateId}". Valid templates: ${VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS.join(', ')}`,
    );
  }

  const template = WORKFLOW_KIT_PHASE_TEMPLATE_REGISTRY[templateId];
  return {
    id: templateId,
    description: template.description,
    artifacts: cloneJsonCompatible(template.artifacts),
  };
}

export function expandWorkflowKitPhaseArtifacts(phaseConfig = {}) {
  const templateArtifacts = phaseConfig.template
    ? loadWorkflowKitPhaseTemplate(phaseConfig.template).artifacts
    : [];
  const explicitArtifacts = Array.isArray(phaseConfig.artifacts)
    ? cloneJsonCompatible(phaseConfig.artifacts)
    : [];
  const mergedArtifacts = templateArtifacts.map((artifact) => cloneJsonCompatible(artifact));
  const indexByPath = new Map(
    mergedArtifacts
      .filter((artifact) => artifact && typeof artifact.path === 'string')
      .map((artifact, index) => [artifact.path, index]),
  );

  for (const artifact of explicitArtifacts) {
    if (!artifact || typeof artifact.path !== 'string') {
      mergedArtifacts.push(artifact);
      continue;
    }

    const existingIndex = indexByPath.get(artifact.path);
    if (existingIndex === undefined) {
      indexByPath.set(artifact.path, mergedArtifacts.length);
      mergedArtifacts.push(artifact);
      continue;
    }

    mergedArtifacts[existingIndex] = {
      ...mergedArtifacts[existingIndex],
      ...artifact,
    };
  }

  return mergedArtifacts;
}

export function buildDefaultWorkflowKitArtifactsForPhase(phase) {
  const templateId = DEFAULT_WORKFLOW_KIT_PHASE_TEMPLATE_BY_PHASE[phase];
  return templateId ? loadWorkflowKitPhaseTemplate(templateId).artifacts : null;
}
