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
exports.GOVERNED_MODE_NOTICE = void 0;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.lockPath = lockPath;
exports.statePath = statePath;
exports.configPath = configPath;
exports.detectProjectMode = detectProjectMode;
exports.getProjectSurface = getProjectSurface;
exports.getProjectName = getProjectName;
exports.getProjectActors = getProjectActors;
exports.getBlockedDetail = getBlockedDetail;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.GOVERNED_MODE_NOTICE = 'Governed project detected. This extension supports phase transition and run completion approvals via CLI subprocess calls. Use agentxchain step, agentxchain dashboard, or the browser dashboard for additional governed operations.';
function readJson(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}
function lockPath(root) {
    return path.join(root, 'lock.json');
}
function statePath(root, mode = 'legacy') {
    if (mode === 'governed') {
        return path.join(root, '.agentxchain', 'state.json');
    }
    return path.join(root, 'state.json');
}
function configPath(root) {
    return path.join(root, 'agentxchain.json');
}
function detectProjectMode(root, config) {
    const resolvedConfig = config ?? readJson(configPath(root));
    const hasGovernedState = fs.existsSync(statePath(root, 'governed'));
    const hasLegacyLock = fs.existsSync(lockPath(root));
    const hasLegacyState = fs.existsSync(statePath(root, 'legacy'));
    if (resolvedConfig && isGovernedConfig(resolvedConfig)) {
        return 'governed';
    }
    if (hasGovernedState) {
        return 'governed';
    }
    if (resolvedConfig && isLegacyConfig(resolvedConfig)) {
        return 'legacy';
    }
    if (hasLegacyLock || hasLegacyState) {
        return 'legacy';
    }
    return 'unknown';
}
function getProjectSurface(root) {
    const config = readJson(configPath(root));
    const mode = detectProjectMode(root, config);
    const state = readJson(statePath(root, mode === 'governed' ? 'governed' : 'legacy'));
    const lock = mode === 'legacy' ? readJson(lockPath(root)) : null;
    return { mode, config, state, lock };
}
function getProjectName(config) {
    if (!config)
        return 'Unknown';
    if (isLegacyConfig(config)) {
        return config.project;
    }
    return config.project?.name || config.project?.id || 'Unknown';
}
function getProjectActors(config) {
    if (!config) {
        return [];
    }
    if (isLegacyConfig(config)) {
        return Object.entries(config.agents || {}).map(([id, agent]) => ({
            id,
            name: agent.name || id,
        }));
    }
    return Object.entries(config.roles || {}).map(([id, role]) => ({
        id,
        name: role.title || role.mandate || id,
    }));
}
function getBlockedDetail(state) {
    if (!state)
        return null;
    return state.blocked_on || state.blocked_reason || null;
}
function isLegacyConfig(config) {
    return typeof config.project === 'string'
        || typeof config.version === 'number'
        || !!config.agents;
}
function isGovernedConfig(config) {
    return typeof config.schema_version === 'string'
        || typeof config.schema_version === 'number'
        || !!config.roles
        || config.compat?.lock_based_coordination === false;
}
//# sourceMappingURL=util.js.map