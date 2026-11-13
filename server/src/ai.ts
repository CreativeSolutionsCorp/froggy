import { z } from 'zod';

export const briefResponseSchema = z.object({
  marketContextSummary: z.string().min(1),
  setups: z.array(
    z.object({
      ticker: z.string().min(1),
      direction: z.enum(['long', 'short']),
      entryZone: z.object({
        low: z.number().positive(),
        high: z.number().positive(),
      }).refine((value) => value.low <= value.high, { message: 'Entry zone low must not exceed its high.' }),
      stopPrice: z.number().positive(),
      targets: z.array(z.number().positive()).min(1).max(5),
      rewardToRisk: z.number().positive(),
      confidence: z.enum(['low', 'medium', 'high']),
      reasoning: z.string().min(1),
      dataPoints: z.array(z.string()).min(1),
      invalidationCondition: z.string().min(1),
    }),
  ).min(1).max(5),
  risks: z.array(z.string()).min(1),
  disclaimer: z.string().min(1).refine((value) => /not financial advice/i.test(value), {
    message: 'Disclaimers must say the output is not financial advice.',
  }),
});

export const coachResponseSchema = z.object({
  headline: z.string().min(1),
  actionNote: z.string().min(1),
  updatedLevels: z.object({
    entry: z.number().positive(),
    stop: z.number().positive(),
    target: z.number().positive(),
  }),
  riskWarning: z.string().optional(),
  dataQualityNote: z.string().min(1),
  disclaimer: z.string().min(1).refine((value) => /not financial advice/i.test(value), {
    message: 'Disclaimers must say the output is not financial advice.',
  }),
});

export function validateModelOutput<T>(payload: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new Error(`Model validation failed: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }

  return result.data;
}

export function buildBriefingPrompt(input: {
  symbol: string;
  timeframe: string;
  notes?: string;
  data: Array<{ label: string; value: string }>;
}): string {
  const details = input.data.length > 0
    ? input.data.map((item) => `${item.label}: ${item.value}`).join('; ')
    : 'insufficient data';

  return [
    'You are an analyst, not an advisor.',
    'Use only the data supplied. If the data is incomplete, say "insufficient data" instead of guessing.',
    'Never state certainty or guarantee profit.',
    'Return at least one complete setup only when the supplied market data supports one; otherwise describe insufficient data in the summary and risks.',
    'Every setup must include positive entry bounds, a positive stop, at least one positive target, and an invalidation condition.',
    'For each setup, include the exact supplied Polygon values in dataPoints; never invent or round source data.',
    `Symbol: ${input.symbol}`,
    `Timeframe: ${input.timeframe}`,
    `Data: ${details}`,
    input.notes ? `Notes: ${input.notes}` : 'Notes: none',
    'Return JSON only matching the briefing schema.',
    'This output is for research only and is not financial advice.',
  ].join('\n');
}

export function buildCoachPrompt(input: {
  symbol: string;
  quote: {
    last: number;
    bid: number;
    ask: number;
    timestamp: string;
  };
  dataQuality: 'live' | 'delayed' | 'unreadable';
  notes?: string;
}): string {
  return [
    'You are an analyst, not an advisor.',
    'Treat the API quote values as the source of truth. Use the image only for open positions, average cost, and chart drawings, and flag mismatches.',
    'If the data is incomplete or unreadable, say "insufficient data" instead of guessing.',
    'Never state certainty or guarantee profit.',
    'Include a stop and the invalidation condition for any setup or action note.',
    `Symbol: ${input.symbol}`,
    `Quote: ${JSON.stringify(input.quote)}`,
    `Data quality: ${input.dataQuality}`,
    input.notes ? `Notes: ${input.notes}` : 'Notes: none',
    'Return JSON only matching the live coach schema.',
    'This output is for research only and is not financial advice.',
  ].join('\n');
}
