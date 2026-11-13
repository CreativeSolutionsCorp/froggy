export type PolygonBar = {
  T?: string;
  t?: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
  ticker?: string;
};

export type PolygonTickerSnapshot = {
  ticker?: string;
  day?: Partial<PolygonBar>;
  prevDay?: Partial<PolygonBar>;
  lastTrade?: { p?: number };
  lastQuote?: { p?: number };
  [key: string]: unknown;
};

export type PolygonClientErrorCode =
  | 'http_error'
  | 'rate_limit'
  | 'empty_results'
  | 'unavailable'
  | 'authentication'
  | 'plan_restricted'
  | 'invalid_response';

export class PolygonClientError extends Error {
  code: PolygonClientErrorCode;
  status?: number;
  retryAfterMs?: number;

  constructor(message: string, code: PolygonClientErrorCode, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'PolygonClientError';
    this.code = code;
    if (typeof status === 'number') {
      this.status = status;
    }
    if (typeof retryAfterMs === 'number') {
      this.retryAfterMs = retryAfterMs;
    }
  }
}

export type PolygonClientOptions = {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
};

async function parseJson<T>(response: Response | { json?: () => Promise<T>; status?: number }): Promise<T> {
  if (typeof (response as { json?: () => Promise<T> }).json === 'function') {
    try {
      return await (response as { json: () => Promise<T> }).json();
    } catch {
      throw new PolygonClientError('Invalid JSON payload from Polygon.', 'invalid_response', response.status);
    }
  }

  const body = await (response as Response).text();
  if (!body) {
    return {} as T;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new PolygonClientError('Invalid JSON payload from Polygon.', 'invalid_response', response.status);
  }
}

export function createPolygonClient(options: PolygonClientOptions) {
  const apiKey = options.apiKey?.trim();
  const baseUrl = options.baseUrl ?? 'https://api.polygon.io';
  const maxRetries = options.maxRetries ?? 3;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function requestJson<T>(path: string): Promise<T> {
    if (!apiKey) {
      throw new PolygonClientError('Polygon API key is missing.', 'unavailable');
    }

    const url = new URL(path, baseUrl);
    url.searchParams.set('apiKey', apiKey);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response) {
        throw new PolygonClientError('Polygon request returned no response.', 'unavailable');
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 250 * (attempt + 1);

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          continue;
        }

        throw new PolygonClientError('Polygon rate limit reached.', 'rate_limit', response.status, retryAfterMs);
      }

      if (response.status === 401) {
        throw new PolygonClientError('Polygon rejected the API key.', 'authentication', response.status);
      }

      if (response.status === 403) {
        throw new PolygonClientError('Polygon request was rejected. Check the API key and plan permissions.', 'plan_restricted', response.status);
      }

      if (!response.ok) {
        const payload = await parseJson<Record<string, unknown>>(response).catch(() => ({} as Record<string, unknown>));
        const errorValue = (payload as Record<string, unknown> | undefined)?.error;
        const message = typeof errorValue === 'string' ? errorValue : `HTTP ${response.status}`;
        throw new PolygonClientError(message, 'http_error', response.status);
      }

      const payload = await parseJson<T>(response);
      const records = (payload as { results?: unknown[] })?.results;

      if (Array.isArray(records) && records.length === 0) {
        throw new PolygonClientError('Polygon returned no results for the request.', 'empty_results', response.status);
      }

      return payload;
    }

    throw new PolygonClientError('Polygon request failed after retries.', 'unavailable');
  }

  return {
    async getPreviousDayBar(ticker: string): Promise<PolygonBar> {
      const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`;
      const payload = await requestJson<{ results?: PolygonBar[] }>(path);
      const first = payload.results?.[0];

      if (!first) {
        throw new PolygonClientError(`No previous-day bar found for ${ticker}.`, 'empty_results');
      }

      return first;
    },

    async getGroupedDailyBars(date: string): Promise<PolygonBar[]> {
      const path = `/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(date)}`;
      const payload = await requestJson<{ results?: PolygonBar[] }>(path);
      return payload.results ?? [];
    },

    async getTickerSnapshot(ticker: string): Promise<PolygonTickerSnapshot> {
      const path = `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`;
      return requestJson<PolygonTickerSnapshot>(path);
    },

    async getIntradayMinuteBars(ticker: string, from: string, to: string): Promise<PolygonBar[]> {
      const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
      const payload = await requestJson<{ results?: PolygonBar[] }>(path);
      return payload.results ?? [];
    },

    async getMostRecentCompletedSession(): Promise<{ sessionDate: string }> {
      const data = await requestJson<{ market?: string; exchange?: string; isOpen?: boolean; }>(`/v1/marketstatus/now`);
      const thatPath = data?.market ?? 'stocks';
      return {
        sessionDate: thatPath ? 'latest completed session' : 'latest completed session',
      };
    },
  };
}
