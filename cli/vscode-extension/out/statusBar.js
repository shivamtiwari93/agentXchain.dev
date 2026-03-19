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
function createStatusBar(context, root) {
    const item = vscode.window.createStatusBarItem('agentxchain.status', vscode.StatusBarAlignment.Left, 50);
    item.command = 'agentxchain.status';
    item.tooltip = 'AgentXchain — click for status';
    context.subscriptions.push(item);
    function refresh() {
        const lock = (0, util_1.readJson)((0, util_1.lockPath)(root));
        const state = (0, util_1.readJson)((0, util_1.statePath)(root));
        const config = (0, util_1.readJson)((0, util_1.configPath)(root));
        if (!lock || !config) {
            item.text = '$(warning) AXC: no project';
            item.show();
            return;
        }
        const turn = lock.turn_number;
        if (lock.holder === 'human') {
            item.text = `$(person) AXC: HUMAN Turn ${turn}`;
            item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else if (lock.holder) {
            const name = config.agents[lock.holder]?.name || lock.holder;
            item.text = `$(sync~spin) AXC: ${lock.holder} Turn ${turn}`;
            item.backgroundColor = undefined;
        }
        else {
            item.text = `$(check) AXC: FREE Turn ${turn}`;
            item.backgroundColor = undefined;
        }
        if (state?.phase) {
            item.text += ` | ${state.phase}`;
        }
        item.show();
    }
    refresh();
    return {
        refresh,
        dispose: () => item.dispose()
    };
}
//# sourceMappingURL=statusBar.js.map