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
exports.approveRunCompletion = approveRunCompletion;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
const governedStatus_1 = require("../governedStatus");
async function approveRunCompletion(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    if (surface.mode !== 'governed') {
        vscode.window.showWarningMessage('Run completion approval is only available in governed mode.');
        return;
    }
    // Check current status for pending completion before prompting
    let payload;
    try {
        payload = await (0, governedStatus_1.loadGovernedStatus)(root);
    }
    catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governed status.');
        return;
    }
    const pending = payload.state?.pending_run_completion;
    if (!pending) {
        vscode.window.showInformationMessage('No pending run completion to approve.');
        return;
    }
    const gate = pending.gate || 'unknown gate';
    const phase = payload.state?.phase || 'unknown';
    const confirm = await vscode.window.showWarningMessage(`Approve run completion? Phase: ${phase}, gate: ${gate}`, { modal: true }, 'Approve');
    if (confirm !== 'Approve') {
        return;
    }
    try {
        const { stdout } = await (0, governedStatus_1.execCliCommand)(root, ['approve-completion'], 120_000);
        vscode.window.showInformationMessage('Run completion approved.');
        const channel = vscode.window.createOutputChannel('AgentXchain');
        channel.clear();
        channel.appendLine('Run Completion Approved');
        channel.appendLine('\u2500'.repeat(40));
        channel.appendLine(stdout.trim());
        channel.show(true);
    }
    catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Run completion approval failed.');
    }
}
//# sourceMappingURL=approve-completion.js.map