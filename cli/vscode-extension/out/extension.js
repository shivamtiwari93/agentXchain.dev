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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const index_1 = require("./commands/index");
const statusBar_1 = require("./statusBar");
const fileWatcher_1 = require("./fileWatcher");
const sidebar_1 = require("./sidebar");
const notifications_1 = require("./notifications");
function activate(context) {
    const root = findProjectRoot();
    if (!root) {
        return;
    }
    (0, index_1.registerCommands)(context, root);
    const statusBar = (0, statusBar_1.createStatusBar)(context, root);
    const watchers = (0, fileWatcher_1.createFileWatchers)(context, root, statusBar);
    const dashboardProvider = new sidebar_1.DashboardViewProvider(context.extensionUri, root);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('agentxchain.dashboard', dashboardProvider));
    const notificationService = new notifications_1.GovernedNotificationService(root);
    context.subscriptions.push({ dispose: () => notificationService.dispose() });
    // Seed notification baseline from current state (no notifications on activation)
    void notificationService.check();
    watchers.onStateChange(() => {
        dashboardProvider.refresh();
        void notificationService.check();
    });
    statusBar.refresh();
}
function deactivate() { }
function findProjectRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0)
        return null;
    for (const folder of folders) {
        const cfgPath = path.join(folder.uri.fsPath, 'agentxchain.json');
        if (fs.existsSync(cfgPath)) {
            return folder.uri.fsPath;
        }
    }
    return folders[0].uri.fsPath;
}
//# sourceMappingURL=extension.js.map