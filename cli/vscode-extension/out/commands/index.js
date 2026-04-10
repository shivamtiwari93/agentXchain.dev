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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const claim_1 = require("./claim");
const release_1 = require("./release");
const status_1 = require("./status");
const generate_1 = require("./generate");
const init_1 = require("./init");
const approve_transition_1 = require("./approve-transition");
const approve_completion_1 = require("./approve-completion");
const step_1 = require("./step");
const run_1 = require("./run");
const report_1 = require("./report");
const restart_1 = require("./restart");
const dashboard_1 = require("./dashboard");
function registerCommands(context, root) {
    context.subscriptions.push(vscode.commands.registerCommand('agentxchain.init', () => (0, init_1.runInit)()), vscode.commands.registerCommand('agentxchain.generate', () => (0, generate_1.runGenerate)(root)), vscode.commands.registerCommand('agentxchain.claim', () => (0, claim_1.claimLock)(root)), vscode.commands.registerCommand('agentxchain.release', () => (0, release_1.releaseLock)(root)), vscode.commands.registerCommand('agentxchain.status', () => (0, status_1.showStatus)(root)), vscode.commands.registerCommand('agentxchain.approveTransition', () => (0, approve_transition_1.approvePhaseTransition)(root)), vscode.commands.registerCommand('agentxchain.approveCompletion', () => (0, approve_completion_1.approveRunCompletion)(root)), vscode.commands.registerCommand('agentxchain.step', () => (0, step_1.runGovernedStep)(root)), vscode.commands.registerCommand('agentxchain.run', () => (0, run_1.runGovernedRun)(root)), vscode.commands.registerCommand('agentxchain.report', () => (0, report_1.showReport)(root)), vscode.commands.registerCommand('agentxchain.restart', () => (0, restart_1.restartGovernedRun)(root)), vscode.commands.registerCommand('agentxchain.openDashboard', () => (0, dashboard_1.openGovernedDashboard)(root)));
}
//# sourceMappingURL=index.js.map