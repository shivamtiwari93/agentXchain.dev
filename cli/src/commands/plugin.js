import { installPlugin, listInstalledPlugins, removePlugin } from '../lib/plugins.js';

export async function pluginInstallCommand(spec, options) {
  const result = installPlugin(spec, process.cwd());

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
