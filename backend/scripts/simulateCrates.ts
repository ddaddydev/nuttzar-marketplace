/**
 * Crate simulation stress test — runs 1,000 opens per box locally.
 *
 * Uses the pure engine directly (no DB, no HTTP).
 * Run: npx tsx scripts/simulateCrates.ts
 *
 * Output: total spent, total returned, EV, actual house edge per box.
 */

import { rollCrate, calculateEV, EngineItem } from '../src/modules/games/crates/crates.engine';

// ─── Box definitions (mirrors prisma/seed.ts) ─────────────────────────────────

const BOXES: Array<{ name: string; price: number; items: EngineItem[] }> = [
  {
    name: 'Box 1',
    price: 100_000,
    items: [
      { id: 1, name: 'Xanax',              tornId: 206,  value: 865_000, weight: 4,  isRwWeapon: false, rarity: 'rare' },
      { id: 2, name: 'Bottle of Beer',     tornId: null, value: 700,     weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 3, name: 'Bag of Bon Bons',    tornId: null, value: 610,     weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 4, name: 'Cardholder',         tornId: null, value: 7_300,   weight: 20, isRwWeapon: false, rarity: 'common' },
      { id: 5, name: 'Billfold',           tornId: null, value: 37_000,  weight: 8,  isRwWeapon: false, rarity: 'uncommon' },
      { id: 6, name: 'Cannabis',           tornId: 196,  value: 9_000,   weight: 20, isRwWeapon: false, rarity: 'common' },
      { id: 7, name: 'Gold Ring',          tornId: null, value: 500,     weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 8, name: 'Shark Fin',          tornId: null, value: 66_000,  weight: 8,  isRwWeapon: false, rarity: 'uncommon' },
      { id: 9, name: 'Bottle of Sake',     tornId: null, value: 1_800,   weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 10, name: 'Can of Goose Juice', tornId: null, value: 305_000, weight: 4, isRwWeapon: false, rarity: 'rare' },
    ],
  },
  {
    name: 'Box 2',
    price: 500_000,
    items: [
      { id: 11, name: 'FHC',                tornId: null, value: 12_500_000, weight: 4,  isRwWeapon: false, rarity: 'rare' },
      { id: 12, name: 'Bottle of Beer',     tornId: null, value: 700,        weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 13, name: 'Bag of Bon Bons',    tornId: null, value: 610,        weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 14, name: 'Cardholder',         tornId: null, value: 7_300,      weight: 20, isRwWeapon: false, rarity: 'common' },
      { id: 15, name: 'Billfold',           tornId: null, value: 37_000,     weight: 12, isRwWeapon: false, rarity: 'uncommon' },
      { id: 16, name: 'Cannabis',           tornId: 196,  value: 9_000,      weight: 20, isRwWeapon: false, rarity: 'common' },
      { id: 17, name: 'Gold Ring',          tornId: null, value: 500,        weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 18, name: 'Shark Fin',          tornId: null, value: 66_000,     weight: 12, isRwWeapon: false, rarity: 'uncommon' },
      { id: 19, name: 'Bottle of Sake',     tornId: null, value: 1_800,      weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 20, name: 'Can of Goose Juice', tornId: null, value: 305_000,    weight: 6,  isRwWeapon: false, rarity: 'rare' },
    ],
  },
  {
    name: 'Box 3',
    price: 225_000,
    items: [
      { id: 21, name: 'Drug Pack',          tornId: null, value: 4_450_000, weight: 4,  isRwWeapon: false, rarity: 'rare' },
      { id: 22, name: 'Bottle of Beer',     tornId: null, value: 700,       weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 23, name: 'Bag of Bon Bons',    tornId: null, value: 610,       weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 24, name: 'Cardholder',         tornId: null, value: 7_300,     weight: 20, isRwWeapon: false, rarity: 'common' },
      { id: 25, name: 'Billfold',           tornId: null, value: 37_000,    weight: 10, isRwWeapon: false, rarity: 'uncommon' },
      { id: 26, name: 'Cannabis',           tornId: 196,  value: 9_000,     weight: 20, isRwWeapon: false, rarity: 'common' },
      { id: 27, name: 'Gold Ring',          tornId: null, value: 500,       weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 28, name: 'Shark Fin',          tornId: null, value: 66_000,    weight: 10, isRwWeapon: false, rarity: 'uncommon' },
      { id: 29, name: 'Bottle of Sake',     tornId: null, value: 1_800,     weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 30, name: 'Can of Goose Juice', tornId: null, value: 305_000,   weight: 6,  isRwWeapon: false, rarity: 'rare' },
    ],
  },
  {
    name: 'Box 4',
    price: 25_000,
    items: [
      { id: 31, name: 'Xanax',              tornId: 206,  value: 865_000,    weight: 1,  isRwWeapon: false, rarity: 'legendary' },
      { id: 32, name: 'FHC',                tornId: null, value: 12_500_000, weight: 1,  isRwWeapon: false, rarity: 'legendary' },
      { id: 33, name: 'Drug Pack',          tornId: null, value: 4_450_000,  weight: 2,  isRwWeapon: false, rarity: 'legendary' },
      { id: 34, name: 'Bottle of Beer',     tornId: null, value: 700,        weight: 35, isRwWeapon: false, rarity: 'common' },
      { id: 35, name: 'Bag of Bon Bons',    tornId: null, value: 610,        weight: 35, isRwWeapon: false, rarity: 'common' },
      { id: 36, name: 'Cardholder',         tornId: null, value: 7_300,      weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 37, name: 'Billfold',           tornId: null, value: 37_000,     weight: 10, isRwWeapon: false, rarity: 'uncommon' },
      { id: 38, name: 'Cannabis',           tornId: 196,  value: 9_000,      weight: 20, isRwWeapon: false, rarity: 'common' },
      { id: 39, name: 'Gold Ring',          tornId: null, value: 500,        weight: 40, isRwWeapon: false, rarity: 'common' },
      { id: 40, name: 'Shark Fin',          tornId: null, value: 66_000,     weight: 5,  isRwWeapon: false, rarity: 'uncommon' },
      { id: 41, name: 'Bottle of Sake',     tornId: null, value: 1_800,      weight: 30, isRwWeapon: false, rarity: 'common' },
      { id: 42, name: 'Can of Goose Juice', tornId: null, value: 305_000,    weight: 2,  isRwWeapon: false, rarity: 'rare' },
    ],
  },
];

// ─── Simulation ───────────────────────────────────────────────────────────────

const OPENS = 1_000;

function formatCredits(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function simulate(box: (typeof BOXES)[number]) {
  let totalSpent = 0;
  let totalReturned = 0;
  const itemCounts = new Map<string, number>();

  for (let i = 0; i < OPENS; i++) {
    const roll = rollCrate(box.items);
    totalSpent += box.price;
    totalReturned += roll.payout;
    itemCounts.set(roll.itemName, (itemCounts.get(roll.itemName) ?? 0) + 1);
  }

  const { ev: theoreticalEV, houseEdge: theoreticalEdge } = calculateEV(box.items, box.price);
  const simulatedEdge = (totalSpent - totalReturned) / totalSpent;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${box.name}  (${formatCredits(box.price)} per open, n=${OPENS})`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Total spent:       ${formatCredits(totalSpent)}`);
  console.log(`  Total returned:    ${formatCredits(totalReturned)}`);
  console.log(`  Net house take:    ${formatCredits(totalSpent - totalReturned)}`);
  console.log(`  Theoretical EV:    ${formatCredits(theoreticalEV)}  (${(theoreticalEdge * 100).toFixed(2)}% edge)`);
  console.log(`  Simulated EV:      ${formatCredits(totalReturned / OPENS)}  (${(simulatedEdge * 100).toFixed(2)}% edge)`);
  console.log(`\n  Item distribution:`);

  const sorted = [...itemCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    const pct = ((count / OPENS) * 100).toFixed(1).padStart(5);
    const bar = '█'.repeat(Math.round(count / OPENS * 40));
    console.log(`    ${pct}%  ${bar}  ${name} (×${count})`);
  }
}

console.log('Torn Crate Simulation');
console.log(`Running ${OPENS.toLocaleString()} opens per box...\n`);

for (const box of BOXES) {
  simulate(box);
}

console.log(`\n${'═'.repeat(60)}`);
console.log('  Done.');
