import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'AgentXchain.dev',
  tagline: 'Constitutional governance for AI software teams',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://agentxchain.dev',
  baseUrl: '/',

  organizationName: 'shivamtiwari93',
  projectName: 'agentXchain.dev',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/shivamtiwari93/agentXchain.dev/tree/main/website-v2/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        gtag: {
          trackingID: 'G-1Z8RV9X341',
          anonymizeIP: true,
        },
      } satisfies Preset.Options,
    ],
  ],

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/img/favicon-32x32.png',
      },
    },
  ],

  themeConfig: {
    image: 'img/agentXchain.dev_rectangle_600x120px.png',
    metadata: [
      {name: 'twitter:card', content: 'summary_large_image'},
      {name: 'twitter:title', content: 'AgentXchain — The governance protocol for lights-out software factories'},
      {name: 'twitter:description', content: 'Governed multi-agent software delivery. Five layers: protocol, runners, connectors, workflow kit, integrations. Structured turns, mandatory challenge, and human sovereignty.'},
    ],
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'AgentXchain.dev',
      logo: {
        alt: 'AgentXchain',
        src: 'img/agentXchain.dev_icon_only_280x280px.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {to: '/why', label: 'Why', position: 'left'},
        {
          label: 'Compare',
          position: 'left',
          items: [
            {to: '/compare/vs-warp', label: 'vs Warp.dev'},
            {to: '/compare/vs-crewai', label: 'vs CrewAI'},
            {to: '/compare/vs-langgraph', label: 'vs LangGraph'},
            {to: '/compare/vs-openai-agents-sdk', label: 'vs OpenAI Agents SDK'},
            {to: '/compare/vs-autogen', label: 'vs AutoGen'},
          ],
        },
        {
          href: 'https://github.com/shivamtiwari93/agentXchain.dev',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://www.npmjs.com/package/agentxchain',
          label: 'npm',
          position: 'right',
          className: 'navbar-npm-link',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Getting Started',
          items: [
            {label: 'Quickstart', to: '/docs/quickstart'},
            {label: 'CLI Reference', to: '/docs/cli'},
            {label: 'Templates', to: '/docs/templates'},
            {label: 'Multi-Repo', to: '/docs/multi-repo'},
          ],
        },
        {
          title: 'Architecture',
          items: [
            {label: 'Protocol v6', to: '/docs/protocol'},
            {label: 'Runner Interface', to: '/docs/runner-interface'},
            {label: 'Adapters', to: '/docs/adapters'},
            {label: 'Plugins', to: '/docs/plugins'},
            {label: 'Recovery', to: '/docs/recovery'},
          ],
        },
        {
          title: 'Product',
          items: [
            {label: 'vs Warp.dev', to: '/compare/vs-warp'},
            {label: 'Why AgentXchain', to: '/why'},
            {label: 'vs CrewAI', to: '/compare/vs-crewai'},
            {label: 'vs LangGraph', to: '/compare/vs-langgraph'},
            {label: 'vs OpenAI Agents SDK', to: '/compare/vs-openai-agents-sdk'},
            {label: 'vs AutoGen', to: '/compare/vs-autogen'},
          ],
        },
        {
          title: 'Platform',
          items: [
            {label: 'agentxchain.dev (OSS)', href: 'https://agentxchain.dev'},
            {label: 'agentxchain.ai (Cloud)', href: 'https://agentxchain.ai'},
            {label: 'GitHub', href: 'https://github.com/shivamtiwari93/agentXchain.dev'},
            {label: 'npm', href: 'https://www.npmjs.com/package/agentxchain'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AgentXchain. Open source under MIT.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
