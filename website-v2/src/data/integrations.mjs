export const integrationSections = [
  {
    title: 'IDE / Agent Platforms',
    items: [
      {
        title: 'Claude Code',
        href: '/docs/integrations/claude-code',
        summary: '`local_cli` via `claude -p`',
      },
      {
        title: 'OpenAI Codex CLI',
        href: '/docs/integrations/openai-codex-cli',
        summary: '`local_cli` via `codex`',
      },
      {
        title: 'Cursor',
        href: '/docs/integrations/cursor',
        summary: 'Editor + separate CLI agent; no native Cursor connector yet',
      },
      {
        title: 'VS Code',
        href: '/docs/integrations/vscode',
        summary: 'Extension + `local_cli`',
      },
      {
        title: 'Windsurf (Codeium)',
        href: '/docs/integrations/windsurf',
        summary: 'Editor + separate CLI agent; no native Windsurf connector yet',
      },
      {
        title: 'Google Jules',
        href: '/docs/integrations/google-jules',
        summary: 'Gemini path today; native Jules connector not yet shipped',
      },
      {
        title: 'Devin',
        href: '/docs/integrations/devin',
        summary: '`remote_agent` (HTTP)',
      },
    ],
  },
  {
    title: 'Local Model Runners',
    items: [
      {
        title: 'Ollama',
        href: '/docs/integrations/ollama',
        summary: '`api_proxy` via `localhost:11434/v1`',
      },
      {
        title: 'MLX (Apple Silicon)',
        href: '/docs/integrations/mlx',
        summary: '`api_proxy` via `mlx-lm.server`',
      },
    ],
  },
  {
    title: 'API Providers',
    items: [
      {
        title: 'Anthropic',
        href: '/docs/integrations/anthropic',
        summary: 'Claude Opus 4.6, Sonnet 4.6, Haiku 4.5',
      },
      {
        title: 'OpenAI',
        href: '/docs/integrations/openai',
        summary: 'GPT-5.4, GPT-5.3-Codex, GPT-OSS',
      },
      {
        title: 'Google',
        href: '/docs/integrations/google',
        summary: 'Gemini 3.1 Pro, Flash, Gemma 4',
      },
      {
        title: 'DeepSeek',
        href: '/docs/integrations/deepseek',
        summary: 'V3.2, R2, Coder-V3',
      },
      {
        title: 'Mistral AI',
        href: '/docs/integrations/mistral',
        summary: 'Devstral 2, Codestral, Leanstral',
      },
      {
        title: 'xAI',
        href: '/docs/integrations/xai',
        summary: 'Grok 4.20 Beta 2, Grok Code Fast 1',
      },
      {
        title: 'Amazon Bedrock',
        href: '/docs/integrations/amazon',
        summary: 'Nova 2 Pro, Nova 2 Lite, Nova Premier',
      },
      {
        title: 'Qwen (Alibaba)',
        href: '/docs/integrations/qwen',
        summary: 'Qwen3-Coder-480B, Qwen3.6-Plus',
      },
      {
        title: 'Groq',
        href: '/docs/integrations/groq',
        summary: 'Ultra-fast inference for GPT-OSS, Qwen3, Llama 4',
      },
      {
        title: 'Cohere',
        href: '/docs/integrations/cohere',
        summary: 'Command A Reasoning, Command R+',
      },
    ],
  },
  {
    title: 'Protocol Native',
    items: [
      {
        title: 'MCP (Model Context Protocol)',
        href: '/docs/integrations/mcp',
        summary: 'Any MCP-compatible agent via stdio or HTTP',
      },
    ],
  },
];
