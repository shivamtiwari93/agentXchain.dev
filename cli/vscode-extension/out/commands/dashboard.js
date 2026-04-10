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
exports.openGovernedDashboard = openGovernedDashboard;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
const dashboardTerminal_1 = require("../dashboardTerminal");
async function openGovernedDashboard(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    if (surface.mode !== 'governed') {
        vscode.window.showWarningMessage('Dashboard launch is only available in governed mode.');
        return;
    }
    const result = (0, dashboardTerminal_1.launchGovernedDashboardTerminal)(root);
    if (result === 'reused') {
        vscode.window.showInformationMessage('Governed dashboard terminal is already active. Focused the existing terminal.');
        return;
    }
    vscode.window.showInformationMessage('Governed dashboard launched in the integrated terminal. The CLI will open the browser dashboard when the bridge is ready.');
}
//# sourceMappingURL=dashboard.js.map