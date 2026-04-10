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
exports.GovernedNotificationService = void 0;
const vscode = __importStar(require("vscode"));
const governedStatus_1 = require("./governedStatus");
const util_1 = require("./util");
const notificationState_1 = require("./notificationState");
const runTerminal_1 = require("./runTerminal");
class GovernedNotificationService {
    previous = null;
    root;
    disposed = false;
    constructor(root) {
        this.root = root;
    }
    async check() {
        if (this.disposed)
            return;
        const mode = (0, util_1.detectProjectMode)(this.root);
        if (mode !== 'governed') {
            this.previous = null;
            return;
        }
        let payload;
        try {
            payload = await (0, governedStatus_1.loadGovernedStatus)(this.root);
        }
        catch {
            return;
        }
        const current = (0, notificationState_1.snapshotFromPayload)(payload);
        const prev = this.previous;
        this.previous = current;
        if (!prev)
            return;
        const diff = (0, notificationState_1.diffRequiresNotification)(prev, current);
        if (diff.pendingTransition) {
            const transition = payload.state?.pending_phase_transition;
            const from = transition?.from || 'unknown';
            const to = transition?.to || 'unknown';
            const gate = transition?.gate || 'unknown gate';
            const choice = await vscode.window.showWarningMessage(`Phase transition pending: ${from} \u2192 ${to} (gate: ${gate})`, 'Approve');
            if (choice === 'Approve') {
                await vscode.commands.executeCommand('agentxchain.approveTransition');
            }
        }
        if (diff.pendingCompletion) {
            const gate = payload.state?.pending_run_completion?.gate || 'awaiting approval';
            const choice = await vscode.window.showWarningMessage(`Run completion pending (gate: ${gate})`, 'Approve');
            if (choice === 'Approve') {
                await vscode.commands.executeCommand('agentxchain.approveCompletion');
            }
        }
        if (diff.blocked) {
            const reason = current.blockedReason || 'unknown reason';
            vscode.window.showErrorMessage(`Governed run blocked: ${reason}`);
        }
        if (diff.turnCompleted && !(0, runTerminal_1.hasActiveGovernedRunTerminal)()) {
            const phase = payload.state?.phase || 'unknown';
            vscode.window.showInformationMessage(`Turn ${current.turnSequence} completed (phase: ${phase})`);
        }
    }
    dispose() {
        this.disposed = true;
        this.previous = null;
    }
}
exports.GovernedNotificationService = GovernedNotificationService;
//# sourceMappingURL=notifications.js.map