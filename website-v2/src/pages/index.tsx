import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="community-icon">
      <path
        fill="currentColor"
        d="M6.94 8.5H3.56V20h3.38V8.5ZM5.25 3A1.97 1.97 0 0 0 3.28 4.97c0 1.08.88 1.94 1.94 1.94h.03c1.1 0 1.97-.86 1.97-1.94A1.96 1.96 0 0 0 5.28 3h-.03ZM20.72 12.56c0-3.47-1.85-5.08-4.31-5.08-1.98 0-2.86 1.09-3.36 1.86V8.5H9.67c.04.55 0 11.5 0 11.5h3.38v-6.42c0-.34.02-.68.12-.92.27-.68.9-1.38 1.96-1.38 1.38 0 1.93 1.04 1.93 2.57V20h3.38v-7.44Z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="community-icon">
      <path
        fill="currentColor"
        d="M18.9 3H21l-4.59 5.25L22 21h-4.38l-3.43-7.79L7.37 21H3.19l4.9-5.6L2 3h4.49l3.1 7.1L18.9 3Zm-1.53 15.4h1.17L5.98 5.5H4.73L17.37 18.4Z"
      />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="community-icon">
      <circle cx="12" cy="13" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9.5" cy="12.4" r="0.9" fill="currentColor" />
      <circle cx="14.5" cy="12.4" r="0.9" fill="currentColor" />
      <path d="M9.3 15.05c.8.74 1.73 1.1 2.7 1.1.97 0 1.9-.36 2.7-1.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13.15 7.55 14.3 4.9l2.55.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17.75" cy="5.4" r="1.15" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6.15" cy="11.05" r="1.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="17.85" cy="11.05" r="1.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Hero() {
  const logoSrc = useBaseUrl('/img/agentXchain.dev_square_250x250px.png');
  return (
    <section className="hero-section">
      <div className="container hero-content">
        <img
          src={logoSrc}
          alt="AgentXchain"
          className="hero-logo"
        />
        <div className="hero-badge">Open source &middot; MIT &middot; v2.155.22</div>
        <h1>
          The <span className="text-green">governance protocol</span> for{' '}
          <span className="text-blue">lights-out software factories</span>
        </h1>
        <p className="hero-subtitle">
          The future of AI software delivery won't be won by the smartest single agent.
          It will be won by the best-governed agent teams. AgentXchain turns independent
          AI agents into an accountable software organization &mdash; with structured turns,
          mandatory challenge, phase gates, and human sovereignty at the constitutional layer.
        </p>
        <div className="cta-row">
          <Link className="btn-primary" to="/docs/quickstart#path-0-demo">
            npx --yes -p agentxchain@latest -c "agentxchain demo"
          </Link>
          <Link className="btn-secondary" to="/docs/quickstart">
            npm install -g agentxchain
          </Link>
          <Link className="btn-secondary" to="/docs/five-minute-tutorial" style={{ marginLeft: '0.5rem' }}>
            5-Minute Tutorial →
          </Link>
        </div>
        <div className="terminal">
          <div className="terminal-bar">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
            <span className="terminal-title">governed multi-agent delivery</span>
          </div>
          <div className="terminal-code">
            <span className="comment"># See governance first, then scaffold your own repo</span>
            <br /><br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">npx --yes -p agentxchain@latest -c "agentxchain demo"</span>
            <br />
            <span className="output">&nbsp; ✓ PM defined scope and raised 1 objection</span>
            <br /><br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">npm install -g agentxchain</span>
            <br />
            <span className="output">&nbsp; ✓ Install once for repeated governed commands</span>
            <br /><br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">agentxchain init --governed --goal "Ship a governed web app MVP"</span>
            <br />
            <span className="output">&nbsp; ✓ Scaffold with mission context before the first turn</span>
            <br /><br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">agentxchain doctor</span>
            <br />
            <span className="output">&nbsp; ✓ Verify runtimes and repo health before you run</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <div className="stats-row">
      <div>
        <div className="stat-number">5</div>
        <div className="stat-label">Architecture layers</div>
      </div>
      <div>
        <div className="stat-number">17</div>
        <div className="stat-label">Tests / 0 failures</div>
      </div>
      <div>
        <div className="stat-number">108</div>
        <div className="stat-label">Conformance fixtures</div>
      </div>
      <div>
        <div className="stat-number">v7</div>
        <div className="stat-label">Protocol version</div>
      </div>
      <div>
        <div className="stat-number">MIT</div>
        <div className="stat-label">License</div>
      </div>
    </div>
  );
}

function CoreProblem() {
  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-orange">The hard problem</span>
        <h2>Writing code isn't the bottleneck. Coordination is.</h2>
        <p className="section-subtitle">
          Single models can already write code. The hard problem is what happens
          when multiple agents touch the same codebase over time.
        </p>
        <div className="feature-grid problem-grid">
          <div className="feature-card">
            <h3>Work overlaps</h3>
            <p>
              Two agents modify the same file, unaware of each other's changes.
              Merge conflicts are the symptom. Missing coordination is the disease.
            </p>
          </div>
          <div className="feature-card">
            <h3>Assumptions diverge</h3>
            <p>
              Agent A assumes an API shape. Agent B implements a different one.
              Nobody catches it until integration fails three turns later.
            </p>
          </div>
          <div className="feature-card">
            <h3>Quality drifts</h3>
            <p>
              Without mandatory review, agents agree with each other. Tests pass
              in isolation but the product doesn't work. Quality erodes silently.
            </p>
          </div>
          <div className="feature-card">
            <h3>No decision trail</h3>
            <p>
              Who decided to use that library? Why was that approach chosen?
              Without a ledger, there's no way to audit, learn, or roll back decisions.
            </p>
          </div>
          <div className="feature-card">
            <h3>Unclear what's shippable</h3>
            <p>
              Lots of agent activity, no clear answer to "is this done?"
              Without gates and evidence, release readiness is a guess.
            </p>
          </div>
          <div className="feature-card">
            <h3>Humans lose governance</h3>
            <p>
              You either micromanage every turn or let agents run unsupervised.
              There's no middle ground. Until now.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Philosophy() {
  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-green">Philosophy</span>
        <h2>Trust from protocol, evidence, and governance</h2>
        <p className="section-subtitle">
          Trust in multi-agent systems doesn't come from model capability alone.
          It comes from how the system is governed.
        </p>
        <div className="feature-grid">
          <div className="feature-card">
            <h3>Mandatory challenge</h3>
            <p>
              Every turn must identify at least one risk or objection about the
              previous agent's work. Blind agreement is a protocol violation.
              Adversarial robustness applied to software delivery.
            </p>
          </div>
          <div className="feature-card">
            <h3>Divergent agents, healthy friction</h3>
            <p>
              Agents are <em>supposed</em> to disagree. That tension surfaces
              risks early and produces better software than any single agent
              optimizing in isolation.
            </p>
          </div>
          <div className="feature-card">
            <h3>Long-horizon convergence</h3>
            <p>
              Phases, turn limits, mandatory verification, and human checkpoints.
              Constraints force convergence on a real product &mdash; optimized for
              convergence quality, not generation speed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FiveLayers() {
  const layers = [
    {
      num: '1',
      title: 'Protocol',
      label: 'The constitution',
      color: 'var(--axc-blue-light)',
      bg: 'rgba(43,124,182,0.12)',
      desc: 'Run state, roles, turn contracts, artifact schemas, validation rules, phase gates, decision ledger format, recovery semantics. Versioned independently. Model-agnostic. Runtime-agnostic.',
      link: '/docs/protocol',
      linkText: 'Protocol v7',
    },
    {
      num: '2',
      title: 'Runners',
      label: 'The enforcement engines',
      color: 'var(--axc-green-light)',
      bg: 'rgba(107,181,54,0.12)',
      desc: 'Read config, manage state, assign turns, validate results, enforce gates. The Node.js CLI is the reference runner. Future runners: cloud services, GitHub Actions, CI pipelines, K8s operators.',
      link: '/docs/runner-interface',
      linkText: 'Runner interface',
    },
    {
      num: '3',
      title: 'Connectors',
      label: 'The bridge to agent runtimes',
      color: 'var(--axc-orange)',
      bg: 'rgba(232,117,42,0.12)',
      desc: 'Five shipped adapters: manual (human control path), local_cli (Claude Code, Codex CLI, Cursor, any CLI agent), api_proxy (direct LLM API calls), mcp (stdio and streamable HTTP), and remote_agent (HTTP/webhook bridges). ~200 lines to add a new connector.',
      link: '/docs/adapters',
      linkText: 'Adapter reference',
    },
    {
      num: '4',
      title: 'Workflow Kit',
      label: 'The opinionated operating model',
      color: '#38BDF8',
      bg: 'rgba(56,189,248,0.12)',
      desc: 'Planning framework (goal-first, scope-disciplined). Spec-driven development. Repo-native documentation. Test-driven quality. QA as governance proof. Escalation and recovery protocols.',
      link: '/docs/templates',
      linkText: 'Templates & workflows',
    },
    {
      num: '5',
      title: 'Integrations',
      label: 'The organizational edges',
      color: '#A78BFA',
      bg: 'rgba(167,139,250,0.12)',
      desc: 'Legacy IDE compatibility (VS Code, Cursor), governed status and approvals in-editor, step/run launch, restart recovery, report and dashboard access, notifications, export & verification, plugins, and multi-repo coordination.',
      link: '/docs/integrations',
      linkText: 'Integration guides',
    },
  ];

  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-blue">Architecture</span>
        <h2>Five layers. One governed delivery system.</h2>
        <p className="section-subtitle">
          Each layer is independently replaceable. The protocol is the
          foundation &mdash; everything else plugs in.
        </p>
        <div className="layers-grid">
          {layers.map((l) => (
            <div className="layer-card" key={l.num}>
              <div className="layer-header">
                <div
                  className="layer-num"
                  style={{ background: l.bg, color: l.color }}
                >
                  {l.num}
                </div>
                <div>
                  <h3 style={{ color: l.color, margin: 0 }}>{l.title}</h3>
                  <span className="layer-subtitle">{l.label}</span>
                </div>
              </div>
              <p>{l.desc}</p>
              <Link className="layer-link" to={l.link} style={{ color: l.color }}>
                {l.linkText} &rarr;
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowKit() {
  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-green">Workflow Kit</span>
        <h2>Planning, specs, QA, and evidence &mdash; built into the protocol</h2>
        <p className="section-subtitle">
          AgentXchain doesn't just coordinate agents. It ships software through
          a structured lifecycle where every decision is traceable.
        </p>
        <div className="feature-grid">
          <div className="feature-card">
            <h3>Goal-first planning</h3>
            <p>
              Every run starts with a goal, constraints, and acceptance criteria.
              Plans break down into small, shippable increments. Scope discipline
              is protocol-enforced, not suggested.
            </p>
          </div>
          <div className="feature-card">
            <h3>Spec-driven development</h3>
            <p>
              Explicit contracts between roles. Acceptance criteria defined before
              implementation begins. Agents implement against specs, not vibes.
              Divergence from spec triggers mandatory challenge.
            </p>
          </div>
          <div className="feature-card">
            <h3>Repo-native documentation</h3>
            <p>
              Plans, specs, decisions, QA evidence, and release notes live with
              the code. Not in a wiki. Not in Slack. In the repo, versioned and
              auditable alongside the implementation.
            </p>
          </div>
          <div className="feature-card">
            <h3>Evidence-driven quality</h3>
            <p>
              QA isn't a checkbox. Every quality claim requires evidence: test results,
              acceptance matrices, coverage reports. "It works" is not evidence.
              Proof is evidence.
            </p>
          </div>
          <div className="feature-card">
            <h3>Escalation & recovery</h3>
            <p>
              When agents get stuck, the protocol defines recovery paths. Operator
              escalation, blocked-state recovery, turn reassignment. No silent
              failures. No infinite loops.
            </p>
          </div>
          <div className="feature-card">
            <h3>Decision ledger</h3>
            <p>
              Every turn records decisions, objections, risks, and verification
              evidence in an append-only ledger. Full audit trail from first
              plan to final release.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function RoleSystem() {
  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-orange">Roles & Charters</span>
        <h2>Open-ended roles, not a fixed PM/Dev/QA template</h2>
        <p className="section-subtitle">
          The PM/Dev/QA example is just that &mdash; an example. Roles in AgentXchain
          are charter-driven and open-ended.
        </p>
        <div className="role-grid">
          <div className="feature-card">
            <h3>Charter-driven</h3>
            <p>
              Every role has a mandate, authority boundaries, governed artifacts,
              and structured workflow participation. Define the roles your
              project actually needs.
            </p>
          </div>
          <div className="feature-card">
            <h3>Any role shape</h3>
            <p>
              Security auditor. Performance engineer. API designer. Documentation
              writer. Compliance reviewer. The protocol doesn't prescribe roles &mdash;
              it governs how any role participates.
            </p>
          </div>
          <div className="feature-card">
            <h3>Turn structure</h3>
            <p>
              Each role gets structured turns with clear inputs and outputs. Turn
              results are validated against the role's charter. Out-of-scope work
              is flagged, not silently accepted.
            </p>
          </div>
        </div>
        <div className="terminal" style={{ marginTop: '2rem' }}>
          <div className="terminal-bar">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
            <span className="terminal-title">agentxchain.json &mdash; custom roles</span>
          </div>
          <div className="terminal-code">
            <span className="comment">// Roles are open-ended. Define what your project needs.</span>
            <br />
            <span className="cmd">{`"roles": [`}</span><br />
            <span className="cmd">{`  { "name": "architect", "mandate": "System design & API contracts" },`}</span><br />
            <span className="cmd">{`  { "name": "impl",      "mandate": "Implementation against specs" },`}</span><br />
            <span className="cmd">{`  { "name": "security",  "mandate": "Threat modeling & audit" },`}</span><br />
            <span className="cmd">{`  { "name": "qa",        "mandate": "Evidence-driven verification" }`}</span><br />
            <span className="cmd">{`]`}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function HumanSovereignty() {
  const humanControls = [
    'Mission & project goals',
    'Constraints & non-negotiables',
    'Phase gate approvals',
    'Release authority (ship / no-ship)',
    'Escalation resolution',
    'Role & governance changes',
  ];
  const agentHandles = [
    'Planning within constraints',
    'Implementation against specs',
    'Mandatory challenge & review',
    'Test execution & evidence',
    'Documentation & decision logging',
    'Recovery within protocol bounds',
  ];

  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-blue">Human sovereignty</span>
        <h2>Lights-out operation without blind trust</h2>
        <p className="section-subtitle">
          The goal is agents that can run long-horizon workflows unattended.
          But unattended doesn't mean ungoverned.
        </p>
        <div className="sovereignty-grid">
          <div className="sovereignty-card human-card">
            <h3>Humans control</h3>
            <ul>
              {humanControls.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="sovereignty-card agent-card">
            <h3>Agents handle</h3>
            <ul>
              {agentHandles.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="section-note">
          Humans remain sovereign at the constitutional layer. Agents operate
          within granted authority. The protocol makes the boundary explicit.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: '1',
      title: 'Init',
      desc: 'Define roles, phases, adapters, and gates. Choose your team shape and workflow.',
      color: '#38BDF8',
      bg: 'rgba(56,189,248,0.12)',
    },
    {
      num: '2',
      title: 'Plan',
      desc: 'PM (or your planning role) produces specs with goals, constraints, and acceptance criteria.',
      color: 'var(--axc-blue-light)',
      bg: 'rgba(43,124,182,0.12)',
    },
    {
      num: '3',
      title: 'Build & Challenge',
      desc: 'Agents take structured turns. Every turn must challenge the previous work. Mandatory, not optional.',
      color: 'var(--axc-green-light)',
      bg: 'rgba(107,181,54,0.12)',
    },
    {
      num: '4',
      title: 'Gate & Ship',
      desc: 'QA provides evidence. Human approves phase transitions. Decision ledger records everything.',
      color: 'var(--axc-orange)',
      bg: 'rgba(232,117,42,0.12)',
    },
  ];

  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-blue">How it works</span>
        <h2>Structured turns. Mandatory challenge. Human authority.</h2>
        <p className="section-subtitle">
          Optimized for convergence quality, not generation speed.
        </p>
        <div className="steps-grid">
          {steps.map((s) => (
            <div className="step-card" key={s.num}>
              <div
                className="step-num"
                style={{ background: s.bg, color: s.color }}
              >
                {s.num}
              </div>
              <h3>{s.title}</h3>
              <p className="step-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Integrations() {
  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-green">Ecosystem</span>
        <h2>IDE compatibility, dashboard, plugins, and multi-repo</h2>
        <p className="section-subtitle">
          AgentXchain meets you where you work. Not just a CLI &mdash; a full
          delivery platform.
        </p>
        <div className="feature-grid integrations-grid">
          <div className="feature-card">
            <h3>Legacy IDE compatibility</h3>
            <p>
              VS Code and Cursor compatibility is available today for legacy
              lock-based coordination. In governed repos, the VS Code extension
              adds CLI-backed status, approvals, step/run launch, restart
              recovery, report and dashboard access, and state-change
              notifications. Reports, multi-repo operations, and the richer
              governance view still live in the browser dashboard and CLI.
            </p>
            <p style={{ marginTop: '0.75rem' }}>
              <a href="https://marketplace.visualstudio.com/items?itemName=agentXchaindev.agentxchain" target="_blank" rel="noopener noreferrer">
                Install from VS Code Marketplace &rarr;
              </a>
            </p>
          </div>
          <div className="feature-card">
            <h3>Real-time dashboard</h3>
            <p>
              Web-based dashboard shows run state, turn history, decision ledgers,
              and governance reports. Monitor your agent teams in real time.
            </p>
          </div>
          <div className="feature-card">
            <h3>Plugin system</h3>
            <p>
              Extend the runner with custom plugins for your workflow. Hook into
              turn lifecycle events, add custom validation, integrate with your
              existing tools.
            </p>
          </div>
          <div className="feature-card">
            <h3>Multi-repo coordination</h3>
            <p>
              Coordinate agent teams across multiple repositories with a
              coordinator governance model. Workstreams, barriers, and
              cross-repo context sharing.
            </p>
            <Link className="layer-link" to="/docs/quickstart#multi-repo-cold-start" style={{ color: 'var(--axc-green-light)' }}>
              Multi-repo quickstart &rarr;
            </Link>
          </div>
          <div className="feature-card">
            <h3>Webhook notifications</h3>
            <p>
              Real-time notifications for turn completions, gate approvals,
              escalations, and run events. Integrate with Slack, PagerDuty,
              or any webhook consumer.
            </p>
          </div>
          <div className="feature-card">
            <h3>Export & verification</h3>
            <p>
              Export governed artifacts for compliance and audit. Verify exports
              against protocol schemas. Governance reports in text, JSON, or
              Markdown.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Comparison() {
  const rows = [
    ['Layer', 'Agent \u2194 tools & data', 'Agent \u2194 agent messages', 'Governance over shared work'],
    ['Model', 'One agent, many tools', 'Delegation / RPC', 'Adversarial collaboration, turns'],
    ['Authority', 'Single agent decides', 'Agents negotiate', 'Constitutional human sovereignty'],
    ['Audit trail', 'Tool call logs', 'Message history', 'Structured decisions + objections'],
    ['Horizon', 'Single task', 'Request-response', 'Long-running, multi-phase delivery'],
    ['Best for', 'Agent uses tools', 'Agent calls another agent', 'AI team ships governed software'],
  ];

  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-blue">Positioning</span>
        <h2>MCP connects tools. A2A connects agents. We govern delivery.</h2>
        <p className="section-subtitle">
          Three protocols for three different problems. They're complementary,
          not competing.
        </p>
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th></th>
                <th>MCP</th>
                <th>A2A (Google)</th>
                <th className="highlight-col">AgentXchain</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, mcp, a2a, axc]) => (
                <tr key={label}>
                  <td className="row-label">{label}</td>
                  <td>{mcp}</td>
                  <td>{a2a}</td>
                  <td className="highlight-col">{axc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cta-row" style={{ justifyContent: 'flex-start', marginTop: '1.5rem' }}>
          <Link className="btn-secondary" to="/docs/compare/vs-devin">vs Devin</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-metagpt">vs MetaGPT</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-codegen">vs Codegen</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-openhands">vs OpenHands</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-warp">vs Warp.dev</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-crewai">vs CrewAI</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-langgraph">vs LangGraph</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-openai-agents-sdk">vs OpenAI Agents SDK</Link>
          <Link className="btn-secondary" to="/docs/compare/vs-autogen">vs AutoGen</Link>
        </div>
      </div>
    </section>
  );
}

function Community() {
  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-orange">Community</span>
        <h2>Build in public with other AgentXchain operators</h2>
        <p className="section-subtitle">
          Product truth should not live only in release notes. Follow shipping work,
          challenge decisions, and watch the governed delivery model evolve in public.
        </p>
        <div className="community-grid">
          <a
            className="community-card"
            href="https://www.linkedin.com/company/agentxchain-dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="community-card-header">
              <LinkedInIcon />
              <span>LinkedIn company page</span>
            </div>
            <p>
              Release callouts, product framing, and operator-facing updates from the company page.
            </p>
            <span className="community-link-text">Follow on LinkedIn &rarr;</span>
          </a>
          <a
            className="community-card"
            href="https://x.com/agentxchaindev"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="community-card-header">
              <XIcon />
              <span>X / Twitter</span>
            </div>
            <p>
              Short-form release signals, docs drops, and governed-delivery proof as it ships.
            </p>
            <span className="community-link-text">Follow on X &rarr;</span>
          </a>
          <a
            className="community-card"
            href="https://www.reddit.com/r/agentXchain_dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="community-card-header">
              <RedditIcon />
              <span>Reddit community</span>
            </div>
            <p>
              Longer-form discussion, implementation feedback, and operator questions.
            </p>
            <span className="community-link-text">Join subreddit &rarr;</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function PlatformSplit() {
  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-green">Platform</span>
        <h2>Open protocol. Managed cloud. Same governance.</h2>
        <p className="section-subtitle" style={{ maxWidth: 600 }}>
          Two surfaces, one underlying protocol. Choose the deployment model
          that fits your team.
        </p>
        <div className="platform-grid">
          <div className="platform-card">
            <h3><span className="text-blue">agentxchain.dev</span></h3>
            <p className="platform-desc">Open-source core</p>
            <ul>
              <li>Full protocol specification (MIT)</li>
              <li>CLI runner &mdash; local enforcement engine</li>
              <li>All connectors: manual, local_cli, api_proxy, mcp, remote_agent</li>
              <li>Workflow templates & conformance kit</li>
              <li>Self-hosted dashboard</li>
              <li>Plugin system & multi-repo coordination</li>
            </ul>
            <Link className="btn-secondary" to="/docs/quickstart" style={{ marginTop: '1rem' }}>
              Get started &rarr;
            </Link>
          </div>
          <div className="platform-card platform-card-ai">
            <h3><span className="text-green">agentxchain.ai</span></h3>
            <p className="platform-desc">Managed cloud preview</p>
            <ul>
              <li>Early-access web dashboard for project setup and run visibility</li>
              <li>Installable apps for Cursor, Claude Code, Codex</li>
              <li>Managed coordination, state, and history on the same protocol</li>
              <li>Shared workspaces and audit visibility for teams</li>
              <li>Built on the open-source core from agentxchain.dev</li>
              <li>Request early access while the managed surface is opening up</li>
            </ul>
            <Link className="btn-primary" to="https://agentxchain.ai" style={{ marginTop: '1rem' }}>
              Request early access &rarr;
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhatItIsNot() {
  const items = [
    { label: 'Not a single-agent coding assistant', desc: 'It governs teams, not individual agents.' },
    { label: 'Not a prompt wrapper', desc: 'The protocol is the product, not prompt engineering.' },
    { label: 'Not a chat UI', desc: 'It\'s a delivery system with structured turns and gates.' },
    { label: 'Not a fragile IDE trick', desc: 'Protocol-enforced governance, not editor scripting.' },
    { label: 'Not a generic agent framework', desc: 'Opinionated about governance. Unopinionated about models.' },
    { label: 'Not just for PM/Dev/QA', desc: 'Roles are open-ended and charter-driven.' },
  ];

  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-orange">What this is NOT</span>
        <h2>AgentXchain has opinions</h2>
        <p className="section-subtitle">
          If you want a generic agent framework with no opinions about governance,
          this isn't it. Here's what AgentXchain intentionally is not.
        </p>
        <div className="not-grid">
          {items.map((item) => (
            <div className="not-item" key={item.label}>
              <span className="not-x">&#x2717;</span>
              <div>
                <strong>{item.label}</strong>
                <span className="not-desc">{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Outcomes() {
  const outcomes = [
    { title: 'Errors caught earlier', desc: 'Mandatory challenge surfaces risks before they compound across agent turns.' },
    { title: 'Higher quality releases', desc: 'QA evidence and acceptance matrices make release readiness explicit, not assumed.' },
    { title: 'Real accountability', desc: 'Every turn is logged, validated, and attributable to an agent role with a charter.' },
    { title: 'Structured convergence', desc: 'Phases, turn limits, and gates force the team toward a shippable result.' },
    { title: 'Complete audit trail', desc: 'Append-only decision ledger records decisions, objections, risks, and evidence.' },
    { title: 'Lights-out capable', desc: 'Automated adapters run governed workflows unattended. Humans intervene at gates, not every turn.' },
  ];

  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-green">Outcomes</span>
        <h2>Why teams adopt AgentXchain</h2>
        <p className="section-subtitle">
          The value is better product decisions and fewer expensive misses &mdash;
          not more agent activity.
        </p>
        <div className="feature-grid outcomes-grid">
          {outcomes.map((o) => (
            <div className="feature-card" key={o.title}>
              <h3 className="outcome-title">{o.title}</h3>
              <p>{o.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EndVision() {
  return (
    <section className="section-alt end-vision">
      <div className="container cta-inner">
        <span className="section-label text-blue">The end state</span>
        <h2>Dark software factories</h2>
        <p className="section-subtitle" style={{ maxWidth: 600, margin: '0 auto 2rem' }}>
          Long-running. Multi-agent. Governed. Auditable. Evidence-backed.
          Interoperable across models, tools, and organizations. That's the
          future AgentXchain is building toward.
        </p>
        <div className="vision-principles">
          <span>Protocol is core</span>
          <span className="vision-dot">&middot;</span>
          <span>Governance is core</span>
          <span className="vision-dot">&middot;</span>
          <span>Humans remain sovereign</span>
          <span className="vision-dot">&middot;</span>
          <span>Connectors are replaceable</span>
          <span className="vision-dot">&middot;</span>
          <span>Models are interchangeable</span>
        </div>
      </div>
    </section>
  );
}

function Examples() {
  const examples = [
    { name: 'Habit Board', category: 'Consumer SaaS', roles: 4, phases: 4, tests: 29, desc: 'Daily habit tracker with streaks, dark-theme UI, and JSON persistence.' },
    { name: 'Trail Meals Mobile', category: 'Mobile App', roles: 6, phases: 5, tests: 26, desc: 'React Native meal planner for hikers with offline-first AsyncStorage.' },
    { name: 'Async Standup Bot', category: 'B2B SaaS', roles: 5, phases: 5, tests: 15, desc: 'Team standup collector with reminders, summaries, and data retention.' },
    { name: 'Decision Log Linter', category: 'Developer Tool', roles: 5, phases: 5, tests: 8, desc: 'CLI that validates markdown decision logs for structure and integrity.' },
    { name: 'Schema Guard', category: 'Open Source Library', roles: 5, phases: 5, tests: 19, desc: 'Declarative schema-validation library with composable validators.' },
  ];

  return (
    <section className="section-spaced">
      <div className="container">
        <span className="section-label text-blue">Proof</span>
        <h2>Five products. Five categories. Zero human code.</h2>
        <p className="section-subtitle">
          Each was built from scratch under AgentXchain governance with distinct
          team shapes, workflow phases, and governed artifacts.
        </p>
        <div className="feature-grid examples-grid">
          {examples.map((ex) => (
            <div className="example-card" key={ex.name}>
              <span className="example-category">{ex.category}</span>
              <h3>{ex.name}</h3>
              <p className="example-desc">{ex.desc}</p>
              <p className="example-roles">
                {ex.roles} roles &middot; {ex.phases} phases &middot; {ex.tests} tests
              </p>
            </div>
          ))}
        </div>
        <div className="cta-row" style={{ marginTop: '2rem' }}>
          <Link className="btn-secondary" to="/docs/examples">
            Browse all examples &rarr;
          </Link>
          <Link className="btn-secondary" to="/docs/case-study-self-build">
            How AgentXchain built itself &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  const iconSrc = useBaseUrl('/img/agentXchain.dev_icon_only_280x280px.png');
  return (
    <section className="cta-section">
      <div className="container cta-inner">
        <img
          src={iconSrc}
          alt="AgentXchain"
          width={64}
          height={64}
          className="cta-logo"
        />
        <h2>Software is a team sport. Even when the team is AI.</h2>
        <p className="section-subtitle">
          One protocol. Define your roles. Route turns through real gates.
          Keep a decision trail you can inspect, audit, and trust.
        </p>
        <div className="cta-row">
          <Link className="btn-primary" to="/docs/quickstart#path-0-demo">
            npx --yes -p agentxchain@latest -c "agentxchain demo"
          </Link>
          <Link className="btn-secondary" to="/docs/quickstart">
            npm install -g agentxchain
          </Link>
          <Link className="btn-secondary" to="https://agentxchain.ai">
            Try the cloud &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="Governed multi-agent software delivery"
      description="The governance protocol for lights-out software factories. Structured turns, mandatory challenge, phase gates, and human sovereignty. Five layers: protocol, runners, connectors, workflow kit, and integrations. Built for long-horizon AI software teams."
    >
      <Hero />
      <Stats />
      <CoreProblem />
      <Philosophy />
      <FiveLayers />
      <WorkflowKit />
      <RoleSystem />
      <HumanSovereignty />
      <HowItWorks />
      <Integrations />
      <Comparison />
      <PlatformSplit />
      <Community />
      <WhatItIsNot />
      <Outcomes />
      <EndVision />
      <Examples />
      <CTA />
    </Layout>
  );
}
