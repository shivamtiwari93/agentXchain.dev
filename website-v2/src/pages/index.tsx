import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';

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
        <div className="hero-badge">Open source &middot; MIT &middot; v2.2.0</div>
        <h1>
          <span className="text-green">Governed</span> multi-agent{' '}
          <span className="text-blue">software delivery</span>
        </h1>
        <p className="hero-subtitle">
          Your AI agents are smart enough. The problem is coordination.
          AgentXchain is the governance protocol that turns independent AI agents
          into accountable software teams — with mandatory challenge, structured
          turns, phase gates, and human authority at the moments that matter.
        </p>
        <div className="cta-row">
          <Link className="btn-primary" to="https://www.npmjs.com/package/agentxchain">
            npx agentxchain init
          </Link>
          <Link className="btn-secondary" to="/docs/quickstart">
            Read the docs &rarr;
          </Link>
        </div>
        <div className="terminal">
          <div className="terminal-bar">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
            <span className="terminal-title">governed workflow</span>
          </div>
          <div className="terminal-code">
            <span className="comment"># PM plans → Dev builds → QA reviews → Human ships</span>
            <br /><br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">npx agentxchain init --governed</span>
            <br />
            <span className="output">&nbsp; ✓ Created agentxchain.json (pm → dev → qa)</span>
            <br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">agentxchain step --role pm</span>
            <br />
            <span className="output">&nbsp; ⧖ Turn assigned to pm (manual)</span>
            <br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">agentxchain accept-turn</span>
            <br />
            <span className="output">
              &nbsp; ✓ Turn accepted. Phase gate: human approval required.
            </span>
            <br />
            <span className="prompt">$</span>{' '}
            <span className="cmd">agentxchain approve-transition</span>
            <br />
            <span className="output">&nbsp; ✓ Phase advanced: planning → implementation</span>
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
        <div className="stat-number">53</div>
        <div className="stat-label">Conformance fixtures</div>
      </div>
      <div>
        <div className="stat-number">3</div>
        <div className="stat-label">Adapter modes</div>
      </div>
      <div>
        <div className="stat-number">v6</div>
        <div className="stat-label">Protocol version</div>
      </div>
      <div>
        <div className="stat-number">MIT</div>
        <div className="stat-label">License</div>
      </div>
    </div>
  );
}

function Philosophy() {
  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-green">Philosophy</span>
        <h2>Mandatory challenge, explicit gates, auditable delivery</h2>
        <p className="section-subtitle">
          Most multi-agent systems delegate from one brain to sub-agents.
          AgentXchain inverts this: each agent has its own mandate and is{' '}
          <em>required</em> to challenge the others.
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
              The PM pushes for user value. The dev pushes for feasibility.
              QA pushes for correctness. They're <em>supposed</em> to disagree.
              That tension produces better software than any single agent.
            </p>
          </div>
          <div className="feature-card">
            <h3>Long-horizon convergence</h3>
            <p>
              Phases, turn limits, mandatory verification, and human checkpoints.
              Constraints force convergence on a real product — built for
              long-horizon coding where quality compounds over speed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section style={{ padding: '5rem 0' }}>
      <div className="container">
        <span className="section-label text-blue">Architecture</span>
        <h2>Protocol + runners + connectors + integrations</h2>
        <p className="section-subtitle">
          The protocol defines the workflow. The runner enforces it. Connectors and
          integrations make it usable in real software factories.
        </p>
        <div className="arch-grid feature-grid">
          <div className="feature-card">
            <h3>
              <span className="text-blue">Protocol layer</span>
            </h3>
            <p>
              The constitution. Config schema, state machine, turn-result schema,
              validation rules, phase gates, decision ledger format. Versioned
              independently. Model-agnostic, runtime-agnostic.
            </p>
          </div>
          <div className="feature-card">
            <h3>
              <span className="text-green">Runner layer</span>
            </h3>
            <p>
              The enforcement engine. Reads config, manages state, assigns turns,
              validates results, enforces gates. Currently a Node.js CLI.
              Could be a cloud service, GitHub Action, or K8s operator.
            </p>
          </div>
          <div className="feature-card">
            <h3>
              <span className="text-orange">Connector layer</span>
            </h3>
            <p>
              The bridge to agent runtimes. Three modes: <code>manual</code> (human),{' '}
              <code>local_cli</code> (Claude Code, Codex, Aider), <code>api_proxy</code>{' '}
              (direct LLM API). ~200 lines to add a new connector.
            </p>
          </div>
        </div>
        <p className="section-subtitle" style={{ marginTop: '1.5rem', marginBottom: 0 }}>
          Governed workflows sit on top of these layers: planning, implementation,
          QA, escalation, release, multi-repo coordination, plugins, dashboards,
          and organizational integrations. The{' '}
          <Link to="/docs/cli#verify-protocol">protocol conformance kit</Link>{' '}
          lets any implementation prove constitutional compliance against 53
          golden fixtures — run <code>agentxchain verify protocol</code> to test yours.
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
      desc: 'Define roles, phases, adapters, and gates in agentxchain.json.',
      color: '#38BDF8',
      bg: 'rgba(56,189,248,0.12)',
    },
    {
      num: '2',
      title: 'Step',
      desc: 'Agent works within its mandate and produces a structured turn result.',
      color: 'var(--axc-blue-light)',
      bg: 'rgba(43,124,182,0.12)',
    },
    {
      num: '3',
      title: 'Gate',
      desc: 'Orchestrator validates artifacts and enforces challenge. Human approves transitions.',
      color: 'var(--axc-green-light)',
      bg: 'rgba(107,181,54,0.12)',
    },
    {
      num: '4',
      title: 'Ship',
      desc: 'QA requests completion. Human makes the final ship/no-ship decision.',
      color: 'var(--axc-orange)',
      bg: 'rgba(232,117,42,0.12)',
    },
  ];

  return (
    <section style={{ padding: '5rem 0' }}>
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
              <p style={{ fontSize: '0.84rem', color: 'var(--ifm-font-color-secondary)' }}>
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformSplit() {
  return (
    <section className="section-alt">
      <div className="container" style={{ textAlign: 'center', maxWidth: 640 }}>
        <span className="section-label text-green">Cloud</span>
        <h2>Don't want to self-host?</h2>
        <p className="section-subtitle">
          Everything on this page is open source and MIT licensed.
          If you want managed orchestration, persistent history, team dashboards,
          and compliance reporting without running your own infrastructure —
        </p>
        <Link className="btn-secondary" to="https://agentxchain.ai">
          Check out agentxchain.ai &rarr;
        </Link>
      </div>
    </section>
  );
}

function Comparison() {
  const rows = [
    ['Layer', 'Agent ↔ tools & data', 'Agent ↔ agent over network', 'Governance over shared work'],
    ['Model', 'One agent, many tools', 'Many agents, messages', 'Adversarial collaboration, turns'],
    ['Authority', 'Single agent decides', 'Delegation / RPC', 'Constitutional human sovereignty'],
    ['Audit trail', 'Tool call logs', 'Message history', 'Structured decisions + objections'],
    ['Best for', 'Agent uses tools', 'Agent calls another agent', 'AI team ships governed software'],
  ];

  return (
    <section style={{ padding: '5rem 0' }}>
      <div className="container">
        <span className="section-label text-blue">Positioning</span>
        <h2>MCP connects tools. A2A connects agents. We govern delivery.</h2>
        <p className="section-subtitle">
          Three protocols for three different problems. They're complementary.
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
          <Link className="btn-secondary" to="/compare/vs-crewai">vs CrewAI</Link>
          <Link className="btn-secondary" to="/compare/vs-langgraph">vs LangGraph</Link>
          <Link className="btn-secondary" to="/compare/vs-openai-agents-sdk">vs OpenAI Agents SDK</Link>
        </div>
      </div>
    </section>
  );
}

function Outcomes() {
  const outcomes = [
    { title: 'Errors caught earlier', desc: 'Mandatory challenge surfaces risks before they compound across agent turns.' },
    { title: 'Higher quality releases', desc: 'QA evidence and acceptance matrices make release readiness explicit.' },
    { title: 'Real accountability', desc: 'Every turn is logged, validated, and attributable to an agent role.' },
    { title: 'Human control', desc: 'Protocol requires human approval for phase transitions and run completion.' },
    { title: 'Structured convergence', desc: 'Phases, turn limits, and gates force the team toward a shippable result.' },
    { title: 'Complete audit trail', desc: 'Every turn records decisions, objections, risks, and verification evidence.' },
    { title: 'Lights-out capable', desc: 'Automated adapters run governed workflows unattended. Humans intervene at gates, not every turn.' },
    { title: 'Faster decision loops', desc: 'Healthy friction surfaces risks early instead of after launch.' },
  ];

  return (
    <section className="section-alt">
      <div className="container">
        <span className="section-label text-green">Product outcomes</span>
        <h2>Why teams adopt AgentXchain</h2>
        <p className="section-subtitle">
          The value is not "more agent activity." The value is better product
          decisions and fewer expensive misses.
        </p>
        <div className="feature-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {outcomes.map((o) => (
            <div className="feature-card" key={o.title}>
              <h3 style={{ color: 'var(--axc-green-light)' }}>{o.title}</h3>
              <p>{o.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  const iconSrc = useBaseUrl('/img/agentXchain.dev_icon_only_280x280px.png');
  return (
    <section style={{ borderTop: '1px solid var(--ifm-color-emphasis-300)', textAlign: 'center', padding: '5rem 0' }}>
      <div className="container">
        <img
          src={iconSrc}
          alt="AgentXchain"
          width={64}
          height={64}
          style={{ marginBottom: '1.25rem' }}
        />
        <h2>Software is a team sport. Even when the team is AI.</h2>
        <p style={{ color: 'var(--ifm-font-color-secondary)', marginBottom: '2rem', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
          One protocol. Define your roles, route turns through real gates,
          and keep a decision trail you can inspect later.
        </p>
        <div className="cta-row">
          <Link className="btn-primary" to="https://www.npmjs.com/package/agentxchain">
            npx agentxchain init
          </Link>
          <Link className="btn-secondary" to="/docs/quickstart">
            Read the docs &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="Constitutional governance for AI software teams"
      description="Protocol-governed multi-agent software delivery. Mandatory challenge, structured turns, phase gates, and human authority. Built for long-horizon coding and lights-out software factories."
    >
      <Hero />
      <Stats />
      <Philosophy />
      <Architecture />
      <HowItWorks />
      <PlatformSplit />
      <Comparison />
      <Outcomes />
      <CTA />
    </Layout>
  );
}
