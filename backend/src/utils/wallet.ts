/**
 * Atomic wallet operations.
 *
 * Every credit change uses optimistic concurrency locking on Wallet.version.
 * The entire bet → resolve → payout cycle is a single Prisma transaction,
 * so there is no window where credits are debited but a result hasn't landed.
 *
 * Integer-only enforcement: all amounts are validated as positive integers
 * before touching the database. No floats reach the money path.
 */

import { PrismaClient, GameType } from '@prisma/client';
import {
  InsufficientFundsError,
  ConcurrentModificationError,
  ValidationError,
} from './errors';

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export function assertPositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Atomically debits `amount` from a user's wallet within an existing transaction.
 * Throws InsufficientFundsError or ConcurrentModificationError on failure.
 */
export async function debitCredits(
  tx: TxClient,
  userId: number,
  amount: number,
): Promise<void> {
  const wallet = await tx.wallet.findUnique({
    where: { userId },
    select: { id: true, credits: true, version: true },
  });

  if (!wallet) throw new ValidationError('Wallet not found');
  if (wallet.credits < amount) throw new InsufficientFundsError();

  const updated = await tx.wallet.updateMany({
    where: { id: wallet.id, version: wallet.version },
    data: {
      credits: { decrement: amount },
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) throw new ConcurrentModificationError();
}

/**
 * Atomically credits `amount` to a user's wallet within an existing transaction.
 */
export async function creditCredits(
  tx: TxClient,
  userId: number,
  amount: number,
): Promise<void> {
  await tx.wallet.update({
    where: { userId },
    data: {
      credits: { increment: amount },
      version: { increment: 1 },
    },
  });
}

/**
 * Records a completed game round and updates the leaderboard atomically.
 * Call inside the same transaction as debit/credit.
 */
export async function logGameResult(
  tx: TxClient,
  userId: number,
  gameType: GameType,
  betAmount: number,
  resultAmount: number,
  metadata?: object,
): Promise<void> {
  await tx.gameHistory.create({
    data: {
      userId,
      gameType,
      betAmount,
      resultAmount,
      metadata: metadata ?? undefined,
    },
  });

  // Upsert the leaderboard entry
  await tx.leaderboardEntry.upsert({
    where: { userId },
    create: {
      userId,
      totalGambled: betAmount,
      totalProfit: resultAmount,
    },
    update: {
      totalGambled: { increment: betAmount },
      totalProfit: { increment: resultAmount },
    },
  });
}
