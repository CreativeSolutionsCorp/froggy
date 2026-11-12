import {
  PolygonClientError,
  createPolygonClient,
  type PolygonBar,
} from '../src/polygon-client';

describe('polygon client', () => {
  const mockFetch = jest.fn();

  it('throws a typed error for a rate limit response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => '1' },
      json: async () => ({ error: 'rate limit' }),
    });

    const client = createPolygonClient({ apiKey: 'test-key', fetchImpl: mockFetch, maxRetries: 0 });

    await expect(client.getPreviousDayBar('AAPL')).rejects.toBeInstanceOf(PolygonClientError);
    await expect(client.getPreviousDayBar('AAPL')).rejects.toMatchObject({ code: 'rate_limit' });
  });

  it('returns the previous bar from documented fields', async () => {
    const result: { results: PolygonBar[] } = {
      results: [
        {
          T: 'AAPL',
          o: 100,
          h: 110,
          l: 98,
          c: 105,
          v: 900,
          vw: 104.5,
          n: 42,
          t: 1700000000000,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => result,
    });

    const client = createPolygonClient({ apiKey: 'test-key', fetchImpl: mockFetch });
    const response = await client.getPreviousDayBar('AAPL');

    expect(response).toMatchObject({ T: 'AAPL', c: 105, v: 900 });
  });
});
