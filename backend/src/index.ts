// Load .env file before anything else (local dev — Railway injects vars directly)
import 'dotenv/config';
// Validate env vars — crashes fast if anything is missing or wrong
import './config/env';

import { createApp } from './app';
import { prisma } from './db/client';
import { env } from './config/env';
import { startCleanupJob } from './jobs/cleanup';

async function main(): Promise<void> {
  // Verify database connectivity before accepting traffic
  await prisma.$connect();
  console.log('[DB] Connected');

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(`[Server] Listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  // Start background jobs
  startCleanupJob();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Server] ${signal} received — shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
