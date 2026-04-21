import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateV4Config } from './normalized-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const GOVERNED_TEMPLATES_DIR = join(__dirname, '../templates/governed');
export const VALID_GOVERNED_TEMPLATE_IDS = Object.freeze([
  'generic',
  'api-service',
  'cli-tool',
  'library',
  'web-app',
  'full-local-cli',
  'enterprise-app',
]);

const VALID_ROLE_ID_PATTERN = /^[a-z0-9_-]+$/;

function validatePlanningArtifacts(artifacts, errors) {
  if (!Array.isArray(artifacts)) {
    errors.push('planning_artifacts must be an array');
    return;
  }

  const seenFilenames = new Set();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      errors.push('planning_artifacts entries must be objects');
      continue;
    }

    if (typeof artifact.filename !== 'string' || !artifact.filename.trim()) {
      errors.push('planning_artifacts.filename must be a non-empty string');
    } else if (seenFilenames.has(artifact.filename)) {
      errors.push(`planning_artifacts contains duplicate filename "${artifact.filename}"`);
    } else {
      seenFilenames.add(artifact.filename);
    }

    if (typeof artifact.content_template !== 'string' || !artifact.content_template.trim()) {
      errors.push(`planning_artifacts["${artifact.filename || '?'}"].content_template must be a non-empty string`);
    }
  }
}

function validatePromptOverrides(promptOverrides, errors) {
  if (promptOverrides === undefined) return;
  if (!promptOverrides || typeof promptOverrides !== 'object' || Array.isArray(promptOverrides)) {
    errors.push('prompt_overrides must be an object when provided');
    return;
  }

  for (const [roleId, content] of Object.entries(promptOverrides)) {
    if (!VALID_ROLE_ID_PATTERN.test(roleId)) {
      errors.push(`prompt_overrides contains invalid role ID "${roleId}" (must match ${VALID_ROLE_ID_PATTERN})`);
    }
    if (typeof content !== 'string' || !content.trim()) {
      errors.push(`prompt_overrides["${roleId}"] must be a non-empty string`);
    }
  }
}

function validateAcceptanceHints(acceptanceHints, errors) {
  if (acceptanceHints === undefined) return;
  if (!Array.isArray(acceptanceHints)) {
    errors.push('acceptance_hints must be an array when provided');
    return;
  }

  for (const hint of acceptanceHints) {
    if (typeof hint !== 'string' || !hint.trim()) {
      errors.push('acceptance_hints entries must be non-empty strings');
    }
  }
}

const VALID_SCAFFOLD_BLUEPRINT_KEYS = new Set([
  'roles',
  'runtimes',
  'routing',
  'gates',
  'policies',
  'workflow_kit',
  'approval_policy',
]);

function validateScaffoldBlueprint(scaffoldBlueprint, errors) {
  if (scaffoldBlueprint === undefined) return;
  if (!scaffoldBlueprint || typeof scaffoldBlueprint !== 'object' || Array.isArray(scaffoldBlueprint)) {
    errors.push('scaffold_blueprint must be an object when provided');
    return;
  }

  for (const key of Object.keys(scaffoldBlueprint)) {
    if (!VALID_SCAFFOLD_BLUEPRINT_KEYS.has(key)) {
      errors.push(`scaffold_blueprint contains unknown key "${key}"`);
    }
  }

  const validation = validateV4Config({
    schema_version: '1.0',
    project: {
      id: 'template-manifest',
      name: 'Template Manifest',
    },
    roles: scaffoldBlueprint.roles,
    runtimes: scaffoldBlueprint.runtimes,
    routing: scaffoldBlueprint.routing,
    gates: scaffoldBlueprint.gates,
    policies: scaffoldBlueprint.policies,
    workflow_kit: scaffoldBlueprint.workflow_kit,
  });

  if (!validation.ok) {
    for (const error of validation.errors) {
      errors.push(`scaffold_blueprint ${error}`);
    }
  }
}

const VALID_SPEC_OVERLAY_KEYS = new Set([
  'purpose_guidance',
  'interface_guidance',
  'behavior_guidance',
  'error_cases_guidance',
  'acceptance_tests_guidance',
  'extra_sections',
]);

function validateSystemSpecOverlay(overlay, errors) {
  if (overlay === undefined) return;
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    errors.push('system_spec_overlay must be an object when provided');
    return;
  }

  for (const [key, value] of Object.entries(overlay)) {
    if (!VALID_SPEC_OVERLAY_KEYS.has(key)) {
      errors.push(`system_spec_overlay contains unknown key "${key}"`);
    }
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`system_spec_overlay["${key}"] must be a non-empty string`);
    }
  }
}

export function validateGovernedTemplateManifest(manifest, expectedId = null) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }

  if (typeof manifest.id !== 'string' || !manifest.id.trim()) {
    errors.push('id must be a non-empty string');
  } else if (expectedId && manifest.id !== expectedId) {
    errors.push(`id must match expected template id "${expectedId}"`);
  }

  if (typeof manifest.display_name !== 'string' || !manifest.display_name.trim()) {
    errors.push('display_name must be a non-empty string');
  }

  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    errors.push('description must be a non-empty string');
  }

  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    errors.push('version must be a non-empty string');
  }

  if (!Array.isArray(manifest.protocol_compatibility) || manifest.protocol_compatibility.length === 0) {
    errors.push('protocol_compatibility must be a non-empty array');
  } else {
    for (const version of manifest.protocol_compatibility) {
      if (typeof version !== 'string' || !version.trim()) {
        errors.push('protocol_compatibility entries must be non-empty strings');
      }
    }
  }

  validatePlanningArtifacts(manifest.planning_artifacts, errors);
  validatePromptOverrides(manifest.prompt_overrides, errors);
  validateAcceptanceHints(manifest.acceptance_hints, errors);
  validateSystemSpecOverlay(manifest.system_spec_overlay, errors);
  validateScaffoldBlueprint(manifest.scaffold_blueprint, errors);

  return { ok: errors.length === 0, errors };
}

export function loadGovernedTemplate(templateId) {
  if (!VALID_GOVERNED_TEMPLATE_IDS.includes(templateId)) {
    const validIds = VALID_GOVERNED_TEMPLATE_IDS.join(', ');
    throw new Error(`Unknown template "${templateId}". Valid templates: ${validIds}`);
  }

  const manifestPath = join(GOVERNED_TEMPLATES_DIR, `${templateId}.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(`Template "${templateId}" is registered but its manifest is missing.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Template "${templateId}" manifest is invalid JSON: ${err.message}`);
  }

  const validation = validateGovernedTemplateManifest(manifest, templateId);
  if (!validation.ok) {
    throw new Error(`Template "${templateId}" manifest is invalid: ${validation.errors.join('; ')}`);
  }

  return manifest;
}

export function loadAllGovernedTemplates() {
  return VALID_GOVERNED_TEMPLATE_IDS.map((templateId) => loadGovernedTemplate(templateId));
}

export function listGovernedTemplateManifestIds(manifestDir = GOVERNED_TEMPLATES_DIR) {
  if (!existsSync(manifestDir)) {
    return [];
  }

  return readdirSync(manifestDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .sort();
}

export function validateGovernedTemplateRegistry(options = {}) {
  const manifestDir = options.manifestDir || GOVERNED_TEMPLATES_DIR;
  const registeredIds = options.registeredIds || [...VALID_GOVERNED_TEMPLATE_IDS];
  const errors = [];
  const warnings = [];
  const manifestIds = listGovernedTemplateManifestIds(manifestDir);

  for (const templateId of registeredIds) {
    const manifestPath = join(manifestDir, `${templateId}.json`);
    if (!existsSync(manifestPath)) {
      errors.push(`Registered template "${templateId}" is missing its manifest file.`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push(`Template "${templateId}" manifest is invalid JSON: ${err.message}`);
      continue;
    }

    const validation = validateGovernedTemplateManifest(manifest, templateId);
    if (!validation.ok) {
      errors.push(`Template "${templateId}" manifest is invalid: ${validation.errors.join('; ')}`);
    }
  }

  for (const manifestId of manifestIds) {
    if (!registeredIds.includes(manifestId)) {
      errors.push(`Manifest "${manifestId}.json" exists on disk but is not registered in VALID_GOVERNED_TEMPLATE_IDS.`);
    }
  }

  return {
    ok: errors.length === 0,
    registered_ids: registeredIds,
    manifest_ids: manifestIds,
    errors,
    warnings,
  };
}

export function validateProjectPlanningArtifacts(root, templateId) {
  const effectiveTemplateId = templateId || 'generic';
  const errors = [];
  const warnings = [];

  let manifest;
  try {
    manifest = loadGovernedTemplate(effectiveTemplateId);
  } catch {
    // Template load failure is already reported by validateGovernedProjectTemplate.
    // Skip artifact check — we cannot know what artifacts to expect.
    return {
      ok: true,
      template: effectiveTemplateId,
      expected: [],
      present: [],
      missing: [],
      errors,
      warnings: ['Template could not be loaded; planning artifact check skipped.'],
    };
  }

  const artifacts = manifest.planning_artifacts || [];
  const expected = artifacts.map((a) => a.filename);
  const present = [];
  const missing = [];

  for (const filename of expected) {
    const artifactPath = join(root, '.planning', filename);
    if (existsSync(artifactPath)) {
      present.push(filename);
    } else {
      missing.push(filename);
      errors.push(`Template "${effectiveTemplateId}" requires planning artifact ".planning/${filename}" but it is missing.`);
    }
  }

  return {
    ok: errors.length === 0,
    template: effectiveTemplateId,
    expected,
    present,
    missing,
    errors,
    warnings,
  };
}

const TEMPLATE_GUIDANCE_HEADER = '## Template Guidance';
const GOVERNED_WORKFLOW_KIT_BASE_FILES = Object.freeze([
  '.planning/PM_SIGNOFF.md',
  '.planning/ROADMAP.md',
  '.planning/SYSTEM_SPEC.md',
  '.planning/acceptance-matrix.md',
  '.planning/ship-verdict.md',
]);
const GOVERNED_WORKFLOW_KIT_STRUCTURAL_CHECKS = Object.freeze([
  {
    id: 'pm_signoff_approved_field',
    file: '.planning/PM_SIGNOFF.md',
    pattern: /^Approved\s*:/im,
    description: 'PM signoff declares an Approved field',
  },
  {
    id: 'roadmap_phases_section',
    file: '.planning/ROADMAP.md',
    pattern: /^##\s+Phases\b/im,
    description: 'Roadmap defines a ## Phases section',
  },
  {
    id: 'system_spec_purpose_section',
    file: '.planning/SYSTEM_SPEC.md',
    pattern: /^##\s+Purpose\b/im,
    description: 'System spec defines a ## Purpose section',
  },
  {
    id: 'system_spec_interface_section',
    file: '.planning/SYSTEM_SPEC.md',
    pattern: /^##\s+Interface\b/im,
    description: 'System spec defines a ## Interface section',
  },
  {
    id: 'system_spec_acceptance_tests_section',
    file: '.planning/SYSTEM_SPEC.md',
    pattern: /^##\s+Acceptance Tests\b/im,
    description: 'System spec defines a ## Acceptance Tests section',
  },
  {
    id: 'acceptance_matrix_table_header',
    file: '.planning/acceptance-matrix.md',
    pattern: /^\|\s*Req\s*#\s*\|/im,
    description: 'Acceptance matrix includes the requirement table header',
  },
  {
    id: 'ship_verdict_heading',
    file: '.planning/ship-verdict.md',
    pattern: /^##\s+Verdict\s*:/im,
    description: 'Ship verdict declares a verdict heading',
  },
]);

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

export function validateAcceptanceHintCompletion(root, templateId) {
  const effectiveTemplateId = templateId || 'generic';
  const errors = [];
  const warnings = [];

  let manifest;
  try {
    manifest = loadGovernedTemplate(effectiveTemplateId);
  } catch {
    return {
      ok: true,
      template: effectiveTemplateId,
      total: 0,
      checked: 0,
      unchecked: 0,
      missing_file: false,
      missing_section: false,
      unchecked_hints: [],
      errors,
      warnings: ['Template could not be loaded; acceptance hint check skipped.'],
    };
  }

  const hints = manifest.acceptance_hints || [];
  if (hints.length === 0) {
    return {
      ok: true,
      template: effectiveTemplateId,
      total: 0,
      checked: 0,
      unchecked: 0,
      missing_file: false,
      missing_section: false,
      unchecked_hints: [],
      errors,
      warnings,
    };
  }

  const matrixPath = join(root, '.planning', 'acceptance-matrix.md');
  if (!existsSync(matrixPath)) {
    warnings.push('acceptance-matrix.md not found; cannot verify template acceptance hints.');
    return {
      ok: true,
      template: effectiveTemplateId,
      total: hints.length,
      checked: 0,
      unchecked: hints.length,
      missing_file: true,
      missing_section: false,
      unchecked_hints: [...hints],
      errors,
      warnings,
    };
  }

  const matrixContent = readFileSync(matrixPath, 'utf8');
  const sectionIndex = matrixContent.indexOf(TEMPLATE_GUIDANCE_HEADER);
  if (sectionIndex === -1) {
    warnings.push('acceptance-matrix.md has no "## Template Guidance" section; cannot verify template acceptance hints.');
    return {
      ok: true,
      template: effectiveTemplateId,
      total: hints.length,
      checked: 0,
      unchecked: hints.length,
      missing_file: false,
      missing_section: true,
      unchecked_hints: [...hints],
      errors,
      warnings,
    };
  }

  // Parse the Template Guidance section for checked/unchecked items
  const sectionContent = matrixContent.slice(sectionIndex);
  const checkedPattern = /^- \[x\]\s+(.+)$/gim;
  const checkedTexts = new Set();
  let match;
  while ((match = checkedPattern.exec(sectionContent)) !== null) {
    checkedTexts.add(match[1].trim());
  }

  const uncheckedHints = [];
  let checkedCount = 0;

  for (const hint of hints) {
    if (checkedTexts.has(hint)) {
      checkedCount++;
    } else {
      uncheckedHints.push(hint);
      warnings.push(`Acceptance hint unchecked: "${hint}"`);
    }
  }

  return {
    ok: true,
    template: effectiveTemplateId,
    total: hints.length,
    checked: checkedCount,
    unchecked: uncheckedHints.length,
    missing_file: false,
    missing_section: false,
    unchecked_hints: uncheckedHints,
    errors,
    warnings,
  };
}

export function validateGovernedWorkflowKit(root, config = {}) {
  const errors = [];
  const warnings = [];
  const gateRequiredFiles = uniqueStrings(
    Object.values(config?.gates || {}).flatMap((gate) => Array.isArray(gate?.requires_files) ? gate.requires_files : [])
  );

  // Collect workflow-kit artifact paths from explicit config
  const wkArtifactPaths = [];
  const wk = config?.workflow_kit;
  if (wk && wk.phases && typeof wk.phases === 'object') {
    for (const phaseConfig of Object.values(wk.phases)) {
      if (Array.isArray(phaseConfig.artifacts)) {
        for (const a of phaseConfig.artifacts) {
          if (a.path && a.required !== false) {
            wkArtifactPaths.push(a.path);
          }
        }
      }
    }
  }

  const hasExplicitWorkflowKit = wk && wk._explicit === true;
  const hasExplicitWorkflowKitArtifacts = hasExplicitWorkflowKit && Object.keys(wk.phases || {}).length > 0;
  const baseFiles = hasExplicitWorkflowKit ? wkArtifactPaths : GOVERNED_WORKFLOW_KIT_BASE_FILES;
  const requiredFiles = uniqueStrings([...baseFiles, ...gateRequiredFiles]);
  const present = [];
  const missing = [];

  for (const relPath of requiredFiles) {
    if (existsSync(join(root, relPath))) {
      present.push(relPath);
    } else {
      missing.push(relPath);
      errors.push(`Workflow kit requires "${relPath}" but it is missing.`);
    }
  }

  // Build structural checks: from explicit workflow_kit semantics or hardcoded defaults
  let structuralChecks;
  if (hasExplicitWorkflowKit) {
    structuralChecks = buildStructuralChecksFromWorkflowKit(root, wk, errors);
  } else {
    structuralChecks = GOVERNED_WORKFLOW_KIT_STRUCTURAL_CHECKS.map((check) => {
      const absPath = join(root, check.file);
      if (!existsSync(absPath)) {
        return {
          id: check.id,
          file: check.file,
          ok: false,
          skipped: true,
          description: check.description,
        };
      }

      const content = readFileSync(absPath, 'utf8');
      const ok = check.pattern.test(content);
      if (!ok) {
        errors.push(`Workflow kit file "${check.file}" must preserve its structural marker: ${check.description}.`);
      }

      return {
        id: check.id,
        file: check.file,
        ok,
        skipped: false,
        description: check.description,
      };
    });
  }

  return {
    ok: errors.length === 0,
    required_files: requiredFiles,
    gate_required_files: gateRequiredFiles,
    present,
    missing,
    structural_checks: structuralChecks,
    errors,
    warnings,
  };
}

function buildStructuralChecksFromWorkflowKit(root, wk, errors) {
  const checks = [];
  if (!wk.phases) return checks;

  for (const [phase, phaseConfig] of Object.entries(wk.phases)) {
    if (!Array.isArray(phaseConfig.artifacts)) continue;
    for (const artifact of phaseConfig.artifacts) {
      if (!artifact.semantics) continue;

      if (artifact.semantics === 'section_check' && artifact.semantics_config?.required_sections?.length) {
        for (const section of artifact.semantics_config.required_sections) {
          const checkId = `wk_${phase}_${artifact.path.replace(/[^a-zA-Z0-9]/g, '_')}_section_${section.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const description = `${artifact.path} defines ${section}`;
          const absPath = join(root, artifact.path);

          if (!existsSync(absPath)) {
            checks.push({ id: checkId, file: artifact.path, ok: false, skipped: true, description });
            continue;
          }

          const content = readFileSync(absPath, 'utf8');
          const ok = content.includes(section);
          if (!ok) {
            errors.push(`Workflow kit file "${artifact.path}" must contain section: ${section}.`);
          }
          checks.push({ id: checkId, file: artifact.path, ok, skipped: false, description });
        }
      } else if (artifact.semantics !== 'section_check') {
        // Built-in semantic check — generate a structural check entry
        const checkId = `wk_${phase}_${artifact.semantics}`;
        const description = `${artifact.path} passes ${artifact.semantics} validation`;
        const absPath = join(root, artifact.path);

        if (!existsSync(absPath)) {
          checks.push({ id: checkId, file: artifact.path, ok: false, skipped: true, description });
          continue;
        }

        // For built-in validators, delegate to the hardcoded check if one exists
        const hardcoded = GOVERNED_WORKFLOW_KIT_STRUCTURAL_CHECKS.find(c => c.file === artifact.path);
        if (hardcoded) {
          const content = readFileSync(absPath, 'utf8');
          const ok = hardcoded.pattern.test(content);
          if (!ok) {
            errors.push(`Workflow kit file "${artifact.path}" must preserve its structural marker: ${hardcoded.description}.`);
          }
          checks.push({ id: checkId, file: artifact.path, ok, skipped: false, description: hardcoded.description });
        } else {
          // No hardcoded check for this semantic — mark as passing (runtime gate handles full validation)
          checks.push({ id: checkId, file: artifact.path, ok: true, skipped: false, description });
        }
      }
    }
  }

  return checks;
}

export const SYSTEM_SPEC_OVERLAY_SEPARATOR = '## Template-Specific Guidance';

export function buildSystemSpecContent(projectName, overlay) {
  const o = overlay || {};
  const purpose = o.purpose_guidance || '(Describe the problem this slice solves and why it exists.)';
  const iface = o.interface_guidance || '(List the user-facing commands, files, APIs, or contracts this slice changes.)';
  const behavior = o.behavior_guidance || '(Describe the expected behavior, including important edge cases.)';
  const errorCases = o.error_cases_guidance || '(List the failure modes and how the system should respond.)';
  const acceptance = o.acceptance_tests_guidance || '- [ ] Name the executable checks that prove this slice works.';
  const extra = o.extra_sections ? `\n${o.extra_sections}\n` : '';

  return `# System Spec — ${projectName}\n\n## Purpose\n\n${purpose}\n\n## Interface\n\n${iface}\n\n## Behavior\n\n${behavior}\n\n## Error Cases\n\n${errorCases}\n\n## Acceptance Tests\n\n${acceptance}\n\n## Open Questions\n\n- (Capture unresolved product or implementation questions here.)\n${extra}`;
}

export function validateGovernedProjectTemplate(templateId, source = 'agentxchain.json') {
  const effectiveTemplateId = templateId || 'generic';
  const effectiveSource = templateId ? source : 'implicit_default';
  const errors = [];
  const warnings = [];

  try {
    loadGovernedTemplate(effectiveTemplateId);
  } catch (err) {
    errors.push(err.message);
  }

  return {
    ok: errors.length === 0,
    template: effectiveTemplateId,
    source: effectiveSource,
    errors,
    warnings,
  };
}
