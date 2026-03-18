// bot/tornChannels.js
// Loot Timer (YATA API), Crimes Intel, Calendar + TCT Clock

const axios = require('axios');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

const LOOT_CHANNEL_ID     = '1482357106802692126';
const CRIMES_CHANNEL_ID   = '1482356802682224792';
const CALENDAR_CHANNEL_ID = '1482356667059536024';
const LOOT_FIGHTER_ROLE   = '1482357456591130694';
const CRIME_ROLE          = '1482357406313873498';
const CASH_THRESHOLD      = 80;  // default threshold — adjust 70-90 to taste
const BEACH_THRESHOLD     = 70;  // search_the_beach specifically (Shore Thing merit)

// ── NPC definitions ───────────────────────────────────────────────────────────
// hosp_out timestamp + offset (seconds) = loot level time
const LOOT_OFFSETS  = [0, 1800, 5400, 12600, 27000]; // L1–L5
const LEVEL_ICONS   = ['⬜','🟩','🟨','🟧','🟥'];

const NPCS = [
  { id:4,  name:'Duke',     emoji:'🎩' },
  { id:15, name:'Leslie',   emoji:'💄' },
  { id:19, name:'Jimmy',    emoji:'🔫' },
  { id:20, name:'Fernando', emoji:'🪖' },
  { id:21, name:'Tiny',     emoji:'💪' },
];

// ── YATA loot cache ───────────────────────────────────────────────────────────
let _lootCache = null, _lootCacheTs = 0;

async function fetchLootData() {
  const now = Date.now();
  // Respect YATA's next_update suggestion + 5 min floor to avoid burning 10 calls/hr limit
  const nextUpdate = _lootCache?.next_update ? _lootCache.next_update * 1000 : 0;
  if (_lootCache && now < Math.max(nextUpdate, _lootCacheTs + 5 * 60000)) return _lootCache;
  try {
    const res = await axios.get('https://yata.yt/api/v1/loot/', { timeout: 8000 });
    _lootCache   = res.data;
    _lootCacheTs = now;
  } catch (e) { console.warn('[LOOT] YATA fetch failed:', e.message); }
  return _lootCache;
}

// ── Loot helpers ──────────────────────────────────────────────────────────────
function fmtCountdown(ms) {
  const secs = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (!secs) return '**NOW**';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}

function fmtTCT(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} TCT`;
}

// ── Build loot embed ──────────────────────────────────────────────────────────
async function buildLootEmbed() {
  const data    = await fetchLootData();
  const hospOut = data?.hosp_out || {};
  const now     = Date.now();
  const fields  = [];
  let globalNext = null;

  for (const npc of NPCS) {
    const ts = hospOut[String(npc.id)];
    if (!ts) {
      fields.push({ name: `${npc.emoji} ${npc.name}`, value: '_No data_', inline: true });
      continue;
    }

    const levels  = LOOT_OFFSETS.map((off, i) => ({ level: i + 1, timeMs: (ts + off) * 1000 }));
    const future  = levels.filter(l => l.timeMs > now);
    const nextLvl = future[0] || null;
    const atkUrl  = `https://www.torn.com/loader.php?sid=attack&user2ID=${npc.id}`;

    if (nextLvl && (!globalNext || nextLvl.timeMs < globalNext.timeMs)) {
      globalNext = { npc, ...nextLvl };
    }

    const lines = levels.map(l => {
      const icon   = LEVEL_ICONS[l.level - 1];
      const past   = l.timeMs <= now;
      const isNext = nextLvl && l.level === nextLvl.level;
      const marker = isNext ? ' **◄ NEXT**' : '';
      const time   = past ? `~~${fmtTCT(l.timeMs)}~~ ✓` : `${fmtTCT(l.timeMs)} · ${fmtCountdown(l.timeMs)}`;
      return `${icon} **L${l.level}**${marker} — ${time}`;
    });

    fields.push({ name: `${npc.emoji} [${npc.name}](${atkUrl})`, value: lines.join('\n'), inline: true });
  }

  // Pad to multiple of 3 for Discord layout
  while (fields.length % 3 !== 0) fields.push({ name: '\u200b', value: '\u200b', inline: true });

  const nextSummary = globalNext
    ? `🎯 **Next:** ${globalNext.npc.emoji} ${globalNext.npc.name} L${globalNext.level} — ${fmtCountdown(globalNext.timeMs)}`
    : '🎯 All NPCs currently looted';

  const ageStr = _lootCacheTs ? `${Math.round((now - _lootCacheTs) / 60000)}m ago` : '—';

  return {
    color: 0xE67E22, title: '⚔️ NPC Loot Timers',
    description: `${nextSummary}\n\n⬜ L1 · 🟩 L2 · 🟨 L3 · 🟧 L4 · 🟥 L5\n*Strike = passed · Click name to attack*`,
    fields,
    footer: { text: `YATA data · Age: ${ageStr} · Updates every 60s` },
    timestamp: new Date().toISOString(),
  };
}

// ── Annual Torn events — fixed calendar dates, repeat yearly ─────────────────
// month is 0-indexed (0=Jan). endDay is inclusive.
const EVENTS = [
  { name: "St Patrick's Day",     emoji: '🍀', month: 2,  day: 17, desc: "Alcohol effects doubled & Green Stout spawns in the city." },
  { name: '420 Day',              emoji: '🌿', month: 3,  day: 20, desc: "Cannabis effects tripled." },
  { name: 'Museum Day',           emoji: '🏛️', month: 4,  day: 18, desc: "10% bonus to museum point rewards." },
  { name: 'World Blood Donor Day',emoji: '🩸', month: 5,  day: 14, desc: "Life and cooldown penalties for drawing blood are halved." },
  { name: 'World Population Day', emoji: '⚔️', month: 6,  day: 11, desc: "Level and weapon EXP gained while attacking is doubled." },
  { name: 'World Tiger Day',      emoji: '🐅', month: 6,  day: 29, desc: "Hunting experience increased by x5." },
  { name: 'International Beer Day',emoji: '🍺',month: 7,  day: 7,  desc: "Beer items are five times more effective." },
  { name: 'Elimination',          emoji: '💀', month: 8,  day: 5,  endDay: 18, desc: "Team competition — 12 teams enter, one survives. Daily fights until a winner is crowned." },
  { name: 'Tourism Day',          emoji: '✈️', month: 8,  day: 27, desc: "Travel capacity doubled for all flights during this event." },
  { name: 'CaffeineCon',          emoji: '⚡', month: 9,  day: 15, desc: "Energy drink effects are doubled." },
  { name: 'Trick or Treat',       emoji: '🎃', month: 9,  day: 25, endDay: 31, desc: "Dress up and attack others to fill your basket with treats." },
  { name: 'Slash Wednesday',      emoji: '🔪', month: 11, day: 9,  desc: "Hospital times reduced by 75%." },
  { name: 'Christmas Town',       emoji: '🎄', month: 11, day: 19, endDay: 31, desc: "Torn's festive theme park opens — search maps for treasure and avoid traps." },
];

// Returns the next occurrence of a fixed annual event (month/day, 0-indexed month)
function nextAnnualOccurrence({ month, day }) {
  const now  = new Date();
  const year = now.getUTCFullYear();
  // Try this year first
  let candidate = Date.UTC(year, month, day, 0, 0, 0);
  if (candidate <= Date.now()) {
    // Already passed this year — use next year
    candidate = Date.UTC(year + 1, month, day, 0, 0, 0);
  }
  return candidate;
}

// Is an event currently active (multi-day)?
function isActive({ month, day, endDay }) {
  if (!endDay) return false;
  const now   = new Date();
  const year  = now.getUTCFullYear();
  const start = Date.UTC(year, month, day);
  const end   = Date.UTC(year, month, endDay, 23, 59, 59);
  const nowMs = Date.now();
  return nowMs >= start && nowMs <= end;
}

// Returns "in Xd Yh" / "in Xh Ym" / "in Xm" / "🔴 ACTIVE"
function fmtTimeUntil(ms) {
  const secs = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (secs < 60)   return 'less than a minute';
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  const remH  = hours % 24;
  const remM  = mins % 60;
  if (days > 0)   return `in **${days}d ${remH}h**`;
  if (hours > 0)  return `in **${hours}h ${String(remM).padStart(2,'0')}m**`;
  return `in **${mins}m**`;
}

// ── Build calendar embed ──────────────────────────────────────────────────────
function buildCalendarEmbed() {
  const now     = new Date();
  const tct     = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')} TCT`;

  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const toReset  = Math.max(0, Math.round((midnight - Date.now()) / 1000));
  const rH = Math.floor(toReset / 3600), rM = Math.floor((toReset % 3600) / 60);
  const resetStr = `${rH}h ${String(rM).padStart(2,'0')}m`;

  // Enrich events with next occurrence and active status
  const enriched = EVENTS.map(e => ({
    ...e,
    active:  isActive(e),
    nextMs:  isActive(e) ? Date.now() : nextAnnualOccurrence(e),
  })).sort((a, b) => {
    // Active events first, then soonest next
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return a.nextMs - b.nextMs;
  });

  // Show next 6 upcoming (or active) events
  const shown = enriched.slice(0, 6);
  const next  = shown[0];

  const nextLabel = next.active
    ? `🔴 **${next.name}** is happening now!`
    : `📍 Next up: ${next.emoji} **${next.name}** — ${fmtTimeUntil(next.nextMs)}`;

  const eventLines = shown.map(e => {
    const timing = e.active ? '🔴 **Active now**' : fmtTimeUntil(e.nextMs);
    const dates  = e.endDay
      ? `${e.day}/${e.month + 1} – ${e.endDay}/${e.month + 1}`
      : `${e.day}/${e.month + 1}`;
    return `${e.emoji} **${e.name}** _(${dates})_ — ${timing}\n　*${e.desc}*`;
  }).join('\n\n');

  return {
    color: 0x3498DB,
    title: `🕐 ${tct}`,
    description:
      `🔄 Daily reset ${fmtTimeUntil(midnight)} · **${resetStr}** left\n` +
      nextLabel,
    fields: [{
      name: '📅 Upcoming Torn Events',
      value: eventLines || '_No upcoming events found_',
      inline: false,
    }],
    footer: { text: 'TCT = UTC · Annual Torn calendar events · Updates every 15 minutes' },
    timestamp: new Date().toISOString(),
  };
}

// ── Crimes fetch ──────────────────────────────────────────────────────────────
async function fetchCrimesData(apiKey) {
  try {
    // Confirmed working endpoints and field structure (tested March 2026)
    const [sfcRes, slRes] = await Promise.all([
      axios.get(`https://api.torn.com/torn/?selections=searchforcash&key=${apiKey}&comment=NuttzarBot`, { timeout: 10000 }),
      axios.get(`https://api.torn.com/torn/?selections=shoplifting&key=${apiKey}&comment=NuttzarBot`,   { timeout: 10000 }),
    ]);
    return {
      searchforcash: sfcRes.data?.searchforcash || {},
      shoplifting:   slRes.data?.shoplifting    || {},
    };
  } catch (e) {
    console.warn('[CRIMES] Fetch failed:', e.message);
    return null;
  }
}

// ── Build crimes embed ────────────────────────────────────────────────────────
// Confirmed field structure:
// searchforcash: { search_the_trash: { title: string, percentage: number }, ... }
// shoplifting:   { sallys_sweet_shop: [{ title: string, disabled: boolean }], ... }
// disabled: true = guard/camera is OFF (good for player)
function buildCrimesEmbed(crimesData) {
  if (!crimesData) {
    return {
      color: 0x95A5A6, title: '🔍 Crimes Intel',
      description: '_Could not fetch crimes data — retrying in 5 minutes_',
      footer: { text: 'Updates every 5 minutes' }, timestamp: new Date().toISOString(),
    };
  }

  // Search for cash — beach uses lower threshold for Shore Thing merit grind
  const hotSearch = Object.entries(crimesData.searchforcash || {})
    .filter(([key, d]) => {
      const threshold = key === 'search_the_beach' ? BEACH_THRESHOLD : CASH_THRESHOLD;
      return d?.percentage >= threshold;
    })
    .map(([key, d]) => ({ name: fmtKey(key), pct: d.percentage, title: d.title || '' }))
    .sort((a, b) => b.pct - a.pct);

  // Shoplifting — alert when ALL conditions in the location are disabled (off)
  // Shoplifting — show any location with at least one guard/camera off
  const hotShoplift = Object.entries(crimesData.shoplifting || {})
    .filter(([, items]) => Array.isArray(items) && items.length && items.some(i => i.disabled === true))
    .map(([key, items]) => {
      const off      = items.filter(i => i.disabled === true).map(i => i.title);
      const on       = items.filter(i => i.disabled === false).map(i => i.title);
      const allClear = on.length === 0;
      return { name: fmtKey(key), off, on, allClear };
    })
    .sort((a, b) => {
      if (a.allClear && !b.allClear) return -1;
      if (!a.allClear && b.allClear) return 1;
      return b.off.length - a.off.length;
    });

  const searchLines = hotSearch.length
    ? hotSearch.map(s => `🟢 **${s.name}** — **${s.pct}%** · _${s.title}_`).join('\n')
    : `_No subcategories above ${CASH_THRESHOLD}% right now_`;

  const shopliftLines = hotShoplift.length
    ? hotShoplift.map(s => {
        const icon   = s.allClear ? '🔓' : '🟡';
        const status = s.allClear
          ? `All clear _(${s.off.join(', ')})_`
          : `🔓 Off: **${s.off.join(', ')}** · 🔒 On: ${s.on.join(', ')}`;
        return `${icon} **${s.name}** — ${status}`;
      }).join('\n')
    : '_No shoplifting opportunities right now_';

  const hasAlert = hotSearch.length > 0 || hotShoplift.length > 0;

  return {
    color:       hasAlert ? 0x2ECC71 : 0x95A5A6,
    title:       hasAlert ? '🚨 Crimes Intel — Go Time!' : '🔍 Crimes Intel',
    description: hasAlert ? '**Crime opportunities detected!**' : '_Monitoring... nothing hot right now_',
    fields: [
      { name: `💰 Search for Cash (≥${CASH_THRESHOLD}%)`,      value: searchLines,   inline: false },
      { name: '🏪 Shoplifting (Any Guard/Camera Off)',           value: shopliftLines, inline: false },
    ],
    footer: { text: `Beach ≥${BEACH_THRESHOLD}% · Other search ≥${CASH_THRESHOLD}% · 🔓 = all clear · 🟡 = partial · Updates every 5m` },
    timestamp: new Date().toISOString(),
  };
}

function fmtKey(key) {
  return key.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Sign-up button rows ───────────────────────────────────────────────────────
function lootSignupRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('toggle_loot_fighter').setLabel('⚔️ Get Loot Alerts').setStyle(ButtonStyle.Primary)
  );
}

function crimeSignupRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('toggle_crime_role').setLabel('🔍 Get Crime Alerts').setStyle(ButtonStyle.Primary)
  );
}

module.exports = {
  LOOT_CHANNEL_ID, CRIMES_CHANNEL_ID, CALENDAR_CHANNEL_ID, LOOT_FIGHTER_ROLE, CRIME_ROLE,
  buildLootEmbed, buildCalendarEmbed, buildCrimesEmbed, fetchCrimesData,
  lootSignupRow, crimeSignupRow,
};
