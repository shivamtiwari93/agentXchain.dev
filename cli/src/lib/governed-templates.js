import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const GOVERNED_TEMPLATES_DIR = join(__dirname, '../templates/governed');
export const VALID_GOVERNED_TEMPLATE_IDS = Object.freeze([
  'generic',
  'api-service',
  'cli-tool',
  'library',
  'web-app',
]);

const VALID_PROMPT_OVERRIDE_ROLES = new Set(['pm', 'dev', 'qa', 'eng_director']);

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
    if (!VALID_PROMPT_OVERRIDE_ROLES.has(roleId)) {
      errors.push(`prompt_overrides contains unknown role "${roleId}"`);
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
