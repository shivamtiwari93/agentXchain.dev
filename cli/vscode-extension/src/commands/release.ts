import * as vscode from 'vscode';
import { readJson, writeJson, lockPath, LockState } from '../util';

export function releaseLock(root: string) {
  const lp = lockPath(root);
  const lock = readJson<LockState>(lp);

  if (!lock) {
    vscode.window.showErrorMessage('lock.json not found.');
    return;
  }

  if (!lock.holder) {
    vscode.window.showInformationMessage('Lock is already free.');
    return;
  }

  const who = lock.holder;
  const newLock: LockState = {
    holder: null,
    last_released_by: who,
    turn_number: who === 'human' ? lock.turn_number : lock.turn_number + 1,
    claimed_at: null
  };

  writeJson(lp, newLock);
  vscode.window.showInformationMessage(`Lock released by ${who} (turn ${newLock.turn_number}). Agents can resume.`);
}
