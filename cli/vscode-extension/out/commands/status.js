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
exports.showStatus = showStatus;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
const governedStatus_1 = require("../governedStatus");
async function showStatus(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    const { config, lock, state, mode } = surface;
    if (!config) {
        vscode.window.showErrorMessage('AgentXchain project files not found.');
        return;
    }
    const actors = (0, util_1.getProjectActors)(config);
    const channel = vscode.window.createOutputChannel('AgentXchain');
    channel.clear();
    channel.appendLine('AgentXchain Status');
    channel.appendLine('─'.repeat(40));
    if (mode === 'governed') {
        try {
            const payload = await (0, governedStatus_1.loadGovernedStatus)(root);
            for (const line of (0, governedStatus_1.renderGovernedStatusLines)(payload)) {
                channel.appendLine(line);
            }
            channel.show();
        }
        catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governed status.');
        }
        return;
    }
    if (!lock) {
        vscode.window.showErrorMessage('Legacy AgentXchain lock.json not found.');
        return;
    }
    const holderDisplay = lock.holder
        ? lock.holder === 'human'
            ? 'HUMAN (you)'
            : `${lock.holder} (${actors.find(actor => actor.id === lock.holder)?.name || lock.holder})`
        : 'FREE';
    const lines = [
        `Project: ${(0, util_1.getProjectName)(config)}`,
        'Mode: Legacy lock-based coordination',
        `Phase: ${state?.phase || 'unknown'}`,
        `Lock: ${holderDisplay}`,
        `Turn: ${lock.turn_number}`,
        `Last released by: ${lock.last_released_by || 'none'}`,
        `Blocked: ${state?.blocked ? `YES — ${state.blocked_on}` : 'No'}`,
        '',
        `Agents (${actors.length}):`,
        ...actors.map(actor => {
            const marker = lock.holder === actor.id ? '● ' : '○ ';
            return `  ${marker}${actor.id} — ${actor.name}`;
        })
    ];
    lines.forEach(l => channel.appendLine(l));
    channel.show();
}
//# sourceMappingURL=status.js.map