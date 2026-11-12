import { startServer } from './index';

const port = Number(process.env.PORT ?? 3001);

startServer({
  port,
  sharedAppToken: process.env.SHARED_APP_TOKEN ?? '',
  polygonApiKey: process.env.POLYGON_API_KEY ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
});
