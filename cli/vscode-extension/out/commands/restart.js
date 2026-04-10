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
exports.restartGovernedRun = restartGovernedRun;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
const governedStatus_1 = require("../governedStatus");
async function restartGovernedRun(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    if (surface.mode !== 'governed') {
        vscode.window.showWarningMessage('Governed restart is only available in governed mode.');
        return;
    }
    let recommendedDetail = 'This will reconnect or reactivate the governed run from durable checkpoint state.';
    let cliArgs = ['restart'];
    try {
        const payload = await (0, governedStatus_1.loadGovernedStatus)(root);
        const recommendedArgs = (0, governedStatus_1.parseRecommendedRestartArgs)(payload.continuity?.recommended_command);
        if (recommendedArgs) {
            cliArgs = recommendedArgs;
        }
        if (payload.continuity?.recommended_detail) {
            recommendedDetail = payload.continuity.recommended_detail;
        }
    }
    catch {
        // Restart remains available even when status loading fails.
    }
    const confirm = await vscode.window.showWarningMessage(`Restart the governed session? ${recommendedDetail}`, { modal: true }, 'Restart');
    if (confirm !== 'Restart') {
        return;
    }
    try {
        const { stdout } = await (0, governedStatus_1.execCliCommand)(root, cliArgs, 120_000);
        const channel = vscode.window.createOutputChannel('AgentXchain Restart');
        channel.clear();
        channel.appendLine('Governed Restart');
        channel.appendLine('─'.repeat(40));
        channel.appendLine(stdout.trim());
        channel.show(true);
        vscode.window.showInformationMessage('Governed restart completed. Review the recovery output for the next action.');
    }
    catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Governed restart failed.');
    }
}
//# sourceMappingURL=restart.js.map