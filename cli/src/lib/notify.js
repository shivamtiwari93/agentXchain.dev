import { execFileSync } from 'child_process';

function sanitize(str) {
  return String(str).replace(/[\\"]/g, ' ').replace(/'/g, ' ').slice(0, 200);
}

export function notifyHuman(message, title = 'AgentXchain') {
  process.stdout.write('\x07');

  const safeMsg = sanitize(message);
  const safeTitle = sanitize(title);

  if (process.platform === 'darwin') {
    try {
      execFileSync('osascript', [
        '-e', `display notification "${safeMsg}" with title "${safeTitle}"`
      ], { stdio: 'ignore' });
    } catch {}
  }

  if (process.platform === 'linux') {
    try {
      execFileSync('notify-send', [safeTitle, safeMsg], { stdio: 'ignore' });
    } catch {}
  }
}
