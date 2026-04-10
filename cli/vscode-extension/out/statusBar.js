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
exports.createStatusBar = createStatusBar;
const vscode = __importStar(require("vscode"));
const util_1 = require("./util");
const governedStatus_1 = require("./governedStatus");
function createStatusBar(context, root) {
    const item = vscode.window.createStatusBarItem('agentxchain.status', vscode.StatusBarAlignment.Left, 50);
    item.command = 'agentxchain.status';
    item.tooltip = 'AgentXchain — click for status';
    context.subscriptions.push(item);
    async function refreshAsync() {
        const surface = (0, util_1.getProjectSurface)(root);
        const { config, state, lock, mode } = surface;
        if (!config) {
            item.text = '$(warning) AXC: no project';
            item.tooltip = 'No AgentXchain project detected in this workspace.';
            item.show();
            return;
        }
        if (mode === 'governed') {
            try {
                const payload = await (0, governedStatus_1.loadGovernedStatus)(root);
                const model = (0, governedStatus_1.summarizeGovernedStatus)(payload);
                item.text = model.text;
                item.tooltip = model.tooltip;
                item.backgroundColor = mapToneToBackground(model.tone);
            }
            catch (error) {
                const fallbackBlocked = (0, util_1.getBlockedDetail)(state);
                const message = error instanceof Error ? error.message : 'Unable to load governed status.';
                const phase = state?.phase || 'unknown';
                const status = state?.status || 'idle';
                item.text = `$(warning) AXC: governed | ${phase} | ${status}`;
                item.tooltip = `${(0, util_1.getProjectName)(config)}\n${message}\n${util_1.GOVERNED_MODE_NOTICE}`;
                item.backgroundColor = fallbackBlocked
                    ? new vscode.ThemeColor('statusBarItem.errorBackground')
                    : new vscode.ThemeColor('statusBarItem.warningBackground');
            }
            item.show();
            return;
        }
        if (!lock) {
            item.text = '$(warning) AXC: legacy lock missing';
            item.tooltip = 'Legacy AgentXchain project detected, but lock.json is missing.';
            item.show();
            return;
        }
        if (lock.holder === 'human') {
            item.text = `$(person) AXC: HUMAN Turn ${lock.turn_number}`;
            item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else if (lock.holder) {
            item.text = `$(sync~spin) AXC: ${lock.holder} Turn ${lock.turn_number}`;
            item.backgroundColor = undefined;
        }
        else {
            item.text = `$(check) AXC: FREE Turn ${lock.turn_number}`;
            item.backgroundColor = undefined;
        }
        if (state?.phase) {
            item.text += ` | ${state.phase}`;
        }
        item.tooltip = `${(0, util_1.getProjectName)(config)}\nLegacy lock-based coordination mode`;
        item.show();
    }
    function refresh() {
        void refreshAsync();
    }
    refresh();
    return {
        refresh,
        dispose: () => item.dispose()
    };
}
function mapToneToBackground(tone) {
    if (tone === 'warning') {
        return new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    if (tone === 'error') {
        return new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    return undefined;
}
//# sourceMappingURL=statusBar.js.map