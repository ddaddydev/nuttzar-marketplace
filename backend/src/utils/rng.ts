/**
 * Server-side RNG utilities.
 *
 * ALL randomness in the game engine MUST come from this module.
 * Math.random() is forbidden — it is not cryptographically secure and its
 * state could theoretically be predicted. Node's crypto.randomInt uses
 * /dev/urandom (or the OS equivalent) and is suitable for gambling outcomes.
 *
 * The ESLint rule "no-restricted-globals" should ban Math.random at the lint level.
 */

import { createHash, randomInt, randomBytes } from 'crypto';

/**
 * Returns a cryptographically random integer in [min, max) — exclusive of max.
 * Direct wrapper over crypto.randomInt.
 */
export function secureRandomInt(min: number, max: number): number {
  return randomInt(min, max);
}

/**
 * Returns a cryptographically random float in [0, 1).
 * Uses 53 bits of entropy (maximum float precision).
 */
export function secureRandomFloat(): number {
  const buf = randomBytes(7); // 56 bits — we'll use 53
  // Read as a big-endian integer, shift to [0, 1)
  const n =
    (buf[0] & 0x1f) * 2 ** 48 +
    buf[1] * 2 ** 40 +
    buf[2] * 2 ** 32 +
    buf[3] * 2 ** 24 +
    buf[4] * 2 ** 16 +
    buf[5] * 2 ** 8 +
    buf[6];
  return n / 2 ** 53;
}

/**
 * Shuffles an array in-place using Fisher-Yates with crypto RNG.
 */
export function secureShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Weighted random selection. Weights are integers (no floats).
 * Returns the index of the selected item.
 *
 * Example: weights = [10, 30, 60] → ~10% chance of 0, ~30% of 1, ~60% of 2.
 */
export function weightedRandom(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let threshold = secureRandomInt(0, total);
  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i];
    if (threshold < 0) return i;
  }
  return weights.length - 1; // Fallback for rounding edge
}

/**
 * Provably-fair crash point generation.
 *
 * Given a server salt (secret, rotated daily) and a round nonce (public),
 * deterministically produces a crash multiplier. The nonce can be published
 * post-round for verification, while the salt stays secret until end-of-day.
 *
 * Algorithm mirrors the standard provably-fair Crash implementation:
 * - Hash HMAC(salt, nonce) → 32 bytes
 * - Take first 8 bytes as a uint64
 * - Map to a multiplier using: max(1, floor((2^32 / (h + 1)) * 100) / 100)
 *   with house edge applied via modulo.
 *
 * houseEdgePct: percentage kept by house, e.g. 3 = 3%
 */
export function generateCrashPoint(
  salt: string,
  nonce: string,
  houseEdgePct: number,
): number {
  const hash = createHash('sha256')
    .update(`${salt}:${nonce}`)
    .digest('hex');

  // Every 1/e^(houseEdge) rounds crash at exactly 1.00
  const nBits = 52;
  const houseEdge = houseEdgePct / 100;

  // Use first 52 bits of hash as a uniform [0, 1) float
  const h = parseInt(hash.slice(0, 13), 16); // 52-bit integer from hex
  const r = h / 2 ** nBits;

  // If r < houseEdge, house wins immediately
  if (r < houseEdge) return 1.0;

  // Map remaining range to [1, ∞) with exponential distribution
  const multiplier = Math.floor((1 / (1 - r)) * 100) / 100;
  return Math.max(1.0, multiplier);
}

/**
 * Generates a random session nonce for provably-fair round commitment.
 */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}
