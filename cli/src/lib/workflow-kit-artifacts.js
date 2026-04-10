import { existsSync } from 'fs';
import { join } from 'path';

export function deriveWorkflowKitArtifacts(root, config, state) {
  if (!config?.workflow_kit) return null;

  const phase = state?.phase || null;
  if (!phase) return null;

  const phaseConfig = config.workflow_kit.phases?.[phase];
  if (!phaseConfig) return null;

  const artifacts = Array.isArray(phaseConfig.artifacts) ? phaseConfig.artifacts : [];
  if (artifacts.length === 0) return null;

  const entryRole = config.routing?.[phase]?.entry_role || null;

  return {
    ok: true,
    phase,
    artifacts: artifacts
      .filter((artifact) => artifact && typeof artifact.path === 'string')
      .map((artifact) => {
        const hasExplicitOwner = typeof artifact.owned_by === 'string' && artifact.owned_by.length > 0;
        return {
          path: artifact.path,
          required: artifact.required !== false,
          semantics: artifact.semantics || null,
          owned_by: hasExplicitOwner ? artifact.owned_by : entryRole,
          owner_resolution: hasExplicitOwner ? 'explicit' : 'entry_role',
          exists: existsSync(join(root, artifact.path)),
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path, 'en')),
  };
}
