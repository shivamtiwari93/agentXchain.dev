import { execSync } from 'child_process';

export function notifyHuman(message, title = 'AgentXchain') {
  // Terminal bell
  process.stdout.write('\x07');

  // macOS notification
  if (process.platform === 'darwin') {
    try {
      execSync(`osascript -e 'display notification "${message}" with title "${title}"'`);
    } catch {
      // osascript not available or permission denied
    }
  }

  // Linux notification
  if (process.platform === 'linux') {
    try {
      execSync(`notify-send "${title}" "${message}"`);
    } catch {
      // notify-send not available
    }
  }
}
