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
exports.showReport = showReport;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
const governedStatus_1 = require("../governedStatus");
async function showReport(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    if (surface.mode !== 'governed') {
        vscode.window.showWarningMessage('Governance report is only available in governed mode.');
        return;
    }
    const channel = vscode.window.createOutputChannel('AgentXchain Report');
    channel.clear();
    channel.appendLine('AgentXchain Governance Report');
    channel.appendLine('─'.repeat(50));
    channel.appendLine('Loading report from CLI...');
    channel.show();
    let report;
    try {
        report = await (0, governedStatus_1.loadGovernedReport)(root);
    }
    catch (error) {
        channel.appendLine('');
        channel.appendLine(`Error: ${error instanceof Error ? error.message : 'Failed to load governance report.'}`);
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governance report.');
        return;
    }
    channel.clear();
    channel.appendLine('AgentXchain Governance Report');
    channel.appendLine('─'.repeat(50));
    for (const line of (0, governedStatus_1.renderReportLines)(report)) {
        channel.appendLine(line);
    }
    channel.show();
}
//# sourceMappingURL=report.js.map