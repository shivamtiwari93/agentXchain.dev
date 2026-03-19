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
exports.releaseLock = releaseLock;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
function releaseLock(root) {
    const lp = (0, util_1.lockPath)(root);
    const lock = (0, util_1.readJson)(lp);
    if (!lock) {
        vscode.window.showErrorMessage('lock.json not found.');
        return;
    }
    if (!lock.holder) {
        vscode.window.showInformationMessage('Lock is already free.');
        return;
    }
    const who = lock.holder;
    const newLock = {
        holder: null,
        last_released_by: who,
        turn_number: who === 'human' ? lock.turn_number : lock.turn_number + 1,
        claimed_at: null
    };
    (0, util_1.writeJson)(lp, newLock);
    vscode.window.showInformationMessage(`Lock released by ${who} (turn ${newLock.turn_number}). Agents can resume.`);
}
//# sourceMappingURL=release.js.map