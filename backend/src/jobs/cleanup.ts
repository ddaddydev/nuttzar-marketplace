/**
 * Periodic cleanup job.
 * Runs on a setInterval — no Redis, no external scheduler needed.
 *
 * Handles:
 * 1. Expired GameSessions (Blackjack / Heist) — delete stale rows
 * 2. Expired PvP WAITING matches — auto-cancel and refund bets
 */

import { prisma } from '../db/client';
import { creditCredits } from '../utils/wallet';

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

async function expireGameSessions(): Promise<void> {
  const { count } = await prisma.gameSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (count > 0) console.log(`[Cleanup] Deleted ${count} expired game sessions`);
}

async function expireWaitingMatches(): Promise<void> {
  const expired = await prisma.pvpMatch.findMany({
    where: {
      status: 'WAITING',
      expiresAt: { lt: new Date() },
    },
    select: { id: true, player1Id: true, betAmount: true },
  });

  if (expired.length === 0) return;

  for (const match of expired) {
    await prisma.$transaction(async (tx) => {
      // Refund the creator's bet
      await creditCredits(tx as never, match.player1Id, match.betAmount);

      await tx.pvpMatch.update({
        where: { id: match.id },
        data: { status: 'CANCELLED' },
      });
    });
  }

  console.log(`[Cleanup] Cancelled ${expired.length} expired WAITING matches`);
}

export function startCleanupJob(): void {
  const run = async () => {
    try {
      await Promise.all([expireGameSessions(), expireWaitingMatches()]);
    } catch (err) {
      console.error('[Cleanup] Job error:', err);
    }
  };

  // Run once immediately on startup, then on interval
  run();
  setInterval(run, INTERVAL_MS);
  console.log('[Cleanup] Job started — interval:', INTERVAL_MS / 1000, 's');
}
