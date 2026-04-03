import { prisma } from '../../db/client';
import { ValidationError } from '../../utils/errors';
import { assertPositiveInt } from '../../utils/wallet';

export async function getBalance(userId: number): Promise<{ credits: number; keys: number }> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { credits: true, keys: true },
  });
  if (!wallet) throw new ValidationError('Wallet not found');
  return { credits: wallet.credits, keys: wallet.keys };
}

/**
 * Admin-only: adjust a user's balance.
 * In production, real deposits would go through a payment webhook,
 * not a direct API call. This endpoint is for admin credit adjustments only.
 */
export async function adminAdjustCredits(
  userId: number,
  delta: number,
  adminUserId: number,
): Promise<{ credits: number }> {
  assertPositiveInt(Math.abs(delta), 'delta');

  // Ensure user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new ValidationError('User not found');

  const wallet = await prisma.wallet.update({
    where: { userId },
    data: {
      credits: { increment: delta },
      version: { increment: 1 },
    },
    select: { credits: true },
  });

  console.log(`[Admin ${adminUserId}] adjusted credits for user ${userId} by ${delta}`);
  return { credits: wallet.credits };
}
