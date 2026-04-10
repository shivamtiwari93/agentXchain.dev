"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGovernedRun = runGovernedRun;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
const governedStatus_1 = require("../governedStatus");
const runTerminal_1 = require("../runTerminal");
async function runGovernedRun(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    if (surface.mode !== 'governed') {
        vscode.window.showWarningMessage('Governed run launch is only available in governed mode.');
        return;
    }
    let payload;
    try {
        payload = await (0, governedStatus_1.loadGovernedStatus)(root);
    }
    catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governed status.');
        return;
    }
    const runAction = (0, governedStatus_1.getGovernedRunAction)(payload);
    if (!runAction) {
        if (payload.state?.pending_phase_transition || payload.state?.pending_run_completion) {
            vscode.window.showInformationMessage('Approve the pending governed gate before starting or resuming the run loop.');
            return;
        }
        if (payload.state?.blocked || payload.state?.status === 'blocked') {
            const recommended = payload.continuity?.recommended_command;
            const detail = recommended ? ` Use ${recommended} or the browser dashboard recovery flow first.` : '';
            vscode.window.showWarningMessage(`The governed run is blocked.${detail}`);
            return;
        }
        if (payload.state?.status === 'completed' || payload.state?.status === 'failed') {
            vscode.window.showInformationMessage(`No governed run loop is available while the run status is "${payload.state.status}".`);
            return;
        }
        vscode.window.showInformationMessage('No governed run loop is currently available for this project.');
        return;
    }
    const result = (0, runTerminal_1.launchGovernedRunTerminal)(root, runAction);
    if (result === 'reused') {
        vscode.window.showInformationMessage('Governed run terminal is already active. Focused the existing terminal.');
        return;
    }
    vscode.window.showInformationMessage(`${runAction.label} launched in the integrated terminal. Turn-completion notifications are suppressed while that terminal stays active.`);
}
//# sourceMappingURL=run.js.map