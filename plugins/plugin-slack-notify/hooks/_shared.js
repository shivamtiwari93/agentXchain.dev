import http from 'node:http';
import https from 'node:https';
import process from 'node:process';

export async function readEnvelope() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input.trim() ? JSON.parse(input) : {};
}

function parsePluginConfig() {
  try {
    const parsed = JSON.parse(process.env.AGENTXCHAIN_PLUGIN_CONFIG || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveWebhookSetting(config) {
  const configuredEnv = typeof config?.webhook_env === 'string' ? config.webhook_env.trim() : '';
  if (configuredEnv) {
    return {
      envName: configuredEnv,
      url: process.env[configuredEnv] || '',
    };
  }

  return {
    envName: 'AGENTXCHAIN_SLACK_WEBHOOK_URL or SLACK_WEBHOOK_URL',
    url: process.env.AGENTXCHAIN_SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || '',
  };
}

function buildText(title, lines, config) {
  const mention = typeof config?.mention === 'string' && config.mention.trim()
    ? config.mention.trim()
    : (process.env.AGENTXCHAIN_SLACK_MENTION || '');
  return [mention, title, ...lines.filter(Boolean)].filter(Boolean).join('\n');
}

export async function sendSlackMessage(title, lines) {
  const config = parsePluginConfig();
  if (config === null) {
    return {
      verdict: 'warn',
      message: 'Invalid AGENTXCHAIN_PLUGIN_CONFIG JSON',
    };
  }

  const webhookSetting = resolveWebhookSetting(config);
  const webhookUrl = webhookSetting.url;
  if (!webhookUrl) {
    return {
      verdict: 'warn',
      message: `Missing Slack webhook env ${webhookSetting.envName}`,
    };
  }

  const body = JSON.stringify({
    text: buildText(title, lines, config),
  });

  const url = new URL(webhookUrl);
  const transport = url.protocol === 'https:' ? https : http;
  let response;
  try {
    response = await new Promise((resolve, reject) => {
      const req = transport.request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 4000,
      }, (res) => {
        res.resume();
        res.on('end', () => resolve({ ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300, status: res.statusCode || 500 }));
      });

      req.on('timeout', () => {
        req.destroy(new Error('request timed out'));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (error) {
    return {
      verdict: 'warn',
      message: `Slack webhook request failed: ${error.message}`,
    };
  }

  if (!response.ok) {
    return {
      verdict: 'warn',
      message: `Slack webhook failed with HTTP ${response.status}`,
    };
  }

  return {
    verdict: 'allow',
    message: 'Slack notification delivered',
  };
}

export function writeResult(result) {
  process.stdout.write(JSON.stringify(result));
}
