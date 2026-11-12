import Anthropic from '@anthropic-ai/sdk';

export type AnthropicTextBlock = {
  type?: string;
  text?: string;
};

export type AnthropicClientLike = {
  messages: {
    create: (payload: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => Promise<{ content: unknown }>;
  };
};

export function parseAnthropicResponseText(raw: unknown): unknown {
  const candidate = typeof raw === 'string' ? raw.trim() : '';

  if (!candidate) {
    throw new Error('Anthropic returned empty text output.');
  }

  try {
    return JSON.parse(candidate);
  } catch {
    const fenced = candidate.match(/```json\s*([\s\S]*?)\s*```/i);
    const jsonLike = fenced ? fenced[1] : candidate.match(/\{[\s\S]*\}/)?.[0] ?? candidate;

    if (!jsonLike) {
      throw new Error('Anthropic returned non-JSON output.');
    }

    try {
      return JSON.parse(jsonLike);
    } catch {
      throw new Error('Anthropic output could not be parsed as JSON.');
    }
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textBlock = content.find((item) => typeof item === 'object' && item !== null && 'text' in item && typeof (item as AnthropicTextBlock).text === 'string');

    if (textBlock && typeof textBlock === 'object' && 'text' in textBlock && typeof textBlock.text === 'string') {
      return textBlock.text;
    }
  }

  throw new Error('Anthropic response did not contain text content.');
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|timeout|timed out|5\d\d|ECONNRESET|fetch/i.test(message);
}

async function requestModelText(
  client: AnthropicClientLike,
  prompt: string,
  model: string,
  maxTokens: number,
  retries: number,
): Promise<unknown> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });

      return parseAnthropicResponseText(extractTextContent(response.content));
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt >= retries) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Anthropic request failed.'));
}

export function createAnthropicClient(
  apiKey: string,
  client: AnthropicClientLike = new Anthropic({ apiKey }),
  options: { model?: string; retries?: number; maxTokens?: number } = {},
): {
  generateBriefing: (input: { prompt: string }) => Promise<unknown>;
  generateCoach: (input: { prompt: string }) => Promise<unknown>;
} {
  const normalizedKey = apiKey.trim();
  const model = options.model ?? 'claude-3-5-sonnet-latest';
  const retries = Number.isFinite(options.retries) ? Math.max(0, Number(options.retries)) : 2;
  const maxTokens = Number.isFinite(options.maxTokens) ? Number(options.maxTokens) : 1024;

  return {
    async generateBriefing({ prompt }: { prompt: string }): Promise<unknown> {
      if (!normalizedKey) {
        throw new Error('Anthropic API key is not configured.');
      }

      return requestModelText(client, prompt, model, maxTokens, retries);
    },
    async generateCoach({ prompt }: { prompt: string }): Promise<unknown> {
      if (!normalizedKey) {
        throw new Error('Anthropic API key is not configured.');
      }

      return requestModelText(client, prompt, model, maxTokens, retries);
    },
  };
}
