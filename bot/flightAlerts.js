// bot/flightAlerts.js
const axios = require('axios');

const STOCK_URL  = 'https://nuttzar-stock-worker.notsilentclips.workers.dev/api/stocks';
const WEAV3R_URL = 'https://weav3r.dev/api/marketplace';

const FLIGHT_MINS = {
  mex: { std:26,  airstrip:18,  wlt:13,  business:8  },
  cay: { std:35,  airstrip:25,  wlt:18,  business:11 },
  can: { std:41,  airstrip:29,  wlt:20,  business:12 },
  haw: { std:134, airstrip:94,  wlt:67,  business:40 },
  uk:  { std:159, airstrip:111, wlt:80,  business:48 },
  uni: { std:159, airstrip:111, wlt:80,  business:48 },
  arg: { std:167, airstrip:117, wlt:83,  business:50 },
  swi: { std:175, airstrip:123, wlt:88,  business:53 },
  jap: { std:225, airstrip:158, wlt:113, business:68 },
  chi: { std:242, airstrip:169, wlt:121, business:72 },
  uae: { std:271, airstrip:190, wlt:135, business:81 },
  sou: { std:297, airstrip:208, wlt:149, business:89 },
};

const CC_FLAGS = {
  mex:'🇲🇽', cay:'🇰🇾', can:'🇨🇦', haw:'🌺', uk:'🇬🇧', uni:'🇬🇧',
  arg:'🇦🇷', swi:'🇨🇭', jap:'🇯🇵', chi:'🇨🇳', uae:'🇦🇪', sou:'🇿🇦',
};

const CC_NAMES = {
  mex:'Mexico', cay:'Cayman Islands', can:'Canada', haw:'Hawaii',
  uk:'United Kingdom', uni:'United Kingdom', arg:'Argentina',
  swi:'Switzerland', jap:'Japan', chi:'China', uae:'UAE', sou:'South Africa',
};

// ── Weav3r price cache — individual TTL per item ───────────────────────────────
const _priceCache = new Map(); // id -> { price, ts }
const PRICE_TTL   = 5 * 60000;

async function getWeav3rPrice(itemId) {
  const cached = _priceCache.get(itemId);
  if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.price;
  try {
    const res   = await axios.get(`${WEAV3R_URL}/${itemId}`, { timeout: 8000 });
    const price = res.data?.lowest_price || res.data?.market_price || 0;
    _priceCache.set(itemId, { price, ts: Date.now() });
    return price;
  } catch { return cached?.price || 0; }
}

// ── Confidence — based on restockSamples count ────────────────────────────────
function restockConfidence({ avgRestockMins, restockSamples = 0 }) {
  if (!avgRestockMins || avgRestockMins <= 0) return { label: '❓ Unknown', tier: 'unknown' };
  if (restockSamples >= 10) return { label: '✅ Confident', tier: 'high',   lo: avgRestockMins * 0.75, hi: avgRestockMins * 1.25 };
  if (restockSamples >= 4)  return { label: '🟡 Likely',    tier: 'medium', lo: avgRestockMins * 0.75, hi: avgRestockMins * 1.25 };
  return                           { label: '⚠️ Unsure',    tier: 'low',    lo: avgRestockMins * 0.75, hi: avgRestockMins * 1.25 };
}

// ── Fetch + score all items ───────────────────────────────────────────────────
async function fetchScoredItems() {
  const res       = await axios.get(STOCK_URL, { timeout: 15000 });
  const raw       = res.data?.items || [];
  const updatedAt = res.data?.updatedAt || null;

  // Batch Weav3r prices with concurrency limit
  const uniqueIds = [...new Set(raw.map(i => i.id))];
  for (let i = 0; i < uniqueIds.length; i += 10) {
    await Promise.all(uniqueIds.slice(i, i + 10).map(id => getWeav3rPrice(id).catch(() => 0)));
    if (i + 10 < uniqueIds.length) await new Promise(r => setTimeout(r, 200));
  }

  const inStock = [], predicted = [];

  for (const item of raw) {
    const flTable   = FLIGHT_MINS[item.country];
    if (!flTable) continue;
    const sellPrice = _priceCache.get(item.id)?.price || 0;
    if (!sellPrice || !item.cost || sellPrice <= item.cost) continue;

    const margin      = sellPrice - item.cost;
    const pred        = item.prediction || {};
    const profitPerHr = Math.round(margin / ((flTable.std * 2) / 60));

    const base = {
      id: item.id, name: item.name, country: item.country,
      cost: item.cost, sellPrice, margin, profitPerHr,
      stars: pred.stars, label: pred.label || '',
      projected: pred.projected || 0,
      restockEtaMs:   pred.restockEtaMs  || null,
      depletionEtaMs: pred.depletionEtaMs || null,
      avgRestockMins: item.avgRestockMins || null,
      restockSamples: item.restockSamples || 0,
      restockQty:     item.restockQty     || null,
      confidence:     restockConfidence(item),
    };

    if (item.qty > 0 && (pred.stars || 0) >= 3) inStock.push({ ...base, qty: item.qty, inStock: true });
    else if (item.qty === 0 && pred.restockEtaMs)  predicted.push({ ...base, qty: 0, inStock: false });
  }

  // Only show predicted items where leaving NOW gets you there in time for the restock
  // Use std class as baseline for the channel embed — use user's actual class for DM alerts
  const now = Date.now();
  const filtered = predicted.filter(item => {
    const stdMs = (FLIGHT_MINS[item.country]?.std || 120) * 60000;
    const toRestock = item.restockEtaMs - now;
    // Show if restock happens within 0..2x flight time (leave now → arrive before or just after restock)
    return toRestock >= 0 && toRestock <= stdMs * 2;
  });

  inStock.sort((a, b)   => b.profitPerHr - a.profitPerHr);
  filtered.sort((a, b)  => b.profitPerHr - a.profitPerHr);
  predicted.sort((a, b) => b.profitPerHr - a.profitPerHr);
  return { inStock: inStock.slice(0, 5), predicted: filtered.slice(0, 5), allPredicted: predicted.slice(0, 5), updatedAt };
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt    = n => `$${Number(n).toLocaleString()}`;
const fmtEta = ms => {
  if (!ms) return 'now';
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (!mins) return 'now';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `~${h}h ${m}m` : `~${h}h`) : `~${mins}m`;
};

// ── Channel embed ─────────────────────────────────────────────────────────────
function buildStockEmbed(inStock, predicted, updatedAt) {
  const stockLines = inStock.length
    ? inStock.map((item, i) =>
        `**${i+1}.** ${CC_FLAGS[item.country]||'🌍'} **${item.name}** · ${item.qty.toLocaleString()} in stock\n` +
        `　+${fmt(item.margin)}/unit · **${fmt(item.profitPerHr)}/hr** · ⭐${item.stars} ${item.label}`
      ).join('\n')
    : '_No quality stock right now_';

  const predLines = predicted.length
    ? predicted.map((item, i) => {
        const flMs  = (FLIGHT_MINS[item.country]?.std || 120) * 60000;
        const eta   = item.restockEtaMs - Date.now();
        const inWin = eta >= 0 && eta <= flMs * 1.1;
        const icon  = inWin ? '✈️' : '🔮';
        const hint  = inWin ? ' **← leave now**' : '';
        return `**${i+1}.** ${icon} ${CC_FLAGS[item.country]||'🌍'} **${item.name}** · restock ${fmtEta(item.restockEtaMs)}${hint}\n` +
               `　+${fmt(item.margin)}/unit · **${fmt(item.profitPerHr)}/hr** · ${item.confidence.label}`;
      }).join('\n')
    : '_No predicted restocks matching current flight windows_';

  const age    = updatedAt ? Math.round((Date.now() - updatedAt) / 60000) : null;
  const ageStr = age == null ? '—' : age < 2 ? 'Fresh 🟢' : age < 10 ? `${age}m 🟡` : `${age}m 🔴`;

  return {
    color: 0x5865F2, title: '✈️ Nuttzar Flight Intel',
    description:
      '> ⚠️ *Predictions are estimates — always verify before travelling.*\n\n' +
      'Profit/hr shown at **Standard** class · Use `/flightsetup` to configure',
    fields: [
      { name: '📦 Top 5 In Stock',          value: stockLines, inline: false },
      { name: '🔮 Top 5 Predicted Restocks', value: predLines,  inline: false },
    ],
    footer: { text: `Data age: ${ageStr} · Weav3r lowest listing · Refreshes every 5 mins` },
    timestamp: new Date().toISOString(),
  };
}

// ── Alert selection embed ─────────────────────────────────────────────────────
function buildAlertSelectionEmbed(inStock, predicted, subscribedIds = []) {
  const subSet = new Set(subscribedIds.map(String));
  const fmtList = items => items.map((item, i) =>
    `${subSet.has(String(item.id)) ? '🔔' : '🔕'} **${i+1}.** ${CC_FLAGS[item.country]||'🌍'} ${item.name} (${item.country.toUpperCase()})`
  ).join('\n') || '_None_';

  return {
    color: 0x57F287, title: '🔔 Flight Alert Subscriptions',
    description:
      'Toggle alerts below. You\'ll be pinged when a restock ETA matches your flight time.\n\n' +
      '> ⚠️ *Predictions may be wrong — always verify before flying.*\n\n' +
      '🔔 = subscribed · 🔕 = not subscribed',
    fields: [
      { name: '📦 In Stock',          value: fmtList(inStock),   inline: true },
      { name: '🔮 Predicted Restock', value: fmtList(predicted), inline: true },
    ],
    footer: { text: 'Run /flightsetup to set travel class & capacity' },
  };
}

// ── Alert ping embed ──────────────────────────────────────────────────────────
function buildAlertEmbed(item, flightMins, travelClass, capacity) {
  const cap     = Math.min(capacity || 10, 35);
  const qty     = Math.min(item.projected || item.restockQty || 500, cap);
  const total   = Math.round(qty * item.margin);
  const perHr   = Math.round(total / ((flightMins * 2) / 60));
  const clsLbl  = { std:'Standard', airstrip:'Airstrip', wlt:'WLT', business:'Business' }[travelClass] || 'Standard';

  return {
    color: 0xFEE75C,
    title: `✈️ Leave Now! ${CC_FLAGS[item.country]||'🌍'} ${CC_NAMES[item.country]||item.country}`,
    description:
      `**${item.name}** restock window matches your flight time.\n\n` +
      `> ${item.confidence.label} · ${item.restockSamples} restock samples`,
    fields: [
      { name: '⏱️ Flight',      value: `${flightMins}m (${clsLbl})`, inline: true },
      { name: '💰 Margin/unit', value: fmt(item.margin),             inline: true },
      { name: '📦 Est. qty',    value: `~${qty} (cap ${cap})`,       inline: true },
      { name: '💵 Est. total',  value: fmt(total),                   inline: true },
      { name: '📈 Est. $/hr',   value: fmt(perHr),                   inline: true },
      { name: '🕐 Restock ETA', value: item.restockEtaMs
          ? `<t:${Math.floor(item.restockEtaMs / 1000)}:R>` : '~now', inline: true },
    ],
    footer: { text: 'Nuttzar Flight Alerts · Predictions may be inaccurate' },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  fetchScoredItems, buildStockEmbed, buildAlertSelectionEmbed, buildAlertEmbed,
  restockConfidence, FLIGHT_MINS, CC_FLAGS, CC_NAMES,
};
