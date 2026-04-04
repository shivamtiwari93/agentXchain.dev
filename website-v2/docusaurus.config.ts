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
      {name: 'twitter:title', content: 'AgentXchain — Constitutional governance for AI software teams'},
      {name: 'twitter:description', content: 'Protocol-governed multi-agent software delivery. Mandatory challenge, structured turns, phase gates, and human authority.'},
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
            {to: '/compare/vs-crewai', label: 'vs CrewAI'},
            {to: '/compare/vs-langgraph', label: 'vs LangGraph'},
            {to: '/compare/vs-openai-agents-sdk', label: 'vs OpenAI Agents SDK'},
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
          title: 'Docs',
          items: [
            {label: 'Quickstart', to: '/docs/quickstart'},
            {label: 'CLI Reference', to: '/docs/cli'},
            {label: 'Protocol v6', to: '/docs/protocol'},
            {label: 'Adapters', to: '/docs/adapters'},
            {label: 'Plugins', to: '/docs/plugins'},
          ],
        },
        {
          title: 'Product',
          items: [
            {label: 'Why AgentXchain', to: '/why'},
            {label: 'vs CrewAI', to: '/compare/vs-crewai'},
            {label: 'vs LangGraph', to: '/compare/vs-langgraph'},
            {label: 'vs OpenAI Agents SDK', to: '/compare/vs-openai-agents-sdk'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: 'https://github.com/shivamtiwari93/agentXchain.dev'},
            {label: 'npm', href: 'https://www.npmjs.com/package/agentxchain'},
          ],
        },
        {
          title: 'Platform',
          items: [
            {label: 'agentxchain.dev (OSS)', href: 'https://agentxchain.dev'},
            {label: 'agentxchain.ai (Cloud)', href: 'https://agentxchain.ai'},
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
