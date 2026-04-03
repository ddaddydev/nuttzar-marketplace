/**
 * Per-user crate cooldown middleware.
 *
 * Enforces a minimum 750ms gap between crate opens per user.
 * Uses an in-memory Map — sufficient for single-process Railway deployment.
 * For multi-instance deployments, swap the Map for a Redis SET with TTL.
 *
 * Separate from the express-rate-limit window check in crates.router.ts,
 * which handles burst protection (max 10 opens per 5 seconds).
 */

import { Request, Response, NextFunction } from 'express';

const COOLDOWN_MS = 750;

// Map<userId, lastOpenTimestampMs>
const lastOpen = new Map<number, number>();

// Prune stale entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [userId, ts] of lastOpen) {
    if (ts < cutoff) lastOpen.delete(userId);
  }
}, 5 * 60_000);

export function crateCooldown(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.userId;
  if (!userId) {
    next();
    return;
  }

  const last = lastOpen.get(userId) ?? 0;
  const elapsed = Date.now() - last;

  if (elapsed < COOLDOWN_MS) {
    res.status(429).json({ success: false, error: 'Slow down' });
    return;
  }

  lastOpen.set(userId, Date.now());
  next();
}

/**
 * Stricter burst limiter — max 10 opens per 5 seconds per user.
 * Stacks on top of the 750ms cooldown.
 */
const burstWindow = new Map<number, number[]>();

export function crateBurstLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.userId;
  if (!userId) {
    next();
    return;
  }

  const now = Date.now();
  const windowMs = 5_000;
  const maxInWindow = 10;

  const timestamps = (burstWindow.get(userId) ?? []).filter(
    (ts) => now - ts < windowMs,
  );

  if (timestamps.length >= maxInWindow) {
    res.status(429).json({ success: false, error: 'Slow down' });
    return;
  }

  timestamps.push(now);
  burstWindow.set(userId, timestamps);
  next();
}
