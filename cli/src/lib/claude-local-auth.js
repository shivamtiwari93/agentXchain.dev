const CLAUDE_ENV_AUTH_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
];

function normalizeCommandTokens(runtime) {
  if (Array.isArray(runtime?.command)) {
    return runtime.command.flatMap((element) =>
      typeof element === 'string' ? element.trim().split(/\s+/).filter(Boolean) : []
    );
  }
  if (typeof runtime?.command === 'string' && runtime.command.trim()) {
    return runtime.command.trim().split(/\s+/).filter(Boolean);
  }
  return [];
}

export function isClaudeLocalCliRuntime(runtime) {
  const tokens = normalizeCommandTokens(runtime);
  if (tokens.length === 0) {
    return false;
  }
  const head = tokens[0].toLowerCase();
  return head === 'claude' || head.endsWith('/claude');
}

export function hasClaudeBareFlag(runtime) {
  return normalizeCommandTokens(runtime).includes('--bare');
}

export function getClaudeEnvAuthPresence(env = process.env) {
  return Object.fromEntries(
    CLAUDE_ENV_AUTH_KEYS.map((key) => [key, Boolean(env?.[key])]),
  );
}

export function hasClaudeEnvAuth(env = process.env) {
  return Object.values(getClaudeEnvAuthPresence(env)).some(Boolean);
}

export function getClaudeSubprocessAuthIssue(runtime, env = process.env) {
  if (!isClaudeLocalCliRuntime(runtime)) {
    return null;
  }

  if (hasClaudeBareFlag(runtime) || hasClaudeEnvAuth(env)) {
    return null;
  }

  const auth_env_present = getClaudeEnvAuthPresence(env);
  return {
    auth_env_present,
    detail: 'Claude local_cli runtime has no env-based auth and is missing "--bare"; non-interactive subprocesses can hang on macOS keychain reads.',
    fix: 'Export ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN before running AgentXchain, or add "--bare" to the Claude command if you intentionally want env-only auth.',
  };
}

export { CLAUDE_ENV_AUTH_KEYS, normalizeCommandTokens };
