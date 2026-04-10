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
exports.runGenerate = runGenerate;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
function runGenerate(root) {
    const surface = (0, util_1.getProjectSurface)(root);
    if (!surface.config) {
        vscode.window.showErrorMessage('No agentxchain.json found.');
        return;
    }
    if (surface.mode === 'governed') {
        vscode.window.showWarningMessage(`${util_1.GOVERNED_MODE_NOTICE} The Generate command only scaffolds legacy IDE agent files.`);
        return;
    }
    const terminal = vscode.window.createTerminal({ name: 'AgentXchain', cwd: root });
    terminal.show();
    terminal.sendText('npx --yes -p agentxchain@latest -c "agentxchain generate"');
}
//# sourceMappingURL=generate.js.map