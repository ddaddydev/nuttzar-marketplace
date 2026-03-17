// bot/channelManager.js
// Manages persistent embeds: Loot Timer, Crimes Intel, Calendar/TCT, Level List, Hospital Results

const {
  buildLootEmbed, buildCalendarEmbed, buildCrimesEmbed, fetchCrimesData,
  lootSignupRow, crimeSignupRow,
  LOOT_CHANNEL_ID, CRIMES_CHANNEL_ID, CALENDAR_CHANNEL_ID,
  LOOT_FIGHTER_ROLE, CRIME_ROLE,
} = require('./tornChannels');

const { LEVEL_LIST_CHANNEL_ID, buildLevelListEmbeds } = require('./tornLevelList');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

// ── Tracked message IDs ───────────────────────────────────────────────────────
let lootMsgId     = null;
let crimesMsgId   = null;
let calendarMsgId = null;
let levelMsgIds   = []; // array — dynamic embed count

let _prevCrimesAlert = false;
let _crimesPingMsgId = null;

// ── Hospital results channel ──────────────────────────────────────────────────
const HOSPITAL_CHANNEL_ID  = '1483273417653358785';
let hospitalControlMsgId   = null;
let hospitalResultMsgIds   = [];
let hospitalLastCheckAt    = null;
const HOSPITAL_STALE_MS    = 2 * 60 * 60000; // 2 hours

function buildHospitalControlPayload() {
  const hospBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_check_hospital')
      .setLabel('🏥 Check Hospital Status')
      .setStyle(ButtonStyle.Danger)
  );

  const isStale = !hospitalLastCheckAt || (Date.now() - hospitalLastCheckAt > HOSPITAL_STALE_MS);
  const statusLine = isStale
    ? '⚠️ **No recent data** — click to update'
    : `✅ Last updated: <t:${Math.floor(hospitalLastCheckAt / 1000)}:R>`;

  return {
    content: [
      '## 🏥 Hospital Status Tracker',
      'Runs a live hospital check on all level-list targets using your stored API key.',
      '_You must be verified to use this. Results update in this channel._',
      '',
      statusLine,
    ].join('\n'),
    components: [hospBtn],
  };
}

async function initHospitalChannel(client) {
  try {
    const ch = await client.channels.fetch(HOSPITAL_CHANNEL_ID).catch(() => null);
    if (!ch) return console.warn('[CHANNELS] Hospital results channel not found');

    // Purge existing bot messages (clean slate on restart)
    const fetched = await ch.messages.fetch({ limit: 100 });
    const botMsgs = [...fetched.filter(m => m.author.id === client.user.id).values()];
    for (const msg of botMsgs) await msg.delete().catch(() => {});

    // Post fresh control message (no data state)
    const ctrl = await ch.send(buildHospitalControlPayload());
    hospitalControlMsgId = ctrl.id;
    console.log('[CHANNELS] Hospital channel initialized');
  } catch (e) { console.error('[CHANNELS] initHospitalChannel:', e.message); }
}

async function updateHospitalResults(client, embeds) {
  try {
    const ch = await client.channels.fetch(HOSPITAL_CHANNEL_ID).catch(() => null);
    if (!ch) return;

    hospitalLastCheckAt = Date.now();

    // Delete old result embeds
    for (const msgId of hospitalResultMsgIds) {
      try { await (await ch.messages.fetch(msgId)).delete(); } catch {}
    }
    hospitalResultMsgIds = [];

    // Delete old control message so we can repost it at the bottom
    if (hospitalControlMsgId) {
      try { await (await ch.messages.fetch(hospitalControlMsgId)).delete(); } catch {}
      hospitalControlMsgId = null;
    }

    // Post result embeds
    for (const embed of embeds) {
      const msg = await ch.send({ embeds: [embed] });
      hospitalResultMsgIds.push(msg.id);
    }

    // Repost control message at bottom with fresh timestamp
    const ctrl = await ch.send(buildHospitalControlPayload());
    hospitalControlMsgId = ctrl.id;

    console.log(`[CHANNELS] Hospital results updated (${embeds.length} embeds)`);
  } catch (e) { console.error('[CHANNELS] updateHospitalResults:', e.message); }
}

// ── Generic upsert — edit if we have message ID, otherwise post fresh ─────────
async function upsertEmbed(client, channelId, getMsgId, setMsgId, embed, components) {
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch) return console.warn(`[CHANNELS] Channel ${channelId} not found`);

    const payload = { embeds: [embed], components: components ? [components] : [] };
    const existId = getMsgId();

    if (existId) {
      try {
        const msg = await ch.messages.fetch(existId);
        await msg.edit(payload);
        return;
      } catch { setMsgId(null); }
    }

    // Post fresh — purge old bot messages
    const fetched = await ch.messages.fetch({ limit: 100 });
    const botMsgs = fetched.filter(m => m.author.id === client.user.id);
    if (botMsgs.size > 1) await ch.bulkDelete(botMsgs).catch(() => {});
    else if (botMsgs.size === 1) await botMsgs.first().delete().catch(() => {});

    const msg = await ch.send(payload);
    setMsgId(msg.id);
  } catch (e) { console.error(`[CHANNELS] upsertEmbed(${channelId}):`, e.message); }
}

// ── Loot ──────────────────────────────────────────────────────────────────────
async function refreshLoot(client) {
  await upsertEmbed(client, LOOT_CHANNEL_ID,
    () => lootMsgId, id => { lootMsgId = id; },
    await buildLootEmbed(), lootSignupRow()
  );
}

// ── Calendar ──────────────────────────────────────────────────────────────────
async function refreshCalendar(client) {
  await upsertEmbed(client, CALENDAR_CHANNEL_ID,
    () => calendarMsgId, id => { calendarMsgId = id; },
    buildCalendarEmbed(), null
  );
}

// ── Crimes ────────────────────────────────────────────────────────────────────
async function refreshCrimes(client) {
  try {
    const apiKey = process.env.ADMIN_API_KEY;
    if (!apiKey) return console.warn('[CRIMES] ADMIN_API_KEY not set');

    const ch         = await client.channels.fetch(CRIMES_CHANNEL_ID).catch(() => null);
    if (!ch) return;

    const crimesData = await fetchCrimesData(apiKey);
    const embed      = buildCrimesEmbed(crimesData);
    const hasAlert   = embed.color === 0x2ECC71;
    const isNewAlert = hasAlert && !_prevCrimesAlert;
    _prevCrimesAlert = hasAlert;

    await upsertEmbed(client, CRIMES_CHANNEL_ID,
      () => crimesMsgId, id => { crimesMsgId = id; },
      embed, crimeSignupRow()
    );

    if (isNewAlert) {
      if (_crimesPingMsgId) {
        try { await (await ch.messages.fetch(_crimesPingMsgId)).delete(); } catch {}
        _crimesPingMsgId = null;
      }
      const pingMsg = await ch.send({ content: `<@&${CRIME_ROLE}> 🚨 Crime opportunity is live!` });
      _crimesPingMsgId = pingMsg.id;
    }

    if (!hasAlert && _crimesPingMsgId) {
      try { await (await ch.messages.fetch(_crimesPingMsgId)).delete(); } catch {}
      _crimesPingMsgId = null;
    }
  } catch (e) { console.error('[CHANNELS] refreshCrimes:', e.message); }
}

// ── Level List ────────────────────────────────────────────────────────────────
async function deleteBotMessages(ch, client) {
  try {
    const fetched = await ch.messages.fetch({ limit: 100 });
    const botMsgs = [...fetched.filter(m => m.author.id === client.user.id).values()];
    for (const msg of botMsgs) await msg.delete().catch(() => {});
  } catch {}
}

async function refreshLevelList(client) {
  try {
    const ch = await client.channels.fetch(LEVEL_LIST_CHANNEL_ID).catch(() => null);
    if (!ch) return console.warn('[CHANNELS] Level list channel not found');

    const embeds = buildLevelListEmbeds();

    if (levelMsgIds.length === embeds.length) {
      let ok = true;
      const hospBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_check_hospital')
          .setLabel('🏥 Check Hospital Status')
          .setStyle(ButtonStyle.Danger)
      );
      for (let i = 0; i < embeds.length; i++) {
        try {
          const isLast = i === embeds.length - 1;
          const msg = await ch.messages.fetch(levelMsgIds[i]);
          await msg.edit({ embeds: [embeds[i]], components: isLast ? [hospBtn] : [] });
        } catch { ok = false; break; }
      }
      if (ok) return;
    }

    await deleteBotMessages(ch, client);

    const hospBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_check_hospital')
        .setLabel('🏥 Check Hospital Status')
        .setStyle(ButtonStyle.Danger)
    );

    levelMsgIds = [];
    for (let i = 0; i < embeds.length; i++) {
      const isLast = i === embeds.length - 1;
      const msg = await ch.send({ embeds: [embeds[i]], components: isLast ? [hospBtn] : [] });
      levelMsgIds.push(msg.id);
    }
    console.log(`[CHANNELS] Level list posted (${embeds.length} embeds)`);
  } catch (e) { console.error('[CHANNELS] refreshLevelList:', e.message); }
}

// ── Button handler ────────────────────────────────────────────────────────────
async function handleChannelButton(interaction) {
  const { customId: id } = interaction;

  if (id === 'toggle_loot_fighter' || id === 'toggle_crime_role') {
    const roleId = id === 'toggle_loot_fighter' ? LOOT_FIGHTER_ROLE : CRIME_ROLE;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Could not fetch your server profile.', ephemeral: true });
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role)  return interaction.reply({ content: '❌ Role not found. Contact an admin.', ephemeral: true });

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(role);
      const label = id === 'toggle_loot_fighter' ? 'Loot Fighter' : 'Crime';
      return interaction.reply({ content: `🔕 ${label} alerts disabled.`, ephemeral: true });
    }
    await member.roles.add(role);
    const msg = id === 'toggle_loot_fighter'
      ? '⚔️ You\'re now a **Loot Fighter**! You\'ll be pinged for NPC loot opportunities.'
      : '🔍 Crime alerts enabled! You\'ll be pinged when opportunities are live.';
    return interaction.reply({ content: msg, ephemeral: true });
  }

  return false; // not handled here
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initChannels(client) {
  console.log('[CHANNELS] Initialising...');

  await Promise.all([
    refreshLoot(client),
    refreshCalendar(client),
    refreshCrimes(client),
    refreshLevelList(client),
    initHospitalChannel(client),
  ]);

  setInterval(() => refreshLoot(client), 60000);

  // Align calendar to :00/:15/:30/:45 UTC boundaries
  const alignCalendar = () => {
    const now      = Date.now();
    const ms15     = 15 * 60000;
    const msToNext = ms15 - (now % ms15);
    setTimeout(() => {
      refreshCalendar(client);
      setInterval(() => refreshCalendar(client), ms15);
    }, msToNext);
  };
  alignCalendar();

  setInterval(() => refreshCrimes(client),    5 * 60000);
  setInterval(() => refreshLevelList(client), 5 * 60000);

  // Refresh hospital control message staleness indicator every 15 mins
  setInterval(async () => {
    if (!hospitalControlMsgId) return;
    try {
      const ch  = await client.channels.fetch(HOSPITAL_CHANNEL_ID).catch(() => null);
      if (!ch) return;
      const msg = await ch.messages.fetch(hospitalControlMsgId).catch(() => null);
      if (msg) await msg.edit(buildHospitalControlPayload());
    } catch {}
  }, 15 * 60000);

  console.log('[CHANNELS] All pollers started');
}

module.exports = { initChannels, handleChannelButton, updateHospitalResults, HOSPITAL_CHANNEL_ID };
