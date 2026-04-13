import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { installPlugin, listInstalledPlugins, listAvailablePlugins, removePlugin, upgradePlugin } from '../lib/plugins.js';

function parsePluginConfigOptions(options) {
  if (options.config && options.configFile) {
    return { ok: false, error: 'Use either --config or --config-file, not both.' };
  }

  if (!options.config && !options.configFile) {
    return { ok: true, config: undefined };
  }

  try {
    const raw = options.configFile
      ? readFileSync(resolve(process.cwd(), options.configFile), 'utf8')
      : options.config;
    return { ok: true, config: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `Invalid plugin config JSON: ${error.message || String(error)}` };
  }
}

export async function pluginInstallCommand(spec, options) {
  const config = parsePluginConfigOptions(options);
  if (!config.ok) {
    console.error(config.error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: config.error }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  const result = installPlugin(spec, process.cwd(), { config: config.config });

  if (!result.ok) {
    console.error(result.error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: result.error, collisions: result.collisions || [] }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Installed plugin: ${result.name}@${result.version}`);
  console.log(`  Source: ${result.source.type} (${result.source.spec})`);
  console.log(`  Path:   ${result.install_path}`);
  if (result.config !== undefined) {
    console.log(`  Config: ${JSON.stringify(result.config)}`);
  }
  console.log('  Hooks:');
  for (const [phase, hookNames] of Object.entries(result.hooks || {})) {
    console.log(`    ${phase}: ${hookNames.join(', ')}`);
  }
}

export async function pluginListCommand(options) {
  const result = listInstalledPlugins(process.cwd());

  if (!result.ok) {
    console.error(result.error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ plugins: result.plugins }, null, 2));
    return;
  }

  if (result.plugins.length === 0) {
    console.log('No plugins installed.');
    return;
  }

  console.log(`Installed plugins: ${result.plugins.length}`);
  for (const plugin of result.plugins) {
    console.log(`  ${plugin.name}@${plugin.version || 'unknown'}`);
    console.log(`    Path: ${plugin.install_path || 'unknown'}`);
    console.log(`    Source: ${plugin.source?.type || 'unknown'} (${plugin.source?.spec || 'unknown'})`);
    console.log(`    Present: ${plugin.installed ? 'yes' : 'no'}`);
    const bindings = Object.entries(plugin.hooks || {})
      .map(([phase, hooks]) => `${phase}: ${hooks.join(', ')}`)
      .join(' | ');
    console.log(`    Hooks: ${bindings || 'none'}`);
  }
}

export async function pluginRemoveCommand(name, options) {
  const result = removePlugin(name, process.cwd());

  if (!result.ok) {
    console.error(result.error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Removed plugin: ${result.name}`);
  console.log(`  Path: ${result.install_path}`);
}

export async function pluginListAvailableCommand(options) {
  const result = listAvailablePlugins();

  if (!result.ok) {
    console.error(result.error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ plugins: result.plugins }, null, 2));
    return;
  }

  if (result.plugins.length === 0) {
    console.log('No built-in plugins available.');
    return;
  }

  console.log(`Available built-in plugins: ${result.plugins.length}`);
  for (const plugin of result.plugins) {
    console.log(`  ${plugin.short_name}`);
    console.log(`    ${plugin.description}`);
    console.log(`    Install: ${plugin.install_command}`);
  }
}

export async function pluginUpgradeCommand(name, source, options) {
  const config = parsePluginConfigOptions(options);
  if (!config.ok) {
    console.error(config.error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: config.error }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  const result = upgradePlugin(name, source, process.cwd(), { config: config.config });

  if (!result.ok) {
    console.error(result.error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: result.error, collisions: result.collisions || [] }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Upgraded plugin: ${result.name}@${result.version}`);
  console.log(`  Source: ${result.source.type} (${result.source.spec})`);
  console.log(`  Path:   ${result.install_path}`);
  if (result.config !== undefined) {
    console.log(`  Config: ${JSON.stringify(result.config)}`);
  }
  console.log('  Hooks:');
  for (const [phase, hookNames] of Object.entries(result.hooks || {})) {
    console.log(`    ${phase}: ${hookNames.join(', ')}`);
  }
}
