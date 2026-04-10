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
exports.runGovernedStep = runGovernedStep;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
const governedStatus_1 = require("../governedStatus");
async function runGovernedStep(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    if (surface.mode !== 'governed') {
        vscode.window.showWarningMessage('Governed step dispatch is only available in governed mode.');
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
    const stepAction = (0, governedStatus_1.getGovernedStepAction)(payload);
    if (!stepAction) {
        if (payload.state?.pending_phase_transition || payload.state?.pending_run_completion) {
            vscode.window.showInformationMessage('Approve the pending governed gate before dispatching another step.');
            return;
        }
        const recommended = payload.continuity?.recommended_command;
        if (recommended) {
            vscode.window.showWarningMessage(`The current governed recovery action is "${recommended}". Use the CLI or dashboard if you need a non-step recovery flow.`);
            return;
        }
        vscode.window.showInformationMessage('No governed step is currently available for this run.');
        return;
    }
    const terminal = vscode.window.createTerminal({
        name: stepAction.label === 'Resume Step' ? 'AgentXchain Resume' : 'AgentXchain Step',
        cwd: root,
        env: { NO_COLOR: '1' },
    });
    terminal.show();
    terminal.sendText((0, governedStatus_1.buildCliShellCommand)(stepAction.cliArgs), true);
    vscode.window.showInformationMessage(`${stepAction.label} launched in the integrated terminal.`);
}
//# sourceMappingURL=step.js.map