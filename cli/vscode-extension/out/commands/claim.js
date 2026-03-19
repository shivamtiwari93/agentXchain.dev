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
exports.claimLock = claimLock;
const vscode = __importStar(require("vscode"));
const util_1 = require("../util");
function claimLock(root) {
    const lp = (0, util_1.lockPath)(root);
    const lock = (0, util_1.readJson)(lp);
    if (!lock) {
        vscode.window.showErrorMessage('lock.json not found. Run AgentXchain: Init first.');
        return;
    }
    if (lock.holder === 'human') {
        vscode.window.showInformationMessage('You already hold the lock. Use Release when done.');
        return;
    }
    if (lock.holder) {
        const agent = lock.holder;
        vscode.window.showWarningMessage(`Lock held by "${agent}". Force-claim?`, 'Force Claim', 'Cancel').then(choice => {
            if (choice === 'Force Claim') {
                writeClaim(lp, lock);
            }
        });
        return;
    }
    writeClaim(lp, lock);
}
function writeClaim(lp, lock) {
    const newLock = {
        holder: 'human',
        last_released_by: lock.last_released_by,
        turn_number: lock.turn_number,
        claimed_at: new Date().toISOString()
    };
    (0, util_1.writeJson)(lp, newLock);
    vscode.window.showInformationMessage(`Lock claimed by human (turn ${lock.turn_number}). Agents paused.`);
}
//# sourceMappingURL=claim.js.map