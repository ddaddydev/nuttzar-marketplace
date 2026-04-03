import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { errorHandler } from './middleware/errorHandler';

import authRouter from './modules/auth/auth.router';
import walletRouter from './modules/wallet/wallet.router';
import leaderboardRouter from './modules/leaderboard/leaderboard.router';
import adminRouter from './modules/admin/admin.router';
import cratesRouter from './modules/games/crates/crates.router';

export function createApp(): express.Application {
  const app = express();

  // ── Security headers ─────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ──────────────────────────────────────────────────────────────────
  // In production, lock this down to your frontend origin.
  const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin:
        process.env.NODE_ENV === 'production'
          ? (origin, cb) => {
              if (!origin || allowedOrigins.includes(origin)) cb(null, true);
              else cb(new Error('Not allowed by CORS'));
            }
          : true,
      credentials: true,
    }),
  );

  // ── Body parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10kb' }));

  // ── Global rate limiter ───────────────────────────────────────────────────
  // Tighter limits are applied per-game-route via separate limiters
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: 'Too many requests' },
    }),
  );

  // Auth endpoints get stricter limits to prevent brute-force
  app.use(
    '/api/v1/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: 'Too many auth attempts' },
    }),
  );

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/wallet', walletRouter);
  app.use('/api/v1', leaderboardRouter);      // /leaderboard, /recent-wins, /history
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/games/crates', cratesRouter);

  // More game routers will be mounted here as each game is built:
  // app.use('/api/v1/games/crash', crashRouter);
  // app.use('/api/v1/pvp', pvpRouter);

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found' });
  });

  // ── Global error handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
}
