import { countTokens as countAnthropicTokens } from '@anthropic-ai/tokenizer';

const SUPPORTED_TOKEN_COUNTER_PROVIDERS = ['anthropic'];

export { SUPPORTED_TOKEN_COUNTER_PROVIDERS };

export function countTokens(text, provider = 'anthropic') {
  const normalizedProvider = String(provider || '').trim().toLowerCase();

  if (!SUPPORTED_TOKEN_COUNTER_PROVIDERS.includes(normalizedProvider)) {
    throw new Error(
      `Unsupported token counter provider "${provider}". Supported: ${SUPPORTED_TOKEN_COUNTER_PROVIDERS.join(', ')}`
    );
  }

  const normalizedText = String(text ?? '');
  if (!normalizedText) {
    return 0;
  }

  const tokens = countAnthropicTokens(normalizedText);
  if (!Number.isInteger(tokens) || tokens < 0) {
    throw new Error(`Anthropic tokenizer returned invalid token count: ${tokens}`);
  }

  return tokens;
}
