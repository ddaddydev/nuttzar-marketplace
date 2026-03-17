// bot/flightAlerts.js — v3
// Uses Nuttzar Stock Worker v3 API:
//   /api/stocks  — full item list with pre-computed windows + opportunity scores
//   /api/best    — best items for a specific flight window (/bestarrival command)
// Prices come from the worker's built-in pricer (marketPrice field) — no Weav3r dependency.

const axios = require('axios');

const WORKER_BASE = 'https://nuttzar-stock-worker.notsilentclips.workers.dev';
const STOCK_URL   = `${WORKER_BASE}/api/stocks`;
const BEST_URL    = `${WORKER_BASE}/api/best`;

// ── Flight times by country + class (minutes) ──────────────────────────────
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

// Available window keys from the backend
const WINDOWS = [15, 30, 45, 60, 90];

// ── Display helpers ───────────────────────────────────────────────────────────

// Backend returns snake_case marketState — map to clean label + icon
const STATE_DISPLAY = {
  stable:            { label: 'Stable',            icon: '➡️'  },
  draining_slowly:   { label: 'Falling',           icon: '📉'  },
  draining_fast:     { label: 'Draining Fast',     icon: '🚨'  },
  near_sellout:      { label: 'Near Sellout',      icon: '⚠️'  },
  dead:              { label: 'Dead',              icon: '💀'  },
  refill_likely:     { label: 'Refill Likely',     icon: '🔄'  },
  recently_refilled: { label: 'Recently Refilled', icon: '✅'  },
  volatile:          { label: 'Volatile',          icon: '〽️' },
  stale_data:        { label: 'Stale Data',        icon: '⏸️'  },
};

function stateStr(marketState) {
  const s = STATE_DISPLAY[marketState];
  return s ? `${s.icon} ${s.label}` : '➡️ Stable';
}

function confLabel(pct) {
  if (pct == null) return '❓ Unknown';
  if (pct >= 70)   return `🟢 High (${pct}%)`;
  if (pct >= 40)   return `🟡 Medium (${pct}%)`;
  return               `🔴 Low (${pct}%)`;
}

function confShort(pct) {
  if (pct == null) return '❓';
  if (pct >= 70)   return `🟢${pct}%`;
  if (pct >= 40)   return `🟡${pct}%`;
  return               `🔴${pct}%`;
}

const STARS = ['⬛', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
const starStr = stars => STARS[Math.max(0, Math.min(5, stars ?? 0))];

const fmt    = n  => `$${Number(n).toLocaleString()}`;
const fmtQty = n  => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

// Find the closest available window key to a real flight time
function closestWindow(flightMins) {
  return WINDOWS.reduce((best, w) =>
    Math.abs(w - flightMins) < Math.abs(best - flightMins) ? w : best, 30);
}

// ── Core data fetcher ─────────────────────────────────────────────────────────

/**
 * Fetches the full item list from the v3 worker.
 * Returns scored/split inStock and predicted arrays, plus raw data for alerts.
 * Prices are embedded in marketPrice — no secondary fetch needed.
 */
async function fetchScoredItems() {
  const res       = await axios.get(STOCK_URL, { timeout: 15000 });
  const raw       = res.data?.items    || [];
  const updatedAt = res.data?.updatedAt || null;

  const inStock   = [];
  const predicted = [];

  for (const item of raw) {
    const {
      id, name, country, qty, cost,
      marketPrice = 0, marketState, windows,
      opportunity, confidence, sourceAgeMins,
    } = item;

    if (!FLIGHT_MINS[country]) continue;
    if (!windows)              continue;

    const w30 = windows[30];
    if (!w30)  continue;

    const base = {
      id, name, country, qty, cost, marketPrice,
      marketState:   marketState || 'stable',
      windows,
      opportunity:   opportunity || { score: 0, label: 'skip', stars: null },
      confidence:    confidence  || 'low',
      sourceAgeMins: sourceAgeMins || 0,
      margin:        marketPrice > cost ? marketPrice - cost : 0,
      lastEmptyAt:   item.lastEmptyAt   ?? null,
      avgRestockMins: item.avgRestockMins ?? null,
    };

    if (qty > 0 && (w30.stars ?? 0) >= 3) {
      inStock.push({ ...base, inStock: true });
    } else if (qty === 0 && w30.refillChance >= 20) {
      predicted.push({ ...base, inStock: false });
    }
  }

  inStock.sort(  (a, b) => (b.opportunity.score ?? 0) - (a.opportunity.score ?? 0));
  predicted.sort((a, b) => (b.windows[30]?.refillChance ?? 0) - (a.windows[30]?.refillChance ?? 0));

  return {
    inStock:   inStock.slice(0, 5),
    predicted: predicted.slice(0, 5),
    allRaw:    raw,
    updatedAt,
  };
}

/**
 * Fetch best items for a specific flight window — used by /bestarrival command.
 */
async function fetchBestForWindow(flightMins, limit = 10) {
  const valid = WINDOWS.includes(flightMins) ? flightMins : closestWindow(flightMins);
  const res   = await axios.get(`${BEST_URL}?flight=${valid}&limit=${limit}`, { timeout: 10000 });
  return {
    flightMins: res.data?.flightMins ?? valid,
    updatedAt:  res.data?.updatedAt  ?? null,
    items:      res.data?.items      ?? [],
  };
}

// ── Main channel embed ────────────────────────────────────────────────────────

function buildStockEmbed(inStock, predicted, updatedAt) {
  const age    = updatedAt ? Math.round((Date.now() - updatedAt) / 60000) : null;
  const ageStr = age == null ? '—' : age < 2 ? 'Fresh 🟢' : age < 20 ? `${age}m 🟡` : `${age}m 🔴`;

  // In-stock: show 30/60/90m windows + state + conf
  const stockLines = inStock.length
    ? inStock.map((item, i) => {
        const flag  = CC_FLAGS[item.country] || '🌍';
        const w30   = item.windows[30];
        const w60   = item.windows[60];
        const w90   = item.windows[90];
        const conf  = confShort(w30?.confidencePct);
        const score = item.opportunity.label ? ` · *${item.opportunity.label}*` : '';

        const arrival = [
          w30 ? `30m: ${starStr(w30.stars)} ~${fmtQty(w30.expectedStock)}` : null,
          w60 ? `60m: ${starStr(w60.stars)} ~${fmtQty(w60.expectedStock)}` : null,
          w90 ? `90m: ${starStr(w90.stars)} ~${fmtQty(w90.expectedStock)}` : null,
        ].filter(Boolean).join(' · ');

        return (
          `**${i+1}.** ${flag} **${CC_NAMES[item.country]||item.country} — ${item.name}**\n` +
          `　${fmtQty(item.qty)} now · ${stateStr(item.marketState)}${score}\n` +
          `　${arrival}\n` +
          `　Conf: ${conf}` +
          (item.margin > 0 ? ` · ${fmt(item.margin)}/unit` : '')
        );
      }).join('\n\n')
    : '_No quality in-stock opportunities right now_';

  // Predicted: compact per-item block — TCT restock time + per-class stock outlook
  const predLines = predicted.length
    ? predicted.map((item, i) => {
        const flag      = CC_FLAGS[item.country] || '🌍';
        const flightTbl = FLIGHT_MINS[item.country] || {};
        const now       = Date.now();

        // Restock ETA in TCT
        let restockStr = '*unknown*';
        if (item.lastEmptyAt && item.avgRestockMins) {
          const etaMs    = item.lastEmptyAt + item.avgRestockMins * 60000;
          const minsAway = Math.round((etaMs - now) / 60000);
          const tct      = new Date(etaMs).toUTCString().match(/(\d{2}:\d{2})/)?.[1] || '?';
          restockStr = minsAway <= 0
            ? `overdue (~${tct} TCT)`
            : `~${tct} TCT (in ${minsAway}m)`;
        }

        // Per-class: land time vs restock, one line each
        const clsLabels = { std:'Std', airstrip:'Air', wlt:'WLT', business:'Biz' };
        const clsLines  = Object.entries(flightTbl).map(([cls, mins]) => {
          const wKey = closestWindow(mins);
          const w    = item.windows?.[wKey];
          if (!w) return null;
          const landTct = new Date(now + mins * 60000).toUTCString().match(/(\d{2}:\d{2})/)?.[1] || '?';
          const lbl     = clsLabels[cls] || cls;
          const est     = w.expectedStock > 0 ? `~${fmtQty(w.expectedStock)}` : 'empty';
          return `${lbl}(${mins}m→${landTct}): **${est}**`;
        }).filter(Boolean).join(' · ');

        const stdW = item.windows?.[closestWindow(flightTbl.std || 120)];
        const conf = confShort(stdW?.confidencePct);

        return (
          `**${i+1}.** ${flag} **${CC_NAMES[item.country]||item.country} — ${item.name}**\n` +
          `　${stateStr(item.marketState)} · Conf: ${conf}\n` +
          `　⏰ Restock: ${restockStr}\n` +
          `　${clsLines || 'No data'}`
        );
      }).join('\n\n')
    : '_No predicted restocks matching current windows_';

  return {
    color: 0x5865F2,
    title: '✈️ Nuttzar Flight Intel',
    description:
      '> ⚠️ *Predictions are estimates — always verify before travelling.*\n' +
      '> Windows at **Standard** class · `/flightsetup` to personalise alerts',
    fields: [
      { name: '📦 Top In-Stock Opportunities',        value: stockLines, inline: false },
      { name: '🔮 Top Predicted Restocks (empty now)', value: predLines,  inline: false },
    ],
    footer: { text: `Data age: ${ageStr} · v3 prediction engine · Refreshes every 15 mins` },
    timestamp: new Date().toISOString(),
  };
}

// ── Best-for-arrival embed ─────────────────────────────────────────────────────

function buildBestArrivalEmbed(flightMins, items, updatedAt) {
  const age    = updatedAt ? Math.round((Date.now() - updatedAt) / 60000) : null;
  const ageStr = age == null ? '—' : age < 2 ? 'Fresh 🟢' : age < 20 ? `${age}m 🟡` : `${age}m 🔴`;

  const lines = items.length
    ? items.slice(0, 10).map((item, i) => {
        const flag   = CC_FLAGS[item.country] || '🌍';
        const w      = item.window;
        const margin = item.marketPrice > item.cost ? item.marketPrice - item.cost : 0;
        return (
          `**${i+1}.** ${flag} **${CC_NAMES[item.country]||item.country} — ${item.name}**\n` +
          `　${w ? `${starStr(w.stars)} ~${fmtQty(w.expectedStock)} on landing` : '_no data_'}` +
          (w?.refillChance > 0 && w?.depletes ? ` · ${w.refillChance}% refill chance` : '') + `\n` +
          `　${stateStr(item.marketState)}` +
          (margin > 0 ? ` · ${fmt(margin)}/unit` : '') +
          ` · Conf: ${confShort(w?.confidencePct)}`
        );
      }).join('\n\n')
    : '_No results for this window_';

  return {
    color: 0x57F287,
    title: `✈️ Best Targets for ${flightMins}m Arrival`,
    description: '> Ranked by expected stock on landing at this flight time',
    fields: [{ name: `🏆 Top Options — ${flightMins}min Flight`, value: lines, inline: false }],
    footer: { text: `Data age: ${ageStr}` },
    timestamp: new Date().toISOString(),
  };
}

// ── Alert subscription selection embed ────────────────────────────────────────

function buildAlertSelectionEmbed(inStock, predicted, subscribedIds = []) {
  const subSet  = new Set(subscribedIds.map(String));
  const fmtList = items => items.map((item, i) => {
    const subbed = subSet.has(String(item.id));
    const w30    = item.windows?.[30];
    return (
      `${subbed ? '🔔' : '🔕'} **${i+1}.** ${CC_FLAGS[item.country]||'🌍'} ${item.name} *(${item.country.toUpperCase()})*\n` +
      `　${stateStr(item.marketState)}` +
      (w30 ? ` · 30m: ${starStr(w30.stars)} ${confShort(w30.confidencePct)}` : '')
    );
  }).join('\n') || '_None_';

  return {
    color: 0x57F287,
    title: '🔔 Flight Alert Subscriptions',
    description:
      'Toggle alerts below. You\'ll be pinged when a window opens matching your flight time.\n\n' +
      '> ⚠️ *Predictions may be wrong — always verify before flying.*\n\n' +
      '🔔 = subscribed · 🔕 = not subscribed',
    fields: [
      { name: '📦 In Stock',          value: fmtList(inStock),   inline: true },
      { name: '🔮 Predicted Restock', value: fmtList(predicted), inline: true },
    ],
    footer: { text: '/flightsetup to set travel class & carry capacity' },
  };
}

// ── Alert DM / channel ping embed ─────────────────────────────────────────────

function buildAlertEmbed(item, flightMins, travelClass, capacity) {
  const cap    = Math.min(capacity || 10, 35);
  const clsLbl = { std:'Standard', airstrip:'Airstrip', wlt:'WLT', business:'Business' }[travelClass] || 'Standard';
  const flag   = CC_FLAGS[item.country] || '🌍';
  const wKey   = closestWindow(flightMins);
  const w      = item.windows?.[wKey];
  const margin = item.marketPrice > item.cost ? item.marketPrice - item.cost : 0;
  const estQty   = Math.min(w?.expectedStock ?? 0, cap);
  const estTotal = margin > 0 ? Math.round(estQty * margin) : null;

  const isUrgent = item.qty > 0 && w?.depletes;

  const fields = [
    { name: '📍 Destination',  value: `${flag} ${CC_NAMES[item.country]||item.country}`, inline: true },
    { name: '⏱️ Your Flight',  value: `~${flightMins}m (${clsLbl})`,                     inline: true },
    { name: '📦 Stock Now',    value: item.qty > 0 ? fmtQty(item.qty) : 'Empty',         inline: true },
    { name: '📈 Trend',        value: stateStr(item.marketState),                        inline: true },
    { name: '🛬 On Landing',   value: w ? `${starStr(w.stars)} ~${fmtQty(w.expectedStock)}` : 'Unknown', inline: true },
    { name: '🎯 Confidence',   value: confLabel(w?.confidencePct),                       inline: true },
  ];

  if (item.qty === 0 && (w?.refillChance ?? 0) > 0) {
    fields.push({ name: '🔄 Refill Chance', value: `${w.refillChance}% by ${wKey}m`, inline: true });
  }
  if (margin > 0) {
    fields.push({ name: '💰 Margin/unit',    value: fmt(margin),    inline: true });
  }
  if (estTotal && estTotal > 0) {
    fields.push({ name: '💵 Est. trip value', value: fmt(estTotal), inline: true });
  }

  return {
    color: isUrgent ? 0xE74C3C : 0xFEE75C,
    title: isUrgent
      ? `⚠️ Leave Now — ${item.name} is depleting!`
      : `✈️ Flight Window Open — ${item.name}`,
    description: `${flag} **${CC_NAMES[item.country]||item.country}**\n`,
    fields,
    footer: { text: 'Nuttzar Flight Alerts · Always verify before flying' },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  fetchScoredItems,
  fetchBestForWindow,
  buildStockEmbed,
  buildBestArrivalEmbed,
  buildAlertSelectionEmbed,
  buildAlertEmbed,
  FLIGHT_MINS,
  CC_FLAGS,
  CC_NAMES,
  closestWindow,
};
