import * as vscode from 'vscode';
import { readJson, writeJson, lockPath, LockState, getProjectSurface, GOVERNED_MODE_NOTICE } from '../util';

export function claimLock(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode === 'governed') {
    vscode.window.showWarningMessage(GOVERNED_MODE_NOTICE);
    return;
  }

  const lp = lockPath(root);
  const lock = readJson<LockState>(lp);

  if (!lock) {
    vscode.window.showErrorMessage('lock.json not found. Run AgentXchain: Init first.');
    return;
  }

  if (lock.holder === 'human') {
    vscode.window.showInformationMessage('You already hold the lock. Use Release when done.');
    return;
  }

  if (lock.holder) {
    const agent = lock.holder;
    vscode.window.showWarningMessage(
      `Lock held by "${agent}". Force-claim?`,
      'Force Claim',
      'Cancel'
    ).then(choice => {
      if (choice === 'Force Claim') {
        writeClaim(lp, lock);
      }
    });
    return;
  }

  writeClaim(lp, lock);
}

function writeClaim(lp: string, lock: LockState) {
  const newLock: LockState = {
    holder: 'human',
    last_released_by: lock.last_released_by,
    turn_number: lock.turn_number,
    claimed_at: new Date().toISOString()
  };
  writeJson(lp, newLock);
  vscode.window.showInformationMessage(`Lock claimed by human (turn ${lock.turn_number}). Agents paused.`);
}
