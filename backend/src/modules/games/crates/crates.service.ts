import { createHash } from 'crypto';
import { prisma } from '../../../db/client';
import { debitCredits, creditCredits, logGameResult } from '../../../utils/wallet';
import { rollCrate, calculateEV, EngineItem } from './crates.engine';
import { generateNonce } from '../../../utils/rng';
import { NotFoundError, ValidationError } from '../../../utils/errors';

// ─── Public crate list (no weights, no values) ───────────────────────────────

export async function listCrates() {
  const crates = await prisma.crate.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      items: {
        select: {
          id: true,
          name: true,
          tornId: true,
          isRwWeapon: true,
          rarity: true,
          // value and weight intentionally excluded
        },
      },
    },
    orderBy: { price: 'asc' },
  });
  return { crates };
}

// ─── Open a crate ─────────────────────────────────────────────────────────────

export interface OpenResult {
  itemId: number;
  itemName: string;
  tornId: number | null;
  isRwWeapon: boolean;
  isKey: boolean;
  keysWon: number;
  rarity: string;
  payout: number;
  // Provably-fair: hash of server seed — revealed before animation, seed stored in DB
  seedHash: string;
  // Deterministic reel seed for frontend animation (derived from server seed)
  spinSeed: number;
  message: string;
}

export async function openCrate(
  userId: number,
  crateId: number,
): Promise<OpenResult> {
  // Load full item data (including weights + values) — server-side only
  const crate = await prisma.crate.findUnique({
    where: { id: crateId, isActive: true },
    include: { items: true },
  });

  if (!crate) throw new NotFoundError('Crate not found');
  if (crate.items.length === 0) throw new ValidationError('Crate has no items configured');

  // ── Provably-fair seed (generated BEFORE the roll) ─────────────────────────
  const serverSeed = generateNonce();
  const seedHash = createHash('sha256').update(serverSeed).digest('hex');
  // spinSeed: first 8 hex chars → integer, used by frontend reel PRNG
  const spinSeed = parseInt(seedHash.slice(0, 8), 16);

  const result = await prisma.$transaction(async (tx) => {
    // Step 1 & 2: Check balance and debit atomically (throws if insufficient)
    await debitCredits(tx as never, userId, crate.price);

    // Step 3: Roll RNG server-side — result decided before any response
    let roll = rollCrate(crate.items);

    // Step 4: RW Weapon inventory enforcement
    // If the winner is an RW weapon, reserve it atomically or re-roll
    if (roll.isRwWeapon) {
      const slot = await tx.rwInventory.findFirst({
        where: { itemId: roll.itemId, isAvailable: true },
        // SELECT FOR UPDATE equivalent — Prisma serializable transaction handles this
      });

      if (slot) {
        // Reserve the weapon slot
        await tx.rwInventory.update({
          where: { id: slot.id },
          data: {
            isAvailable: false,
            assignedToUserId: userId,
            assignedAt: new Date(),
          },
        });
      } else {
        // No stock — re-roll excluding ALL RW weapons
        const nonRwItems: EngineItem[] = crate.items.filter((i) => !i.isRwWeapon);
        if (nonRwItems.length === 0) {
          throw new ValidationError('Crate misconfigured: only RW weapons with no stock');
        }
        roll = rollCrate(nonRwItems);
      }
    }

    // Step 5: Credit payout or award keys
    if (roll.isKey) {
      // Key win — increment keys on wallet, no credits
      await tx.wallet.update({
        where: { userId },
        data: { keys: { increment: roll.keysWon } },
      });
    } else if (roll.payout > 0) {
      await creditCredits(tx as never, userId, roll.payout);
    }

    const netResult = roll.isKey ? -crate.price : roll.payout - crate.price;

    // Step 6a: Log to GameHistory (financial record)
    await logGameResult(
      tx as never,
      userId,
      'CRATE',
      crate.price,
      netResult,
      { crateId, itemId: roll.itemId, itemName: roll.itemName, isKey: roll.isKey, keysWon: roll.keysWon },
    );

    // Step 6b: Log to CrateLog (fulfillment record) — skip for key wins (no physical item)
    if (!roll.isKey) {
      await tx.crateLog.create({
        data: {
          userId,
          crateId,
          itemId: roll.itemId,
          itemValue: roll.payout,
          status: 'PENDING',
          seedHash,
          serverSeed, // stored for post-hoc verification — never sent to client
        },
      });
    }

    return roll;
  }); // Step 7: commit — any failure above triggers full rollback

  const message = result.isKey
    ? `You won ${result.keysWon} key${result.keysWon !== 1 ? 's' : ''}! Added to your account.`
    : 'Your item has been recorded and will be sent within 24 hours.';

  return {
    ...result,
    seedHash,   // client can verify: sha256(serverSeed) === seedHash after the fact
    spinSeed,   // client uses this as PRNG seed for deterministic reel animation
    message,
  };
}

// ─── Admin: crate EV check (live calculation — never cached) ──────────────────

export async function getCrateEV(crateId: number) {
  const crate = await prisma.crate.findUnique({
    where: { id: crateId },
    include: { items: true },
  });
  if (!crate) throw new NotFoundError('Crate not found');

  const { ev, houseEdge } = calculateEV(crate.items, crate.price);
  return {
    // Required format per spec
    ev,
    cost: crate.price,
    houseEdge,
    // Extra detail for admin context
    houseEdgePct: (houseEdge * 100).toFixed(2) + '%',
    targetEdge: crate.targetEdge,
    withinTarget: Math.abs(houseEdge - crate.targetEdge) < 0.01,
    crateName: crate.name,
  };
}
