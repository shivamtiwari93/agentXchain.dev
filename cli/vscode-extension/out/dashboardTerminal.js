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
exports.launchGovernedDashboardTerminal = launchGovernedDashboardTerminal;
const vscode = __importStar(require("vscode"));
const governedStatus_1 = require("./governedStatus");
const GOVERNED_DASHBOARD_TERMINAL_NAME = 'AgentXchain Dashboard';
function launchGovernedDashboardTerminal(root) {
    const existing = findActiveGovernedDashboardTerminal();
    if (existing) {
        existing.show();
        return 'reused';
    }
    const terminal = vscode.window.createTerminal({
        name: GOVERNED_DASHBOARD_TERMINAL_NAME,
        cwd: root,
        env: { NO_COLOR: '1' },
    });
    terminal.show();
    terminal.sendText((0, governedStatus_1.buildCliShellCommand)(['dashboard']), true);
    return 'launched';
}
function findActiveGovernedDashboardTerminal() {
    for (const terminal of vscode.window.terminals) {
        if (terminal.name === GOVERNED_DASHBOARD_TERMINAL_NAME && terminal.exitStatus == null) {
            return terminal;
        }
    }
    return null;
}
//# sourceMappingURL=dashboardTerminal.js.map