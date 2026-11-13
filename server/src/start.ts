import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { startServer } from './index';

try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error;
  }
}

const port = Number(process.env.PORT ?? 3001);

startServer({
  port,
  sharedAppToken: process.env.SHARED_APP_TOKEN ?? '',
  polygonApiKey: process.env.POLYGON_API_KEY ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
});
