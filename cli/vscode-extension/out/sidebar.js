"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardViewProvider = void 0;
const util_1 = require("./util");
const governedStatus_1 = require("./governedStatus");
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
        void this.updateContent();
    }
    refresh() {
        if (this.view) {
            void this.updateContent();
        }
    }
    async updateContent() {
        if (!this.view)
            return;
        this.view.webview.html = await this.getHtml((0, util_1.getProjectSurface)(this.root));
    }
    async getHtml(surface) {
        if (!surface.config) {
            return `<!DOCTYPE html><html><body>
        <p style="padding:16px;color:#888;">No AgentXchain project found.<br>
        Run <code>npm install -g agentxchain</code> then <code>agentxchain init</code> to get started.</p>
      </body></html>`;
        }
        if (surface.mode === 'governed') {
            return this.getGovernedHtml(surface);
        }
        if (!surface.lock) {
            return `<!DOCTYPE html><html><body>
        <p style="padding:16px;color:#888;">Legacy AgentXchain project detected, but <code>lock.json</code> is missing.</p>
      </body></html>`;
        }
        return this.getLegacyHtml(surface);
    }
    async getGovernedHtml(surface) {
        try {
            const payload = await (0, governedStatus_1.loadGovernedStatus)(this.root);
            return (0, governedStatus_1.renderGovernedStatusHtml)(payload, util_1.GOVERNED_MODE_NOTICE);
        }
        catch (error) {
            const projectName = (0, util_1.getProjectName)(surface.config);
            const blockedDetail = (0, util_1.getBlockedDetail)(surface.state);
            const blocked = blockedDetail
                ? `<div style="margin-top:12px;padding:8px 10px;border-radius:6px;background:rgba(232,117,42,0.15);border:1px solid rgba(232,117,42,0.3);color:#e8752a;font-weight:600;">BLOCKED: ${escHtml(blockedDetail)}</div>`
                : '';
            return `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-size: 13px;">
        <h2 style="font-size:14px;margin:0 0 12px 0;">AgentXchain</h2>
        <div style="margin-bottom:12px;"><strong>${escHtml(projectName)}</strong></div>
        <div style="padding:8px 10px;border-radius:6px;background:rgba(232,190,64,0.12);border:1px solid rgba(232,190,64,0.28);line-height:1.45;">
          ${escHtml(error instanceof Error ? error.message : 'Failed to load governed status.')}
        </div>
        ${blocked}
        <div style="margin-top:12px;padding:8px 10px;border-radius:6px;background:rgba(58,154,217,0.12);border:1px solid rgba(58,154,217,0.25);line-height:1.45;">
          ${escHtml(util_1.GOVERNED_MODE_NOTICE)}
        </div>
      </body></html>`;
        }
    }
    getLegacyHtml(surface) {
        const projectName = (0, util_1.getProjectName)(surface.config);
        const phase = surface.state?.phase || 'unknown';
        const actorMap = Object.fromEntries((0, util_1.getProjectActors)(surface.config).map(actor => [actor.id, actor]));
        const agentIds = Object.keys(actorMap);
        const holderDisplay = surface.lock?.holder
            ? surface.lock.holder === 'human' ? 'HUMAN (you)' : `${surface.lock.holder}`
            : 'FREE';
        const holderColor = surface.lock?.holder
            ? surface.lock.holder === 'human' ? '#e8752a' : '#3a9ad9'
            : '#6bb536';
        const agentRows = agentIds.map(id => {
            const agent = actorMap[id];
            const isHolder = surface.lock?.holder === id;
            const dot = isHolder ? '●' : '○';
            const cls = isHolder ? 'active' : '';
            return `<div class="agent ${cls}"><span class="dot">${dot}</span> <strong>${escHtml(id)}</strong> <span class="dim">— ${escHtml(agent.name)}</span></div>`;
        }).join('\n');
        const blocked = surface.state?.blocked
            ? `<div class="blocked">BLOCKED: ${escHtml(surface.state.blocked_on || 'unknown')}</div>`
            : '';
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
    <div class="value">${escHtml(projectName)}</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Lock</div>
      <div class="value holder">${escHtml(holderDisplay)}</div>
    </div>
    <div class="card">
      <div class="label">Turn</div>
      <div class="value">${surface.lock?.turn_number ?? 0}</div>
    </div>
    <div class="card">
      <div class="label">Phase</div>
      <div class="value">${escHtml(phase)}</div>
    </div>
    <div class="card">
      <div class="label">Last</div>
      <div class="value dim">${escHtml(surface.lock?.last_released_by || 'none')}</div>
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
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
//# sourceMappingURL=sidebar.js.map