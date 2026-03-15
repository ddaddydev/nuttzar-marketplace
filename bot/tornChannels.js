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

// ── Recurring events ──────────────────────────────────────────────────────────
// day: 0=Sun … 6=Sat (UTC)
const EVENTS = [
  {
    name: 'Double Nerve',
    day: 5, hour: 0, emoji: '⚡',
    desc: 'All nerve costs halved — best time to grind crimes, OCs, or burn nerve on anything pricey.',
  },
  {
    name: 'Double Energy',
    day: 6, hour: 0, emoji: '🔋',
    desc: 'Energy gives double the XP and gym gains. Best day to train or chain.',
  },
  {
    name: 'Blood on the Streets',
    day: 1, hour: 0, emoji: '🩸',
    desc: 'Mugging pays double. Good day to mug targets for easy cash.',
  },
  {
    name: 'Points Sale',
    day: 2, hour: 0, emoji: '💎',
    desc: 'Torn points go on sale. Stock up on refills, stat enhancers, or resell for profit.',
  },
  {
    name: 'Faction Bonus',
    day: 4, hour: 0, emoji: '⚔️',
    desc: 'Faction respect gains are boosted. Good day to chain or run OCs with your faction.',
  },
  {
    name: 'Chain Bonus Weekend',
    day: 5, hour: 0, emoji: '🔗',
    desc: 'Chain bonuses are doubled Fri–Sun. Coordinate with your faction for big respect gains.',
  },
];

function nextOccurrence({ day, hour = 0, minute = 0 }) {
  const now     = new Date();
  const nowUTC  = now.getTime();
  let daysUntil = (day - now.getUTCDay() + 7) % 7;
  if (daysUntil === 0) {
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
    if (todayMs <= nowUTC) daysUntil = 7;
  }
  const base = new Date(nowUTC + daysUntil * 86400000);
  return Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute);
}

// Returns "in X days Y hrs" or "in Xh Ym" or "in Xm" depending on how far away
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
  // TCT clock — only show HH:MM, updates every 15 min so seconds aren't shown
  const tct     = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')} TCT`;

  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const toReset  = Math.max(0, Math.round((midnight - Date.now()) / 1000));
  const rH = Math.floor(toReset / 3600), rM = Math.floor((toReset % 3600) / 60);
  const resetStr = `${rH}h ${String(rM).padStart(2,'0')}m`;

  const events = EVENTS.map(e => ({ ...e, nextMs: nextOccurrence(e) })).sort((a, b) => a.nextMs - b.nextMs);
  const next   = events[0];

  return {
    color: 0x3498DB,
    title: `🕐 ${tct}`,
    description:
      `🔄 Daily reset ${fmtTimeUntil(midnight)} · **${resetStr}** left
` +
      `📍 Next up: ${next.emoji} **${next.name}** — ${fmtTimeUntil(next.nextMs)}`,
    fields: [{
      name: '📅 Upcoming Events',
      value: events.map(e =>
        `${e.emoji} **${e.name}** — ${fmtTimeUntil(e.nextMs)}
` +
        `　*${e.desc}*`
      ).join('

'),
      inline: false,
    }],
    footer: { text: 'TCT = UTC · Recurring weekly events · Updates every 15 minutes' },
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
  const hotShoplift = Object.entries(crimesData.shoplifting || {})
    .filter(([, items]) => Array.isArray(items) && items.length && items.every(i => i.disabled === true))
    .map(([key, items]) => ({ name: fmtKey(key), detail: items.map(i => i.title).join(', ') }));

  const searchLines = hotSearch.length
    ? hotSearch.map(s => `🟢 **${s.name}** — **${s.pct}%** · _${s.title}_`).join('\n')
    : `_No subcategories above ${CASH_THRESHOLD}% right now_`;

  const shopliftLines = hotShoplift.length
    ? hotShoplift.map(s => `🔓 **${s.name}** — All clear _(${s.detail})_`).join('\n')
    : '_No fully clear shoplifting opportunities_';

  const hasAlert = hotSearch.length > 0 || hotShoplift.length > 0;

  return {
    color:       hasAlert ? 0x2ECC71 : 0x95A5A6,
    title:       hasAlert ? '🚨 Crimes Intel — Go Time!' : '🔍 Crimes Intel',
    description: hasAlert ? '**Crime opportunities detected!**' : '_Monitoring... nothing hot right now_',
    fields: [
      { name: `💰 Search for Cash (≥${CASH_THRESHOLD}%)`,  value: searchLines,   inline: false },
      { name: '🏪 Shoplifting (All Guards/Cameras Off)',    value: shopliftLines, inline: false },
    ],
    footer: { text: `Beach ≥${BEACH_THRESHOLD}% · Other search ≥${CASH_THRESHOLD}% · Shoplifting all-clear · Updates every 5m` },
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
