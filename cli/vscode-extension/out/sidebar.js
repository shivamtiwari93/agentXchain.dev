"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardViewProvider = void 0;
const util_1 = require("./util");
class DashboardViewProvider {
    view;
    root;
    extensionUri;
    constructor(extensionUri, root) {
        this.extensionUri = extensionUri;
        this.root = root;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this.updateContent();
    }
    refresh() {
        if (this.view) {
            this.updateContent();
        }
    }
    updateContent() {
        if (!this.view)
            return;
        const lock = (0, util_1.readJson)((0, util_1.lockPath)(this.root));
        const state = (0, util_1.readJson)((0, util_1.statePath)(this.root));
        const config = (0, util_1.readJson)((0, util_1.configPath)(this.root));
        this.view.webview.html = this.getHtml(lock, state, config);
    }
    getHtml(lock, state, config) {
        if (!lock || !config) {
            return `<!DOCTYPE html><html><body>
        <p style="padding:16px;color:#888;">No AgentXchain project found.<br>
        Run <code>npx agentxchain init</code> to get started.</p>
      </body></html>`;
        }
        const agentIds = Object.keys(config.agents);
        const holderDisplay = lock.holder
            ? lock.holder === 'human' ? 'HUMAN (you)' : `${lock.holder}`
            : 'FREE';
        const holderColor = lock.holder
            ? lock.holder === 'human' ? '#e8752a' : '#3a9ad9'
            : '#6bb536';
        const agentRows = agentIds.map(id => {
            const agent = config.agents[id];
            const isHolder = lock.holder === id;
            const dot = isHolder ? '●' : '○';
            const cls = isHolder ? 'active' : '';
            return `<div class="agent ${cls}"><span class="dot">${dot}</span> <strong>${id}</strong> <span class="dim">— ${agent.name}</span></div>`;
        }).join('\n');
        const phase = state?.phase || 'unknown';
        const blocked = state?.blocked ? `<div class="blocked">BLOCKED: ${state.blocked_on || 'unknown'}</div>` : '';
        return `<!DOCTYPE html>
<html>
<head><style>
  body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-size: 13px; }
  h2 { font-size: 14px; margin: 0 0 12px 0; font-weight: 600; }
  .section { margin-bottom: 16px; }
  .label { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .value { font-size: 14px; font-weight: 600; }
  .holder { color: ${holderColor}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 8px 10px; }
  .agent { padding: 4px 0; }
  .agent.active { color: var(--vscode-textLink-foreground); font-weight: 600; }
  .dot { font-size: 10px; }
  .dim { color: var(--vscode-descriptionForeground); }
  .blocked { background: rgba(232,117,42,0.15); border: 1px solid rgba(232,117,42,0.3); color: #e8752a; padding: 6px 10px; border-radius: 6px; font-weight: 600; margin-top: 8px; }
  .btn { display: inline-block; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; border: 1px solid var(--vscode-button-border); margin-right: 6px; margin-top: 8px; text-decoration: none; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style></head>
<body>
  <h2>AgentXchain</h2>

  <div class="section">
    <div class="label">Project</div>
    <div class="value">${escHtml(config.project)}</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Lock</div>
      <div class="value holder">${escHtml(holderDisplay)}</div>
    </div>
    <div class="card">
      <div class="label">Turn</div>
      <div class="value">${lock.turn_number}</div>
    </div>
    <div class="card">
      <div class="label">Phase</div>
      <div class="value">${escHtml(phase)}</div>
    </div>
    <div class="card">
      <div class="label">Last</div>
      <div class="value dim">${escHtml(lock.last_released_by || 'none')}</div>
    </div>
  </div>

  ${blocked}

  <div class="section" style="margin-top:16px;">
    <div class="label">Agents (${agentIds.length})</div>
    ${agentRows}
  </div>

  <div class="section">
    <div class="label">Quick actions</div>
    <a class="btn btn-primary" href="command:agentxchain.claim">Claim Lock</a>
    <a class="btn btn-secondary" href="command:agentxchain.release">Release Lock</a>
  </div>
</body>
</html>`;
    }
}
exports.DashboardViewProvider = DashboardViewProvider;
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
//# sourceMappingURL=sidebar.js.map