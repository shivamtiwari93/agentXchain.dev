import { spawnSync } from 'child_process';

export function parseCommandArgs(input) {
  if (Array.isArray(input)) {
    return input.filter(part => typeof part === 'string' && part.length > 0);
  }

  if (typeof input !== 'string' || !input.trim()) {
    return [];
  }

  const out = [];
  let current = '';
  let quote = null;
  let escape = false;

  for (const char of input.trim()) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) {
    out.push(current);
  }

  return out;
}

export function runConfiguredVerify(config, root) {
  const args = parseCommandArgs(config?.rules?.verify_command);
  if (args.length === 0) {
    return { ok: true, skipped: true, command: null };
  }

  const result = spawnSync(args[0], args.slice(1), {
    cwd: root,
    stdio: 'inherit'
  });

  return {
    ok: result.status === 0,
    skipped: false,
    command: args.join(' ')
  };
}
