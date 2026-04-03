/**
 * Crate RNG engine — pure functions, no I/O.
 *
 * Weights and values NEVER leave this module toward the client.
 * The engine receives item data from the service layer and returns
 * only the selected item's identity (id, name, tornId) — not its value.
 */

import { weightedRandom } from '../../../utils/rng';

export interface EngineItem {
  id: number;
  name: string;
  tornId: number | null;
  value: number;
  weight: number;
  isRwWeapon: boolean;
  isKey: boolean;
  keyAmount: number;
  rarity: string;
}

export interface EngineResult {
  itemId: number;
  itemName: string;
  tornId: number | null;
  isRwWeapon: boolean;
  isKey: boolean;
  keysWon: number;
  rarity: string;
  payout: number; // credits awarded to user (0 if isKey)
}

/**
 * Select a winning item from the crate using weighted RNG.
 * The payout is the item's credit value (0 for key items).
 */
export function rollCrate(items: EngineItem[]): EngineResult {
  if (items.length === 0) throw new Error('Crate has no items');

  const weights = items.map((i) => i.weight);
  const idx = weightedRandom(weights);
  const won = items[idx];

  return {
    itemId: won.id,
    itemName: won.name,
    tornId: won.tornId,
    isRwWeapon: won.isRwWeapon,
    isKey: won.isKey,
    keysWon: won.isKey ? won.keyAmount : 0,
    rarity: won.rarity,
    payout: won.isKey ? 0 : won.value,
  };
}

/**
 * Calculate the expected value of a crate given its items and cost.
 * Returns { ev, houseEdge } where houseEdge is a decimal (0.05 = 5%).
 *
 * EV = sum(item.value * item.probability)
 * houseEdge = (cost - EV) / cost
 */
export function calculateEV(
  items: EngineItem[],
  cost: number,
): { ev: number; houseEdge: number } {
  const totalWeight = items.reduce((a, b) => a + b.weight, 0);
  const ev = items.reduce((sum, item) => {
    const prob = item.weight / totalWeight;
    return sum + item.value * prob;
  }, 0);

  const houseEdge = cost > 0 ? (cost - ev) / cost : 0;
  return { ev: Math.round(ev), houseEdge };
}
