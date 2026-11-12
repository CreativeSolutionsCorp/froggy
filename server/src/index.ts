import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { briefResponseSchema, buildBriefingPrompt, buildCoachPrompt, coachResponseSchema, validateModelOutput } from './ai';
import { createAnthropicClient } from './anthropic-client';

export type BriefingAsk = {
  label: string;
  value: string;
};

export type BriefingRequest = {
  symbol: string;
  timeframe: string;
  asks: BriefingAsk[];
  notes?: string;
  style: 'concise' | 'balanced' | 'detailed';
};

export type CoachingRequest = {
  symbol: string;
  price: number;
  threshold: number;
  scenario: 'bullish' | 'bearish' | 'neutral';
  notes?: string;
  imageBase64?: string;
};

export type RiskInputs = {
  volatility: number;
  drawdown: number;
  liquidity: number;
  conviction: number;
};

export type ServerEnvironment = {
  port: number;
  sharedAppToken: string;
  polygonApiKey: string;
  anthropicApiKey: string;
  rateLimitWindowMs: number;
  maxRequests: number;
};

const VALID_TIMEFRAMES = new Set(['1D', '1W', '1M', '3M', '1Y', 'MAX']);
const VALID_SCENARIOS = new Set(['bullish', 'bearish', 'neutral']);
const VALID_STYLES = new Set(['concise', 'balanced', 'detailed']);

export function healthCheck(): { ok: boolean } {
  return { ok: true };
}

export function sanitizeSymbol(value: unknown): string {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return raw.replace(/[^A-Za-z0-9.-]/g, '').trim().toUpperCase();
}

function sanitizeText(value: unknown, maxLength = 500): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getHeaderValue(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const direct = headers[key] ?? headers[key.toLowerCase()];

  if (Array.isArray(direct)) {
    return direct[0];
  }

  return typeof direct === 'string' ? direct : undefined;
}

export function isAuthorized(headers: Record<string, string | string[] | undefined>, token: string): boolean {
  const expected = token.trim();

  if (!expected) {
    return true;
  }

  const rawHeader = getHeaderValue(headers, 'x-shared-app-token') ?? getHeaderValue(headers, 'authorization');

  if (!rawHeader) {
    return false;
  }

  const candidate = rawHeader.startsWith('Bearer ') ? rawHeader.slice(7).trim() : rawHeader.trim();
  return candidate === expected;
}

export function createRateLimiter(options: { maxRequests?: number; windowMs?: number } = {}): (key: string) => boolean {
  const maxRequests = options.maxRequests ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const hits = new Map<string, number[]>();

  return (key: string): boolean => {
    const normalizedKey = String(key || 'anonymous');
    const now = Date.now();
    const recentHits = (hits.get(normalizedKey) ?? []).filter((timestamp) => now - timestamp < windowMs);

    if (recentHits.length >= maxRequests) {
      hits.set(normalizedKey, recentHits);
      return false;
    }

    recentHits.push(now);
    hits.set(normalizedKey, recentHits);
    return true;
  };
}

export function validateBriefingRequest(input: unknown): BriefingRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Briefing payload must be an object.');
  }

  const body = input as Record<string, unknown>;
  const symbol = sanitizeSymbol(body.symbol);

  if (!symbol) {
    throw new Error('A valid symbol is required.');
  }

  const timeframeValue = typeof body.timeframe === 'string' ? body.timeframe.trim().toUpperCase() : '1D';
  const timeframe = VALID_TIMEFRAMES.has(timeframeValue) ? timeframeValue : '1D';

  const styleValue = typeof body.style === 'string' ? body.style.trim().toLowerCase() : 'balanced';
  const style = VALID_STYLES.has(styleValue) ? (styleValue as BriefingRequest['style']) : 'balanced';

  const asks = Array.isArray(body.asks)
    ? body.asks.map((ask, index) => {
        if (!ask || typeof ask !== 'object') {
          throw new Error(`Ask at index ${index} must be an object.`);
        }

        const item = ask as Record<string, unknown>;
        const label = sanitizeText(item.label, 60) || `Metric ${index + 1}`;
        const value = sanitizeText(item.value, 200) || 'n/a';

        return { label, value } satisfies BriefingAsk;
      })
    : [];

  const notes = sanitizeText(body.notes, 800);
  const result: BriefingRequest = {
    symbol,
    timeframe,
    asks,
    style,
  };

  if (notes) {
    result.notes = notes;
  }

  return result;
}

export function validateCoachingRequest(input: unknown): CoachingRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Coaching payload must be an object.');
  }

  const body = input as Record<string, unknown>;
  const symbol = sanitizeSymbol(body.symbol);

  if (!symbol) {
    throw new Error('A valid symbol is required.');
  }

  const price = Number(body.price);
  const threshold = Number(body.threshold);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('A positive numeric price is required.');
  }

  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('A positive numeric threshold is required.');
  }

  const scenario = typeof body.scenario === 'string' ? body.scenario.trim().toLowerCase() : 'neutral';
  if (!VALID_SCENARIOS.has(scenario)) {
    throw new Error('Scenario must be bullish, bearish, or neutral.');
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined;
  if (imageBase64 && imageBase64.length > 1_000_000) {
    throw new Error('Image payload exceeds the 1MB limit.');
  }

  const notes = sanitizeText(body.notes, 800);
  const result: CoachingRequest = {
    symbol,
    price,
    threshold,
    scenario: scenario as CoachingRequest['scenario'],
  };

  if (notes) {
    result.notes = notes;
  }

  if (imageBase64) {
    result.imageBase64 = imageBase64;
  }

  return result;
}

export function buildRiskSummary(inputs: RiskInputs): {
  score: number;
  band: 'low' | 'moderate' | 'high';
  notes: string[];
} {
  const volatility = clamp(Number(inputs.volatility ?? 0), 0, 1);
  const drawdown = clamp(Number(inputs.drawdown ?? 0), 0, 1);
  const liquidity = clamp(Number(inputs.liquidity ?? 0), 0, 1);
  const conviction = clamp(Number(inputs.conviction ?? 0), 0, 1);

  const score = Math.round(
    volatility * 35 +
      drawdown * 30 +
      (1 - liquidity) * 20 +
      (1 - conviction) * 15,
  );

  const band: 'low' | 'moderate' | 'high' = score < 35 ? 'low' : score < 70 ? 'moderate' : 'high';

  return {
    score: clamp(score, 0, 100),
    band,
    notes: [
      volatility > 0.6 ? 'Volatility is elevated.' : 'Volatility remains manageable.',
      drawdown > 0.25 ? 'Drawdown risk is elevated.' : 'Drawdown risk is acceptable.',
      liquidity > 0.7 ? 'Liquidity is healthy.' : 'Liquidity is thin and should be monitored.',
    ],
  };
}

function buildSummaryFromBriefing(payload: BriefingRequest): { symbol: string; timeframe: string; style: string; summary: string } {
  const trendCue = payload.asks.length > 0 ? payload.asks[0]?.value ?? 'Market structure is stable.' : 'Market structure is stable.';
  const summary = payload.notes
    ? `${payload.symbol} is in view for ${payload.timeframe}. ${trendCue}. ${payload.notes}`
    : `${payload.symbol} is in view for ${payload.timeframe}. ${trendCue}.`;

  return {
    symbol: payload.symbol,
    timeframe: payload.timeframe,
    style: payload.style ?? 'balanced',
    summary: summary.slice(0, 800),
  };
}

export function createServer(env: Partial<ServerEnvironment> = {}): Express {
  const app = express();
  const token = (env.sharedAppToken ?? process.env.SHARED_APP_TOKEN ?? '').trim();
  const anthropicApiKey = (env.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '').trim();
  const anthropicClient = anthropicApiKey ? createAnthropicClient(anthropicApiKey) : null;
  const rateLimiter = createRateLimiter({
    maxRequests: env.maxRequests ?? Number(process.env.MAX_REQUESTS ?? 60),
    windowMs: env.rateLimitWindowMs ?? Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const start = Date.now();
    const end = (): void => {
      const duration = Date.now() - start;
      console.info(`${req.method} ${req.path} ${duration}ms`);
    };

    _res.on('finish', end);
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const key = (req.ip || req.socket.remoteAddress || 'anonymous').toString();

    if (!rateLimiter(key)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    if (token && !isAuthorized(req.headers, token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json(healthCheck());
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json(healthCheck());
  });

  app.post('/api/briefing', async (req: Request, res: Response) => {
    try {
      const payload = validateBriefingRequest(req.body);
      const prompt = buildBriefingPrompt({
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        data: payload.asks.map((ask) => ({ label: ask.label, value: ask.value })),
        ...(payload.notes ? { notes: payload.notes } : {}),
      });

      const summary = buildSummaryFromBriefing(payload);
      const fallbackRisk = buildRiskSummary({
        volatility: payload.asks.length > 0 ? 0.62 : 0.28,
        drawdown: payload.notes ? 0.22 : 0.12,
        liquidity: 0.81,
        conviction: payload.style === 'concise' ? 0.73 : 0.68,
      });

      if (anthropicClient) {
        try {
          const raw = await anthropicClient.generateBriefing({ prompt });
          const analysis = validateModelOutput(raw, briefResponseSchema);

          return res.json({
            ok: true,
            summary: {
              symbol: payload.symbol,
              timeframe: payload.timeframe,
              style: payload.style,
              summary: analysis.marketContextSummary,
            },
            risk: {
              score: Math.min(100, Math.max(0, Math.round((analysis.setups.length + analysis.risks.length) * 18))),
              band: analysis.risks.length > 2 ? 'high' : analysis.setups.length > 0 ? 'moderate' : 'low',
              notes: analysis.risks,
            },
            model: analysis,
            source: 'anthropic',
          });
        } catch {
          return res.json({ ok: true, summary, risk: fallbackRisk, source: 'local' });
        }
      }

      res.json({ ok: true, summary, risk: fallbackRisk });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid briefing request';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/coaching', async (req: Request, res: Response) => {
    try {
      const payload = validateCoachingRequest(req.body);
      const risk = buildRiskSummary({
        volatility: clamp(payload.threshold / 100, 0, 1),
        drawdown: payload.scenario === 'bearish' ? 0.42 : 0.18,
        liquidity: 0.8,
        conviction: payload.scenario === 'bullish' ? 0.72 : 0.58,
      });

      if (anthropicClient) {
        try {
          const raw = await anthropicClient.generateCoach({
            prompt: buildCoachPrompt({
              symbol: payload.symbol,
              quote: {
                last: payload.price,
                bid: Math.max(0, payload.price - 0.25),
                ask: payload.price + 0.25,
                timestamp: new Date().toISOString(),
              },
              dataQuality: 'live',
              ...(payload.notes ? { notes: payload.notes } : {}),
            }),
          });
          const analysis = validateModelOutput(raw, coachResponseSchema);

          return res.json({
            ok: true,
            symbol: payload.symbol,
            stance: payload.scenario,
            price: payload.price,
            threshold: payload.threshold,
            guidance: analysis.actionNote,
            risk,
            model: analysis,
            source: 'anthropic',
          });
        } catch {
          return res.json({
            ok: true,
            symbol: payload.symbol,
            stance: payload.scenario,
            price: payload.price,
            threshold: payload.threshold,
            guidance: `${payload.symbol} is ${payload.scenario} near ${payload.price}. Keep position sizing disciplined and respect the ${payload.threshold}% risk band.`,
            risk,
            source: 'local',
          });
        }
      }

      res.json({
        ok: true,
        symbol: payload.symbol,
        stance: payload.scenario,
        price: payload.price,
        threshold: payload.threshold,
        guidance: `${payload.symbol} is ${payload.scenario} near ${payload.price}. Keep position sizing disciplined and respect the ${payload.threshold}% risk band.`,
        risk,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid coaching request';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/market/historical', (req: Request, res: Response) => {
    const symbol = sanitizeSymbol(req.query.symbol ?? 'AAPL');
    const multiplier = Number(req.query.multiplier ?? 1);
    const timespan = String(req.query.timespan ?? 'day');

    res.json({
      ok: true,
      symbol,
      multiplier,
      timespan,
      source: 'polygon',
      endpoint: '/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}',
      note: 'Use a valid Polygon API key on the server to populate this endpoint.',
      apiKeyConfigured: Boolean(env.polygonApiKey ?? process.env.POLYGON_API_KEY),
    });
  });

  app.get('/api/market/quote', (req: Request, res: Response) => {
    const symbol = sanitizeSymbol(req.query.symbol ?? 'AAPL');

    res.json({
      ok: true,
      symbol,
      bid: 0,
      ask: 0,
      last: 0,
      source: 'polygon',
      note: 'Real-time quote access depends on the provider plan and a valid token.',
      apiKeyConfigured: Boolean(env.polygonApiKey ?? process.env.POLYGON_API_KEY),
    });
  });

  app.get('/api/market/snapshot', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'Market snapshot integration remains unverified pending the official endpoint contract from the provider.',
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

export function startServer(env: Partial<ServerEnvironment> = {}): Express {
  const port = Number(env.port ?? process.env.PORT ?? 3001);
  const app = createServer(env);

  app.listen(port, () => {
    console.info(`Market Coach proxy listening on port ${port}`);
  });

  return app;
}

export default createServer;
