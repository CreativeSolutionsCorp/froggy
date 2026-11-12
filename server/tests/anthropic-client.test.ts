import { createAnthropicClient, parseAnthropicResponseText, type AnthropicClientLike } from '../src/anthropic-client';

describe('anthropic client', () => {
  it('extracts JSON from Claude message text', () => {
    const payload = {
      marketContextSummary: 'Momentum remains constructive.',
      setups: [],
      risks: ['Price may gap lower on weak volume.'],
      disclaimer: 'This analysis is for research only and is not financial advice.',
    };

    const result = parseAnthropicResponseText(JSON.stringify(payload));

    expect(result).toEqual(payload);
  });

  it('retries transient failures and resolves valid model output', async () => {
    const fakeClient = {
      messages: {
        create: jest
          .fn()
          .mockRejectedValueOnce(new Error('rate limit'))
          .mockResolvedValueOnce({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  headline: 'Momentum still holds',
                  actionNote: 'Keep risk small and wait for the next test of support.',
                  updatedLevels: { entry: 213.2, stop: 209.8, target: 220.0 },
                  dataQualityNote: 'Quote feed is live and consistent.',
                  disclaimer: 'This analysis is for research only and is not financial advice.',
                }),
              },
            ],
          }),
      },
    } satisfies AnthropicClientLike;

    const client = createAnthropicClient('test-key', fakeClient);
    const result = (await client.generateCoach({
      prompt: 'Review the current tape.',
    })) as { headline: string };

    expect(fakeClient.messages.create).toHaveBeenCalledTimes(2);
    expect(result.headline).toBe('Momentum still holds');
  });
});
