// bot/flightAlerts.js — v3
// Stock data: Nuttzar Stock Worker v3 (/api/stocks, /api/best)
// Prices:     Weav3r /marketplace — lowest_price as sell price (1 call per 15min refresh)
// Margin:     Weav3r lowest_price - foreign store cost
// Profit/hr:  (margin × 29 items) / (airstrip round trip hours)

const axios = require('axios');

const WORKER_BASE       = 'https://nuttzar-stock-worker.notsilentclips.workers.dev';
const STOCK_URL         = `${WORKER_BASE}/api/stocks`;
const BEST_URL          = `${WORKER_BASE}/api/best`;
const WEAV3R_MARKET_URL = 'https://weav3r.dev/api/marketplace';

// ── Flight times by country + class (minutes) ─────────────────────────────────
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

const WINDOWS = [15, 30, 45, 60, 90];

// ── Display helpers ───────────────────────────────────────────────────────────

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

function stateStr(s) {
  const d = STATE_DISPLAY[s];
  return d ? `${d.icon} ${d.label}` : '➡️ Stable';
}

function confLabel(pct) {
  if (pct == null) return '❓ Unknown';
  if (pct >= 70)   return `🟢 High (${pct}%)`;
  if (pct >= 40)   return `🟡 Medium (${pct}%)`;
  return                  `🔴 Low (${pct}%)`;
}

function confShort(pct) {
  if (pct == null) return '❓';
  if (pct >= 70)   return `🟢${pct}%`;
  if (pct >= 40)   return `🟡${pct}%`;
  return                  `🔴${pct}%`;
}

const STARS  = ['⬛','⭐','⭐⭐','⭐⭐⭐','⭐⭐⭐⭐','⭐⭐⭐⭐⭐'];
const starStr = s => STARS[Math.max(0, Math.min(5, s ?? 0))];

const fmt    = n => `$${Number(n).toLocaleString()}`;
const fmtQty = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

function closestWindow(mins) {
  return WINDOWS.reduce((best, w) =>
    Math.abs(w - mins) < Math.abs(best - mins) ? w : best, 30);
}

// profit/hr = (margin × 29) / round-trip hours
// round trip = airstrip flight × 2 (there and back)
function profitPerHour(margin, airstripMins) {
  if (!margin || margin <= 0 || !airstripMins) return null;
  const roundTripHours = (airstripMins * 2) / 60;
  return Math.round((margin * 29) / roundTripHours);
}

function tripLines(item) {
  const pilot = FLIGHT_MINS[item.country]?.airstrip ?? null;
  if (!item.margin || item.margin <= 0) return null;
  const costPer  = item.cost        > 0 ? fmt(item.cost)           : '?';
  const sellPer  = item.marketPrice > 0 ? fmt(item.marketPrice)    : '?';
  const cost29   = item.cost        > 0 ? fmt(item.cost * 29)      : '?';
  const tripProfit = item.margin * 29;
  const phr      = profitPerHour(item.margin, pilot);
  return (
    `　💰 Buy ${costPer} → Sell ${sellPer} · **${fmt(item.margin)}/unit**\n` +
    `　🧳 29× costs **${cost29}** · Trip profit: **${fmt(tripProfit)}**` +
    (phr ? ` · **${fmt(phr)}/hr**` : '')
  );
}

// ── Core data fetcher ─────────────────────────────────────────────────────────

async function fetchScoredItems() {
  const [workerRes, weav3rRes] = await Promise.all([
    axios.get(STOCK_URL, { timeout: 15000 }),
    axios.get(WEAV3R_MARKET_URL, { timeout: 15000 }).catch(() => null),
  ]);

  const raw       = workerRes.data?.items    || [];
  const updatedAt = workerRes.data?.updatedAt || null;

  // item_id → lowest_price ?? market_price
  const priceMap = {};
  if (weav3rRes?.data?.items) {
    for (const w of weav3rRes.data.items) {
      priceMap[String(w.item_id)] = w.lowest_price || w.market_price || 0;
    }
  }

  const inStock   = [];
  const predicted = [];

  for (const item of raw) {
    const { id, name, country, qty, cost, marketState, windows, opportunity, confidence, sourceAgeMins } = item;

    if (!FLIGHT_MINS[country]) continue;
    if (!windows)              continue;

    const w30 = windows[30];
    if (!w30)  continue;

    const opp       = opportunity || { score: 0, label: '', stars: 0 };
    const sellPrice = priceMap[String(id)] || 0;
    const margin    = sellPrice > cost ? sellPrice - cost : 0;

    const base = {
      id, name, country, qty, cost,
      marketPrice:    sellPrice,
      marketState:    marketState || 'stable',
      windows,
      opportunity:    opp,
      confidence:     confidence    || 'low',
      sourceAgeMins:  sourceAgeMins || 0,
      margin,
      lastEmptyAt:    item.lastEmptyAt    ?? null,
      avgRestockMins: item.avgRestockMins ?? null,
      burnRate:       item.burnRate       ?? null,
    };

    if (qty > 0 && margin > 0) {
      inStock.push({ ...base, inStock: true });
    } else if (qty === 0 && (w30.refillChance ?? 0) >= 20) {
      predicted.push({ ...base, inStock: false });
    }
  }

  // Sort by margin descending
  inStock.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));

  // Sort predicted: expected stock on landing at airstrip window, then margin
  predicted.sort((a, b) => {
    const aW = a.windows[closestWindow(FLIGHT_MINS[a.country]?.airstrip ?? 30)]?.expectedStock ?? 0;
    const bW = b.windows[closestWindow(FLIGHT_MINS[b.country]?.airstrip ?? 30)]?.expectedStock ?? 0;
    if (bW !== aW) return bW - aW;
    return (b.margin ?? 0) - (a.margin ?? 0);
  });

  return {
    inStock:   inStock.slice(0, 5),
    predicted: predicted.slice(0, 5),
    allRaw:    raw,
    updatedAt,
  };
}

async function fetchBestForWindow(flightMins, limit = 10) {
  const valid = WINDOWS.includes(flightMins) ? flightMins : closestWindow(flightMins);
  const res   = await axios.get(`${BEST_URL}?flight=${valid}&limit=${limit}`, { timeout: 10000 });
  return {
    flightMins: res.data?.flightMins ?? valid,
    updatedAt:  res.data?.updatedAt  ?? null,
    items:      res.data?.items      ?? [],
  };
}

// ── Country summary embed (message 1) ────────────────────────────────────────

function buildCountrySummaryEmbed(allRaw, updatedAt) {
  const age    = updatedAt ? Math.round((Date.now() - updatedAt) / 60000) : null;
  const ageStr = age == null ? '—' : age < 2 ? 'Fresh 🟢' : age < 20 ? `${age}m 🟡` : `${age}m 🔴`;

  const byCountry = {};
  for (const item of allRaw) {
    if (!FLIGHT_MINS[item.country]) continue;
    if (!byCountry[item.country]) byCountry[item.country] = { scores: [], goodCount: 0 };
    const score = item.opportunity?.score ?? 0;
    byCountry[item.country].scores.push(score);
    if (score >= 60) byCountry[item.country].goodCount++;
  }

  const ranked = Object.entries(byCountry)
    .map(([cc, d]) => ({
      cc,
      avg:       Math.round(d.scores.reduce((s, v) => s + v, 0) / d.scores.length),
      goodCount: d.goodCount,
      total:     d.scores.length,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);

  const medals = ['🥇', '🥈', '🥉'];
  const lines = ranked.map((c, i) =>
    `${medals[i]} **${CC_FLAGS[c.cc]||'🌍'} ${CC_NAMES[c.cc]||c.cc}**\n` +
    `　Avg score: **${c.avg}/100** · ${c.goodCount} good opportunities (of ${c.total} items)\n` +
    `　✈️ Private pilot: **${FLIGHT_MINS[c.cc]?.airstrip ?? '?'}m** · Round trip: **${(FLIGHT_MINS[c.cc]?.airstrip ?? 0) * 2}m**`
  ).join('\n\n');

  return {
    color: 0xF1C40F,
    title: '🏆 Top 3 Countries — Best Average Profit Right Now',
    description: '> Ranked by average opportunity score across all tracked items',
    fields: [{ name: '📊 Country Rankings', value: lines || '_No data_', inline: false }],
    footer: { text: `Data age: ${ageStr} · Refreshes every 15 mins` },
    timestamp: new Date().toISOString(),
  };
}

// ── In-stock embed (message 2) ────────────────────────────────────────────────

function buildInStockEmbed(inStock, updatedAt) {
  const age    = updatedAt ? Math.round((Date.now() - updatedAt) / 60000) : null;
  const ageStr = age == null ? '—' : age < 2 ? 'Fresh 🟢' : age < 20 ? `${age}m 🟡` : `${age}m 🔴`;

  const stockLines = inStock.length
    ? inStock.map((item, i) => {
        const flag      = CC_FLAGS[item.country] || '🌍';
        const conf      = confShort(item.windows[30]?.confidencePct);
        const score     = item.opportunity.label ? ` · *${item.opportunity.label}*` : '';
        const pilot     = FLIGHT_MINS[item.country]?.airstrip ?? '?';

        // Depletion time
        let depletionStr = 'Rate unknown';
        if (item.burnRate && item.burnRate > 0) {
          const minsLeft   = Math.round(item.qty / item.burnRate);
          const h = Math.floor(minsLeft / 60), m = minsLeft % 60;
          const timeStr    = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
          const depleteTct = new Date(Date.now() + minsLeft * 60000).toUTCString().match(/(\d{2}:\d{2})/)?.[1] || '?';
          depletionStr = `~${timeStr} left · empty ~${depleteTct} TCT`;
        }

        const profit = tripLines(item);

        return (
          `**${i+1}.** ${flag} **${CC_NAMES[item.country]||item.country} — ${item.name}**\n` +
          `　${fmtQty(item.qty)} in stock · ${stateStr(item.marketState)}${score}\n` +
          `　📉 Depletes: ${depletionStr}\n` +
          (profit ? `${profit}\n` : '') +
          `　✈️ ${pilot}m private pilot · Round trip: ${typeof pilot === 'number' ? pilot * 2 : '?'}m · Conf: ${conf}`
        );
      }).join('\n\n')
    : '_No quality in-stock opportunities right now_';

  return {
    color: 0x5865F2,
    title: '📦 Top In-Stock Opportunities',
    description: '> Ranked by profit per unit · Use `/xanax` for Xanax-only DM',
    fields: [{ name: '📦 In Stock Now', value: stockLines, inline: false }],
    footer: { text: `Data age: ${ageStr} · Refreshes every 15 mins` },
    timestamp: new Date().toISOString(),
  };
}

// ── Predicted restocks embed (message 3) ─────────────────────────────────────

function buildPredictedEmbed(predicted, updatedAt) {
  const age    = updatedAt ? Math.round((Date.now() - updatedAt) / 60000) : null;
  const ageStr = age == null ? '—' : age < 2 ? 'Fresh 🟢' : age < 20 ? `${age}m 🟡` : `${age}m 🔴`;

  const predLines = predicted.length
    ? predicted.map((item, i) => {
        const flag      = CC_FLAGS[item.country] || '🌍';
        const now       = Date.now();
        const pilotMins = FLIGHT_MINS[item.country]?.airstrip ?? 30;
        const landEtaMs = now + pilotMins * 60000;
        const landTct   = new Date(landEtaMs).toUTCString().match(/(\d{2}:\d{2})/)?.[1] || '?';
        const stdW      = item.windows?.[closestWindow(pilotMins)];
        const conf      = confShort(stdW?.confidencePct);

        let restockStr;
        if (item.lastEmptyAt && item.avgRestockMins) {
          const restockEtaMs     = item.lastEmptyAt + item.avgRestockMins * 60000;
          const restockTct       = new Date(restockEtaMs).toUTCString().match(/(\d{2}:\d{2})/)?.[1] || '?';
          const minsUntilRestock = Math.round((restockEtaMs - now) / 60000);
          if (minsUntilRestock <= 0) {
            restockStr = `⚡ Overdue — restock expected any time (~${restockTct} TCT predicted)`;
          } else if (restockEtaMs <= landEtaMs) {
            const minsEarly = Math.round((landEtaMs - restockEtaMs) / 60000);
            restockStr = `✅ Restocks ~${restockTct} TCT — ${minsEarly}m before you land (~${landTct} TCT)`;
          } else {
            const minsLate = Math.round((restockEtaMs - landEtaMs) / 60000);
            restockStr = `❌ Restocks ~${restockTct} TCT — ${minsLate}m after landing (~${landTct} TCT)`;
          }
        } else {
          restockStr = `*No restock history · lands ~${landTct} TCT*`;
        }

        const profit = tripLines(item);

        return (
          `**${i+1}.** ${flag} **${CC_NAMES[item.country]||item.country} — ${item.name}**\n` +
          `　${stateStr(item.marketState)} · Conf: ${conf} · ✈️ ${pilotMins}m private pilot\n` +
          `　${restockStr}\n` +
          (profit ? `${profit}` : `　💰 No price data`)
        );
      }).join('\n\n')
    : '_No predicted restocks right now_';

  return {
    color: 0x9B59B6,
    title: '🔮 Predicted Restocks',
    description: '> ⚠️ *Based on historical patterns — always verify before flying*\n> ✅ = restocks before landing · ❌ = restocks after landing',
    fields: [{ name: '🔮 Empty Now — Private Pilot Times', value: predLines, inline: false }],
    footer: { text: `Data age: ${ageStr} · v3 prediction engine · Refreshes every 15 mins` },
    timestamp: new Date().toISOString(),
  };
}

// ── Legacy stub (kept for alert system compatibility) ─────────────────────────

function buildStockEmbed(inStock, predicted, updatedAt) {
  return buildInStockEmbed(inStock, updatedAt);
}

// ── Best-for-arrival embed ────────────────────────────────────────────────────

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

// ── Alert subscription selection embed ───────────────────────────────────────

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

// ── Alert DM / channel ping embed ────────────────────────────────────────────

function buildAlertEmbed(item, flightMins, travelClass, capacity) {
  const cap      = Math.min(capacity || 10, 35);
  const clsLbl   = { std:'Standard', airstrip:'Airstrip', wlt:'WLT', business:'Business' }[travelClass] || 'Standard';
  const flag     = CC_FLAGS[item.country] || '🌍';
  const wKey     = closestWindow(flightMins);
  const w        = item.windows?.[wKey];
  const margin   = item.marketPrice > item.cost ? item.marketPrice - item.cost : 0;
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
    fields.push({ name: '💰 Margin/unit',     value: fmt(margin),    inline: true });
  }
  if (estTotal && estTotal > 0) {
    fields.push({ name: '💵 Est. trip value', value: fmt(estTotal),  inline: true });
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
  buildCountrySummaryEmbed,
  buildInStockEmbed,
  buildPredictedEmbed,
  buildBestArrivalEmbed,
  buildAlertSelectionEmbed,
  buildAlertEmbed,
  FLIGHT_MINS,
  CC_FLAGS,
  CC_NAMES,
  closestWindow,
};
