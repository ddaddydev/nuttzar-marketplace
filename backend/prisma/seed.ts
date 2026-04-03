/**
 * Prisma seed — creates the 4 crate boxes + Key Chest if they don't exist.
 * Run: npx prisma db seed
 *
 * torn_id values: populated here where known, update via admin panel for others.
 * Image URL pattern: https://www.torn.com/images/items/{tornId}/large.png
 *
 * Known Torn IDs:
 *   Xanax:    206
 *   Cannabis: 196
 *   (All others should be verified via Torn API and updated in admin panel)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function rarity(weight: number): string {
  if (weight >= 25) return 'common';
  if (weight >= 10) return 'uncommon';
  if (weight >= 4)  return 'rare';
  return 'legendary';
}

const BOXES = [
  {
    name: 'Rookie Chest',
    description: 'Entry-level case — balanced rewards for new players.',
    price: 100_000,
    targetEdge: 0.0465,
    items: [
      { name: 'Xanax',              tornId: 206,  value: 865_000, weight: 4,  isKey: false, keyAmount: 1 },
      { name: 'Bottle of Beer',     tornId: 180,  value: 700,     weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Bag of Bon Bons',    tornId: 37,   value: 610,     weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Cardholder',         tornId: 1079, value: 7_300,   weight: 20, isKey: false, keyAmount: 1 },
      { name: 'Billfold',           tornId: 1080, value: 37_000,  weight: 8,  isKey: false, keyAmount: 1 },
      { name: 'Cannabis',           tornId: 196,  value: 9_000,   weight: 20, isKey: false, keyAmount: 1 },
      { name: 'Gold Ring',          tornId: 53,   value: 500,     weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Shark Fin',          tornId: 1485, value: 66_000,  weight: 8,  isKey: false, keyAmount: 1 },
      { name: 'Bottle of Sake',     tornId: 294,  value: 1_800,   weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Can of Goose Juice', tornId: 985,  value: 305_000, weight: 4,  isKey: false, keyAmount: 1 },
    ],
  },
  {
    name: 'High Roller Vault',
    description: 'High-stakes case — rare jackpot for the bold.',
    price: 500_000,
    targetEdge: 0.0488,
    items: [
      { name: 'FHC',                tornId: 367,  value: 12_500_000, weight: 4,  isKey: false, keyAmount: 1 },
      { name: 'Bottle of Beer',     tornId: 180,  value: 700,        weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Bag of Bon Bons',    tornId: 37,   value: 610,        weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Cardholder',         tornId: 1079, value: 7_300,      weight: 20, isKey: false, keyAmount: 1 },
      { name: 'Billfold',           tornId: 1080, value: 37_000,     weight: 12, isKey: false, keyAmount: 1 },
      { name: 'Cannabis',           tornId: 196,  value: 9_000,      weight: 20, isKey: false, keyAmount: 1 },
      { name: 'Gold Ring',          tornId: 53,   value: 500,        weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Shark Fin',          tornId: 1485, value: 66_000,     weight: 12, isKey: false, keyAmount: 1 },
      { name: 'Bottle of Sake',     tornId: 294,  value: 1_800,      weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Can of Goose Juice', tornId: 985,  value: 305_000,    weight: 6,  isKey: false, keyAmount: 1 },
    ],
  },
  {
    name: "Smuggler's Cache",
    description: 'Mid-tier case — drug pack jackpot.',
    price: 225_000,
    targetEdge: 0.0498,
    items: [
      { name: 'Drug Pack',          tornId: 370,  value: 4_450_000, weight: 4,  isKey: false, keyAmount: 1 },
      { name: 'Bottle of Beer',     tornId: 180,  value: 700,       weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Bag of Bon Bons',    tornId: 37,   value: 610,       weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Cardholder',         tornId: 1079, value: 7_300,     weight: 20, isKey: false, keyAmount: 1 },
      { name: 'Billfold',           tornId: 1080, value: 37_000,    weight: 10, isKey: false, keyAmount: 1 },
      { name: 'Cannabis',           tornId: 196,  value: 9_000,     weight: 20, isKey: false, keyAmount: 1 },
      { name: 'Gold Ring',          tornId: 53,   value: 500,       weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Shark Fin',          tornId: null, value: 66_000,    weight: 10, isKey: false, keyAmount: 1 },
      { name: 'Bottle of Sake',     tornId: 294,  value: 1_800,     weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Can of Goose Juice', tornId: null, value: 305_000,   weight: 6,  isKey: false, keyAmount: 1 },
    ],
  },
  {
    name: 'Forgotten Treasure',
    description: 'Budget case — ultra-rare jackpots at a low price.',
    price: 25_000,
    targetEdge: 0.054,
    items: [
      { name: 'Xanax',              tornId: 206,  value: 865_000,    weight: 1,  isKey: false, keyAmount: 1 },
      { name: 'FHC',                tornId: null, value: 12_500_000, weight: 1,  isKey: false, keyAmount: 1 },
      { name: 'Drug Pack',          tornId: 370,  value: 4_450_000,  weight: 2,  isKey: false, keyAmount: 1 },
      { name: 'Bottle of Beer',     tornId: 180,  value: 700,        weight: 35, isKey: false, keyAmount: 1 },
      { name: 'Bag of Bon Bons',    tornId: 37,   value: 610,        weight: 35, isKey: false, keyAmount: 1 },
      { name: 'Cardholder',         tornId: 1079, value: 7_300,      weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Billfold',           tornId: 1080, value: 37_000,     weight: 10, isKey: false, keyAmount: 1 },
      { name: 'Cannabis',           tornId: 196,  value: 9_000,      weight: 20, isKey: false, keyAmount: 1 },
      { name: 'Gold Ring',          tornId: 53,   value: 500,        weight: 40, isKey: false, keyAmount: 1 },
      { name: 'Shark Fin',          tornId: null, value: 66_000,     weight: 5,  isKey: false, keyAmount: 1 },
      { name: 'Bottle of Sake',     tornId: 294,  value: 1_800,      weight: 30, isKey: false, keyAmount: 1 },
      { name: 'Can of Goose Juice', tornId: 985,  value: 305_000,    weight: 2,  isKey: false, keyAmount: 1 },
    ],
  },
  {
    name: 'Key Chest',
    description: 'Open to win keys — premium currency for exclusive content.',
    price: 50_000,
    targetEdge: 0.0,
    items: [
      { name: '1 Key',  tornId: null, value: 0, weight: 50, isKey: true, keyAmount: 1  },
      { name: '2 Keys', tornId: null, value: 0, weight: 30, isKey: true, keyAmount: 2  },
      { name: '5 Keys', tornId: null, value: 0, weight: 15, isKey: true, keyAmount: 5  },
      { name: '10 Keys',tornId: null, value: 0, weight: 4,  isKey: true, keyAmount: 10 },
      { name: '25 Keys',tornId: null, value: 0, weight: 1,  isKey: true, keyAmount: 25 },
    ],
  },
] as const;

async function main() {
  console.log('Seeding crates...');

  // Rename legacy boxes to new names if they exist
  const renames: Record<string, string> = {
    'Box 1': 'Rookie Chest',
    'Box 2': 'High Roller Vault',
    'Box 3': "Smuggler's Cache",
    'Box 4': 'Forgotten Treasure',
  };

  for (const [oldName, newName] of Object.entries(renames)) {
    const existing = await prisma.crate.findUnique({ where: { name: oldName } });
    if (existing) {
      await prisma.crate.update({ where: { id: existing.id }, data: { name: newName } });
      console.log(`  Renamed "${oldName}" → "${newName}"`);
    }
  }

  for (const box of BOXES) {
    const existing = await prisma.crate.findUnique({ where: { name: box.name } });
    if (existing) {
      console.log(`  Skipping "${box.name}" — already exists`);
      continue;
    }

    await prisma.crate.create({
      data: {
        name: box.name,
        description: box.description,
        price: box.price,
        targetEdge: box.targetEdge,
        items: {
          create: box.items.map((item) => ({
            name: item.name,
            tornId: item.tornId ?? null,
            value: item.value,
            weight: item.weight,
            isKey: item.isKey,
            keyAmount: item.keyAmount,
            rarity: item.isKey ? 'common' : rarity(item.weight),
            isRwWeapon: false,
          })),
        },
      },
    });

    console.log(`  Created "${box.name}" with ${box.items.length} items`);
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
