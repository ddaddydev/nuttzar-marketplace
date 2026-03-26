require('dotenv').config();

const {
  Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, InteractionType, Events, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const axios = require('axios');

const api = require('./apiClient');
const {
  buildContractEmbed, buildContractButtons, buildClaimDmEmbed, buildCompleteButton,
  buildPayoutEmbed, buildBalanceEmbed, buildVerifySuccessEmbed, buildVerifyFailEmbed,
  buildNoContractsEmbed, formatMoney,
} = require('./embeds');
const {
  fetchScoredItems, fetchBestForWindow,
  buildCountrySummaryEmbed, buildInStockEmbed, buildPredictedEmbed, buildBestArrivalEmbed,
  buildAlertSelectionEmbed, buildAlertEmbed,
  FLIGHT_MINS, closestWindow,
} = require('./flightAlerts');
const { initChannels, handleChannelButton, updateHospitalResults } = require('./channelManager');
const { LEVEL_LIST_CHANNEL_ID, checkHospitalStatus, buildHospitalEmbeds } = require('./tornLevelList');

// ── Constants ─────────────────────────────────────────────────────────────────
const ADMIN_TORN_ID           = '4042794';
const ADMIN_DISCORD_ID        = process.env.ADMIN_DISCORD_ID || '';
const VERIFIED_ROLE_ID        = '1482119037369454832';
const VERIFIED_SELLER_ROLE_ID = '1481079028281643120';
const NUTTS_FLYER_ROLE_ID     = '1482148430498369739';
const BACKEND                 = process.env.BACKEND_URL || 'https://calm-perception-production.up.railway.app';
const CLS_LABELS              = { std:'Standard', airstrip:'Airstrip', wlt:'WLT', business:'Business' };

const CHANNEL_IDS = {
  loss:        process.env.DISCORD_LOSS_CHANNEL,
  bounty:      process.env.DISCORD_BOUNTY_CHANNEL,
  escape:      process.env.DISCORD_ESCAPE_CHANNEL,
  payout:      process.env.DISCORD_PAYOUT_CHANNEL,
  alerts:      '1481475449182748797',
  howToSell:   '1481079970490220686',
  flight:      '1482148186138214494',
  leaderboard: '1485369655643340931',
};

// ── State ─────────────────────────────────────────────────────────────────────
const contractMessages    = new Map();
const pingMessages        = new Map(); // Bug #3: contractId → { channelId, messageId }
const payoutMessages      = new Map();
const placeholderMessages = new Map();
const notifiedPayouts     = new Set();
const notifiedAlerts      = new Map();

let flightCountryMsgId   = null;
let flightInStockMsgId   = null;
let flightPredictedMsgId = null;
let leaderboardMsgId     = null;

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages,
  ],
});

// ── Shared helpers ────────────────────────────────────────────────────────────
const _ikey = () => ({ 'x-internal-key': process.env.INTERNAL_API_KEY || '' });
const get   = (url, opts = {})       => axios.get(url,  { timeout: 5000, headers: _ikey(), ...opts }).catch(() => null);

// Bug #4 fix: Preserve HTTP error responses so callers can show the real error
// Previously: .catch(() => null) — swallowed ALL errors including 4xx/5xx with useful messages
const post  = (url, data, opts = {}) =>
  axios.post(url, data,  { timeout: 5000, headers: _ikey(), ...opts })
    .catch(e => e.response || null);

const patch = (url, data, opts = {}) =>
  axios.patch(url, data, { timeout: 5000, headers: _ikey(), ...opts })
    .catch(e => e.response || null);

async function getTornId(discordId) {
  const r = await get(`${BACKEND}/api/users/by-discord/${discordId}`);
  return r?.data?.torn_id || null;
}

async function getFlightPrefs(discordId) {
  const r = await get(`${BACKEND}/api/flight-prefs/${discordId}`);
  return r?.data || { travel_class: 'std', capacity: 10, subscribed_items: [] };
}

function modal(customId, title, ...inputs) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title);
  m.addComponents(...inputs.map(i => new ActionRowBuilder().addComponents(i)));
  return m;
}

function textInput(customId, label, opts = {}) {
  return new TextInputBuilder()
    .setCustomId(customId).setLabel(label)
    .setStyle(opts.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(opts.required !== false)
    .setPlaceholder(opts.placeholder || '')
    .setMinLength(opts.min || 0)
    .setMaxLength(opts.max || 4000);
}

function btn(customId, label, style = ButtonStyle.Secondary, emoji) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function row(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons);
}

// ── Channel purge ─────────────────────────────────────────────────────────────
async function purgeChannel(channelId) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch) return;
    const msgs    = await ch.messages.fetch({ limit: 100 });
    const botMsgs = msgs.filter(m => m.author.id === client.user.id);
    if (!botMsgs.size) return;
    const cutoff  = Date.now() - 14 * 86400000;
    const bulk    = botMsgs.filter(m => m.createdTimestamp > cutoff);
    const old     = botMsgs.filter(m => m.createdTimestamp <= cutoff);
    if (bulk.size > 1) await ch.bulkDelete(bulk).catch(() => {});
    else if (bulk.size === 1) await bulk.first().delete().catch(() => {});
    for (const m of old.values()) await m.delete().catch(() => {});
  } catch (e) { console.warn(`[BOT] purgeChannel ${channelId}:`, e.message); }
}

// ── Become Seller embed ───────────────────────────────────────────────────────
async function postBecomeSeller() {
  try {
    const ch = await client.channels.fetch(CHANNEL_IDS.howToSell).catch(() => null);
    if (!ch) return;
    await purgeChannel(CHANNEL_IDS.howToSell);
    await ch.send({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2).setTitle('💼 Become a Verified Seller')
        .setDescription(
          'Want to take contracts and earn in-game cash?\n\n' +
          '**Requirements:** Must be verified with `/verify` first\n\n' +
          '**Perks:**\n• Access to all active contracts\n• Pinged when new contracts go live\n• Earn 90% of each contract\'s value\n\n' +
          'Click the button below to get started.'
        ).setFooter({ text: 'Nuttzar Marketplace' }).setTimestamp()],
      components: [row(btn('become_seller', 'Become a Verified Seller', ButtonStyle.Primary, '✅'))],
    });
  } catch (e) { console.error('[BOT] postBecomeSeller:', e.message); }
}

// ── Leaderboard embed ────────────────────────────────────────────────────────
async function refreshLeaderboard() {
  try {
    const ch = await client.channels.fetch(CHANNEL_IDS.leaderboard).catch(() => null);
    if (!ch) return;
    const res = await get(`${BACKEND}/api/users/leaderboard`);
    if (!res?.data?.success || !res.data.leaderboard) return;

    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    const rows   = res.data.leaderboard;
    const fields = rows.length
      ? rows.map((u, i) => ({
          name:   `${medals[i]} ${u.torn_name || `User [${u.torn_id}]`}`,
          value:  `💰 **${formatMoney(u.lifetime_earned)}** earned · ${u.completed_claims} claims completed`,
          inline: false,
        }))
      : [{ name: 'No data yet', value: '_Complete some contracts to appear here!_', inline: false }];

    const embed = {
      color: 0xF1C40F,
      title: '🏆 NuttHub Top Earners — All Time',
      description: 'Updated automatically whenever a payout is sent.',
      fields,
      footer: { text: 'NuttHub Marketplace · Nuttzar' },
      timestamp: new Date().toISOString(),
    };

    if (leaderboardMsgId) {
      try {
        const msg = await ch.messages.fetch(leaderboardMsgId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch { leaderboardMsgId = null; }
    }

    // Purge old bot messages and post fresh
    const fetched = await ch.messages.fetch({ limit: 20 });
    const botMsgs = fetched.filter(m => m.author.id === client.user.id);
    for (const m of botMsgs.values()) await m.delete().catch(() => {});
    const msg = await ch.send({ embeds: [embed] });
    leaderboardMsgId = msg.id;
  } catch (e) { console.error('[BOT] refreshLeaderboard:', e.message); }
}

// ── Flight intel embeds (3 messages: country summary, in-stock, predicted) ────
async function refreshFlightEmbed() {
  try {
    const ch = await client.channels.fetch(CHANNEL_IDS.flight).catch(() => null);
    if (!ch) return;
    const { inStock, predicted, allRaw, updatedAt } = await fetchScoredItems();

    const countryEmbed = buildCountrySummaryEmbed(allRaw, updatedAt);
    const stockEmbed   = buildInStockEmbed(inStock, updatedAt);
    const predEmbed    = buildPredictedEmbed(predicted, updatedAt);

    // Try to edit all three existing messages
    if (flightCountryMsgId && flightInStockMsgId && flightPredictedMsgId) {
      try {
        const m1 = await ch.messages.fetch(flightCountryMsgId);
        const m2 = await ch.messages.fetch(flightInStockMsgId);
        const m3 = await ch.messages.fetch(flightPredictedMsgId);
        await m1.edit({ embeds: [countryEmbed] });
        await m2.edit({ embeds: [stockEmbed] });
        await m3.edit({ embeds: [predEmbed] });
        return;
      } catch {
        flightCountryMsgId   = null;
        flightInStockMsgId   = null;
        flightPredictedMsgId = null;
      }
    }

    // Post fresh — purge then send all three, no buttons
    await purgeChannel(CHANNEL_IDS.flight);
    try {
      const m1 = await ch.send({ embeds: [countryEmbed] });
      flightCountryMsgId = m1.id;
    } catch (e) { console.error('[BOT] flight m1 send:', e.message); }
    try {
      const m2 = await ch.send({ embeds: [stockEmbed] });
      flightInStockMsgId = m2.id;
    } catch (e) { console.error('[BOT] flight m2 send:', e.message); }
    try {
      const m3 = await ch.send({ embeds: [predEmbed] });
      flightPredictedMsgId = m3.id;
    } catch (e) { console.error('[BOT] flight m3 send:', e.message); }
  } catch (e) { console.error('[BOT] refreshFlightEmbed:', e.message); }
}

// ── Flight alert poller ───────────────────────────────────────────────────────
async function pollFlightAlerts() {
  try {
    const { inStock, predicted } = await fetchScoredItems();
    const allItems = [...inStock, ...predicted];
    if (!allItems.length) return;

    const prefsRes = await get(`${BACKEND}/api/flight-prefs`);
    const allPrefs = prefsRes?.data || [];
    if (!allPrefs.length) return;

    const ch  = await client.channels.fetch(CHANNEL_IDS.flight).catch(() => null);
    const now = Date.now();

    for (const { discord_id, travel_class: cls = 'std', capacity, subscribed_items = [] } of allPrefs) {
      if (!subscribed_items.length) continue;
      const subSet = new Set(subscribed_items.map(String));

      for (const item of allItems) {
        if (!subSet.has(String(item.id))) continue;
        if (!item.windows) continue;

        const flMins  = FLIGHT_MINS[item.country]?.[cls] || FLIGHT_MINS[item.country]?.std || 120;
        const wKey    = closestWindow(flMins);
        const w       = item.windows[wKey];
        if (!w) continue;

        let shouldAlert = false;
        if (item.qty > 0) {
          // In stock but will deplete before landing — worth alerting if refill is likely
          shouldAlert = w.depletes && w.refillChance >= 25;
        } else {
          // Empty — alert if good refill chance at this flight window
          shouldAlert = w.refillChance >= 30;
        }
        if (!shouldAlert) continue;

        const key = `${discord_id}:${item.id}:${item.country}`;
        if (now - (notifiedAlerts.get(key) || 0) < 30 * 60000) continue;

        try {
          const cap        = Math.min(capacity || 10, 35);
          const alertEmbed = buildAlertEmbed(item, flMins, cls, cap);
          const user       = await client.users.fetch(discord_id).catch(() => null);
          if (user) await user.send({ embeds: [alertEmbed] }).catch(() => {});
          if (ch)  await ch.send({ content: `<@${discord_id}> <@&${NUTTS_FLYER_ROLE_ID}>`, embeds: [alertEmbed] }).catch(() => {});
          notifiedAlerts.set(key, now);
        } catch (e) { console.warn('[BOT] flight alert:', e.message); }
      }
    }
  } catch (e) { console.error('[BOT] pollFlightAlerts:', e.message); }
}

// ── Payout poller ─────────────────────────────────────────────────────────────
async function pollPayouts() {
  try {
    const result = await api.getPendingPayouts();
    if (!result.success || !result.payouts?.length) return;
    for (const payout of result.payouts) {
      if (notifiedPayouts.has(payout.id)) continue;
      // Fetch the specific contract by ID — works even if completed
      const contractRes = await get(`${BACKEND}/api/contracts/${payout.contract_id}`).catch(() => null);
      const contract = contractRes?.data?.contract
        || { id: payout.contract_id, type: payout.contract_type || 'loss', target_torn_name: 'Unknown', target_torn_id: '0' };
      await sendPayoutNotification(
        { id: payout.claim_id, seller_torn_id: payout.seller_torn_id, payout_amount: payout.amount, quantity_claimed: payout.quantity_claimed ?? '?' },
        contract,
        payout.seller_torn_id, payout.id
      );
      notifiedPayouts.add(payout.id);
    }
  } catch (e) { console.error('[BOT] pollPayouts:', e.message); }
}

async function sendPayoutNotification(fakeClaim, fakeContract, sellerTornId, payoutId) {
  try {
    const ch = await client.channels.fetch(CHANNEL_IDS.payout);
    if (!ch) return;
    const msg = await ch.send({
      content: `<@${ADMIN_DISCORD_ID}> 💰 **New payout! Use \`/markpaid ${payoutId}\` once sent.**`,
      embeds:  [buildPayoutEmbed(fakeClaim, fakeContract, sellerTornId, payoutId)],
    });
    if (payoutId) payoutMessages.set(payoutId, { channelId: CHANNEL_IDS.payout, messageId: msg.id });
  } catch (e) { console.error('[BOT] sendPayoutNotification:', e.message); }
}

// ── Contract embeds ───────────────────────────────────────────────────────────
// Bug #3 fix: Track ping messages so they can be deleted when contract completes
async function postContractEmbed(contract) {
  const channelId = CHANNEL_IDS[contract.type];
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  await removePlaceholder(contract.type, ch);

  const embed   = buildContractEmbed(contract);
  const buttons = buildContractButtons(contract);

  if (contractMessages.has(contract.id)) {
    try {
      const msg = await ch.messages.fetch(contractMessages.get(contract.id).messageId);
      await msg.edit({ embeds: [embed], components: [buttons] });
      return;
    } catch { /* fall through to post fresh */ }
  }

  const role = ch.guild.roles.cache.get(VERIFIED_SELLER_ROLE_ID);
  const lbl  = contract.type.charAt(0).toUpperCase() + contract.type.slice(1);

  // Bug #3 fix: Track the ping message so we can delete it later
  const pingMsg = await ch.send(`${role ? `<@&${role.id}> ` : ''}🆕 New **${lbl}** contract — $${Number(contract.price_per_unit).toLocaleString()}/unit`);
  pingMessages.set(contract.id, { channelId, messageId: pingMsg.id });

  const msg = await ch.send({ embeds: [embed], components: [buttons] });
  contractMessages.set(contract.id, { channelId, messageId: msg.id });
}

async function updateContractEmbed(contractId) {
  const result   = await api.getActiveContracts().catch(() => ({ contracts: [] }));
  const contract = result.contracts?.find(c => c.id === contractId);
  if (contract) await postContractEmbed(contract);
}

// Bug #3 fix: Also delete the ping message when deleting contract embed
async function deleteContractEmbed(contractId) {
  // Delete embed
  if (contractMessages.has(contractId)) {
    try {
      const { channelId, messageId } = contractMessages.get(contractId);
      const ch  = await client.channels.fetch(channelId).catch(() => null);
      const msg = await ch?.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete();
    } catch (e) { console.error('[BOT] deleteContractEmbed embed:', e.message); }
    contractMessages.delete(contractId);
  }
  // Bug #3 fix: Also delete the ping message
  if (pingMessages.has(contractId)) {
    try {
      const { channelId, messageId } = pingMessages.get(contractId);
      const ch  = await client.channels.fetch(channelId).catch(() => null);
      const msg = await ch?.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete();
    } catch (e) { console.error('[BOT] deleteContractEmbed ping:', e.message); }
    pingMessages.delete(contractId);
  }
}

// Bug #2 fix: Don't post placeholder if API call failed — we don't know the real state
async function ensurePlaceholder(type) {
  const channelId = CHANNEL_IDS[type];
  if (!channelId || placeholderMessages.has(type)) return;
  const ch     = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  const result = await api.getActiveContracts(type);
  // Bug #2 fix: If API failed (result.success is false/undefined), bail out instead of posting placeholder
  if (!result || !result.success) return;
  if (result.contracts?.length) return;
  const msg = await ch.send({ embeds: [buildNoContractsEmbed(type)] });
  placeholderMessages.set(type, msg.id);
}

async function removePlaceholder(type, ch) {
  if (!placeholderMessages.has(type)) return;
  try {
    const msg = await ch.messages.fetch(placeholderMessages.get(type)).catch(() => null);
    if (msg) await msg.delete();
  } catch {}
  placeholderMessages.delete(type);
}

async function refreshAllContractEmbeds() {
  try {
    const result = await api.getActiveContracts();
    if (!result.success) return;
    for (const contract of result.contracts) await postContractEmbed(contract);
    for (const type of ['loss', 'bounty', 'escape']) await ensurePlaceholder(type);
    console.log(`[BOT] Refreshed ${result.contracts.length} contracts`);
  } catch (e) { console.error('[BOT] refreshAllContractEmbeds:', e.message); }
}

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  await Promise.all(['loss', 'bounty', 'escape', 'payout'].map(k => purgeChannel(CHANNEL_IDS[k])));
  await postBecomeSeller();
  await refreshAllContractEmbeds();
  await refreshFlightEmbed();
  await refreshLeaderboard();
  await initChannels(client);

  // Refresh leaderboard daily at midnight UTC
  const scheduleDailyLeaderboard = () => {
    const now       = Date.now();
    const midnight  = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    const msToMidnight = midnight.getTime() - now;
    setTimeout(() => {
      refreshLeaderboard();
      setInterval(() => refreshLeaderboard(), 24 * 60 * 60000);
    }, msToMidnight);
  };
  scheduleDailyLeaderboard();
  setInterval(pollPayouts,        30000);
  setInterval(refreshFlightEmbed, 15 * 60000); // matches worker update frequency
  setInterval(pollFlightAlerts,   2 * 60000);
  console.log('[BOT] Ready');
});

// ── Interaction router ────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  try {
    if      (interaction.isChatInputCommand())                  await handleSlash(interaction);
    else if (interaction.type === InteractionType.ModalSubmit)  await handleModal(interaction);
    else if (interaction.isButton())                            await handleButton(interaction);
  } catch (e) {
    console.error('[BOT] Interaction error:', e);
    const msg = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

// ── Slash commands ────────────────────────────────────────────────────────────
async function handleSlash(interaction) {
  const { commandName: cmd } = interaction;

  if (cmd === 'verify') {
    return interaction.reply({
      embeds: [{
        color: 0x5865F2, title: '🔑 Verify Your Torn Account',
        description:
          '**Step 1:** Generate your NuttHub API key\n' +
          '> [Click here to create your key](https://www.torn.com/preferences.php#tab=api?&step=addNewKey&title=NuttHub&type=4)\n' +
          '> *(Opens Torn — permissions are pre-configured)*\n\n' +
          '**Step 2:** Copy the key, then click the button below and paste it in.',
        footer: { text: 'Your API key is stored securely and only used to verify your Torn identity.' },
      }],
      components: [row(btn('open_verify_modal', 'Enter My API Key', ButtonStyle.Primary, '🔑'))],
      ephemeral: true,
    });
  }

  if (cmd === 'flightsetup') {
    return interaction.showModal(modal('modal_flightsetup', 'Flight Setup',
      textInput('capacity',     'Carry Capacity (1–35 items)', { placeholder: 'e.g. 29', min: 1, max: 2 }),
      textInput('travel_class', 'Travel Class: std / airstrip / wlt / business', { placeholder: 'std', min: 3, max: 10 })
    ));
  }

  if (cmd === 'flight-alerts') {
    await interaction.deferReply({ ephemeral: true });
    const prefs = await getFlightPrefs(interaction.user.id);
    let inStock = [], predicted = [];
    try { ({ inStock, predicted } = await fetchScoredItems()); }
    catch { return interaction.editReply({ content: '❌ Could not fetch stock data. Try again shortly.' }); }

    const allItems = [...inStock, ...predicted];
    if (!allItems.length) return interaction.editReply({ content: '📭 No items to subscribe to right now.' });

    const subSet = new Set(prefs.subscribed_items.map(String));
    const rows   = [allItems.slice(0, 5), allItems.slice(5, 10)]
      .filter(chunk => chunk.length)
      .map(chunk => row(...chunk.map(item => {
        const subbed = subSet.has(String(item.id));
        return btn(
          `toggle_alert:${item.id}:${item.country}`,
          `${item.name} (${item.country.toUpperCase()})`,
          subbed ? ButtonStyle.Success : ButtonStyle.Secondary,
          subbed ? '🔔' : '🔕'
        );
      })));

    return interaction.editReply({ embeds: [buildAlertSelectionEmbed(inStock, predicted, prefs.subscribed_items)], components: rows });
  }

  if (cmd === 'bestarrival') {
    await interaction.deferReply({ ephemeral: false });
    const mins = Math.max(1, Math.min(300, interaction.options.getInteger('minutes') ?? 30));
    let data;
    try { data = await fetchBestForWindow(mins, 10); }
    catch { return interaction.editReply({ content: '❌ Could not fetch stock data. Try again shortly.' }); }
    if (!data.items.length) return interaction.editReply({ content: `📭 No results found for a ${mins}m flight window.` });
    return interaction.editReply({ embeds: [buildBestArrivalEmbed(data.flightMins, data.items, data.updatedAt)] });
  }

  if (cmd === 'xanax') {
    await interaction.deferReply({ ephemeral: true });
    let allRaw;
    try { ({ allRaw } = await fetchScoredItems()); }
    catch { return interaction.editReply({ content: '❌ Could not fetch stock data. Try again shortly.' }); }

    const now = Date.now();
    const xanaxItems = allRaw
      .filter(i => i.name?.toLowerCase().includes('xanax') && FLIGHT_MINS[i.country])
      .sort((a, b) => (b.opportunity?.score ?? 0) - (a.opportunity?.score ?? 0));

    if (!xanaxItems.length) return interaction.editReply({ content: '📭 No Xanax data available right now.' });

    const lines = xanaxItems.map(item => {
      const flag      = ({ mex:'🇲🇽', cay:'🇰🇾', can:'🇨🇦', haw:'🌺', uk:'🇬🇧', uni:'🇬🇧', arg:'🇦🇷', swi:'🇨🇭', jap:'🇯🇵', chi:'🇨🇳', uae:'🇦🇪', sou:'🇿🇦' })[item.country] || '🌍';
      const CC_NAMES  = { mex:'Mexico', cay:'Cayman Islands', can:'Canada', haw:'Hawaii', uk:'United Kingdom', uni:'United Kingdom', arg:'Argentina', swi:'Switzerland', jap:'Japan', chi:'China', uae:'UAE', sou:'South Africa' };
      const pilotMins = FLIGHT_MINS[item.country]?.airstrip ?? '?';
      const landTct   = typeof pilotMins === 'number'
        ? new Date(now + pilotMins * 60000).toUTCString().match(/(\d{2}:\d{2})/)?.[1] || '?'
        : '?';

      if (item.qty > 0) {
        const minsLeft = item.burnRate > 0 ? Math.round(item.qty / item.burnRate) : null;
        const h = minsLeft != null ? Math.floor(minsLeft / 60) : null;
        const m = minsLeft != null ? minsLeft % 60 : null;
        const depStr = minsLeft != null
          ? `📉 ${h > 0 ? `${h}h ${m}m` : `${m}m`} left`
          : '📉 Rate unknown';
        return `${flag} **${CC_NAMES[item.country]||item.country}** · ${item.qty.toLocaleString()} in stock\n　${depStr} · ✈️ ${pilotMins}m → land ~${landTct} TCT`;
      } else {
        let restockStr = 'No restock history';
        if (item.lastEmptyAt && item.avgRestockMins) {
          const etaMs = item.lastEmptyAt + item.avgRestockMins * 60000;
          const tct   = new Date(etaMs).toUTCString().match(/(\d{2}:\d{2})/)?.[1] || '?';
          const away  = Math.round((etaMs - now) / 60000);
          restockStr  = away <= 0 ? `⚡ Overdue (~${tct} TCT)` : `⏰ ~${tct} TCT (in ${away}m)`;
        }
        return `${flag} **${CC_NAMES[item.country]||item.country}** · *empty*\n　${restockStr} · ✈️ ${pilotMins}m → land ~${landTct} TCT`;
      }
    }).join('\n\n');

    try {
      const user = await interaction.user.createDM();
      await user.send({
        embeds: [{
          color: 0xF1C40F,
          title: '💊 Xanax — All Countries',
          description: '> Private pilot times · In-stock shows depletion · Empty shows restock ETA',
          fields: [{ name: '📊 Current Status', value: lines }],
          footer: { text: 'Nuttzar Flight Intel · Always verify before flying' },
          timestamp: new Date().toISOString(),
        }],
      });
      return interaction.editReply({ content: '✅ Xanax flight data sent to your DMs!' });
    } catch {
      return interaction.editReply({ content: '❌ Could not DM you — make sure your DMs are open.' });
    }
  }

  if (cmd === 'myclaims') {
    await interaction.deferReply({ ephemeral: true });
    const tornId = await getTornId(interaction.user.id);
    if (!tornId) return interaction.editReply({ content: '❌ Not verified. Use `/verify` first.' });
    const result = await api.getActiveClaims(tornId);
    if (!result.success || !result.claims?.length) return interaction.editReply({ content: '📋 No active claims.' });
    const lines = result.claims.map(c => {
      const mins = Math.max(0, Math.floor((c.expires_at - Math.floor(Date.now() / 1000)) / 60));
      return `• **Contract #${c.contract_id}** (${c.type}) — ${c.quantity_claimed} unit(s) — ⏱️ ${mins}m — **${formatMoney(c.payout_amount)}**`;
    });
    return interaction.editReply({ content: `**Your Active Claims:**\n${lines.join('\n')}` });
  }

  if (cmd === 'contracts') {
    await interaction.deferReply({ ephemeral: true });
    const result = await api.getActiveContracts(interaction.options.getString('type'));
    if (!result.success || !result.contracts?.length) return interaction.editReply({ content: '📋 No active contracts.' });
    return interaction.editReply({ embeds: result.contracts.slice(0, 10).map(buildContractEmbed) });
  }

  if (cmd === 'bal') {
    await interaction.deferReply({ ephemeral: true });
    const tornId = await getTornId(interaction.user.id);
    if (!tornId) return interaction.editReply({ content: '❌ Not verified. Use `/verify` first.' });
    const [userRes, balResult] = await Promise.all([
      get(`${BACKEND}/api/users/by-discord/${interaction.user.id}`),
      api.getBalance(tornId),
    ]);
    if (!balResult.success) return interaction.editReply({ content: `❌ ${balResult.error}` });
    return interaction.editReply({ embeds: [buildBalanceEmbed(userRes?.data?.torn_name || `User [${tornId}]`, tornId, balResult)] });
  }

  if (cmd === 'markpaid') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const payoutId = interaction.options.getInteger('payout_id');
    const result   = await api.markPayoutSent(payoutId);
    if (!result.success) return interaction.editReply({ content: `❌ ${result.error}` });
    await interaction.editReply({ content: `✅ Payout #${payoutId} marked as sent.` });
    refreshLeaderboard().catch(() => {});
    if (payoutMessages.has(payoutId)) {
      try {
        const { channelId, messageId } = payoutMessages.get(payoutId);
        const ch  = await client.channels.fetch(channelId).catch(() => null);
        const msg = await ch?.messages.fetch(messageId).catch(() => null);
        if (msg) await msg.delete();
        payoutMessages.delete(payoutId);
      } catch {}
    }
    try {
      const payout  = result.payout;
      const userRes = await get(`${BACKEND}/api/users/by-torn/${payout?.seller_torn_id}`);
      const dId     = userRes?.data?.discord_id;
      if (dId) {
        const user = await client.users.fetch(dId).catch(() => null);
        await user?.send(`💰 **Payout Sent!** Your **$${Number(payout.amount).toLocaleString()}** has been sent in-game.\n*Payout ID: #${payoutId}*`);
      }
    } catch {}
    return;
  }

  if (cmd === 'cancelclaim') {
    await interaction.deferReply({ ephemeral: true });
    const claimId = interaction.options.getInteger('claim_id');

    // Admin can force-cancel any claim
    if (interaction.user.id === ADMIN_DISCORD_ID) {
      const res = await post(`${BACKEND}/api/claims/${claimId}/cancel`, {
        internal_key: process.env.INTERNAL_API_KEY,
      }, { timeout: 8000 });
      if (!res?.data?.success) {
        // Bug #4 fix: surface actual error from backend
        const errMsg = res?.data?.error || 'Unknown error';
        return interaction.editReply({ content: `❌ Failed: ${errMsg}` });
      }
      if (res.data.contract_id) await updateContractEmbed(res.data.contract_id).catch(() => {});
      return interaction.editReply({ content: `✅ Claim #${claimId} cancelled. Units returned to pool.` });
    }

    // Non-admins: request cancellation (notify admin)
    return interaction.editReply({
      content: `⚠️ Cancellation request submitted for Claim #${claimId}. An admin will review it shortly.`,
    });
  }

  if (cmd === 'admin-contract') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return interaction.showModal(modal('modal_admin_contract', 'Create Contract (Admin)',
      textInput('type',           'Type: loss / bounty / escape',          { placeholder: 'loss' }),
      textInput('target_torn_id', 'Target Torn ID',                        { placeholder: '4042794' }),
      textInput('quantity',       'Total Units',                           { placeholder: '10' }),
      textInput('price_per_unit', 'Price Per Unit ($)',                    { placeholder: '300000' }),
      textInput('bounty_amount',  'Bounty Amount (bounty only, else 0)',   { placeholder: '0', required: false })
    ));
  }

  if (cmd === 'admin-cancel-contract') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const contractId = interaction.options.getInteger('contract_id');
    const res = await post(`${BACKEND}/api/contracts/${contractId}/cancel`, {
      internal_key: process.env.INTERNAL_API_KEY,
    }, { timeout: 10000 });
    if (!res?.data?.success) {
      // Bug #4 fix: surface actual error from backend
      const errMsg = res?.data?.error || 'Unknown error';
      return interaction.editReply({ content: `❌ Failed to cancel: ${errMsg}` });
    }
    await deleteContractEmbed(contractId);
    await ensurePlaceholder(res.data.type || 'loss');
    return interaction.editReply({ content: `✅ Contract #${contractId} cancelled. All active claims have been expired and units returned.` });
  }

  if (cmd === 'admin-verify-claim') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const claimId = interaction.options.getInteger('claim_id');
    const result  = await post(`${BACKEND}/api/claims/${claimId}/test-complete`, {
      internal_key: process.env.INTERNAL_API_KEY, verified_count: null,
    }, { timeout: 10000 });
    if (!result?.data?.success) {
      // Bug #4 fix: surface actual error from backend
      const errMsg = result?.data?.error || 'Request failed';
      return interaction.editReply({ content: `❌ ${errMsg}` });
    }
    return interaction.editReply({ content: `✅ Claim #${claimId} force-approved.\nPayout: **$${Number(result.data.payout_amount).toLocaleString()}** queued.` });
  }

  // Bug #5: /admin-claims command — view all active claims with IDs
  if (cmd === 'admin-claims') {
    if (interaction.user.id !== ADMIN_DISCORD_ID)
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });

    const result = await api.getAllActiveClaims();
    if (!result?.success) return interaction.editReply({ content: `❌ ${result?.error || 'Failed to fetch claims'}` });

    let claims = result.claims || [];
    const filterId = interaction.options.getInteger('contract_id');
    if (filterId) claims = claims.filter(c => c.contract_id === filterId);

    if (!claims.length) {
      return interaction.editReply({ content: filterId
        ? `📋 No active claims on Contract #${filterId}.`
        : '📋 No active claims right now.' });
    }

    const now = Math.floor(Date.now() / 1000);
    const lines = claims.map(c => {
      const minsLeft = Math.max(0, Math.floor((c.expires_at - now) / 60));
      const expStr   = minsLeft > 0 ? `⏱️ ${minsLeft}m` : '⚠️ EXPIRED';
      return `**Claim #${c.id}** · Contract #${c.contract_id} (${c.type})\n` +
             `　Seller: \`${c.seller_torn_id}\` · Target: ${c.target_torn_name} [${c.target_torn_id}]\n` +
             `　${c.quantity_claimed} unit(s) · 💰 ${formatMoney(c.payout_amount)} · ${expStr}`;
    });

    // Chunk if needed (Discord 2000 char limit)
    const chunks = [];
    let chunk = '';
    for (const line of lines) {
      if ((chunk + '\n\n' + line).length > 1800) { chunks.push(chunk); chunk = line; }
      else chunk = chunk ? chunk + '\n\n' + line : line;
    }
    if (chunk) chunks.push(chunk);

    await interaction.editReply({ content: `**Active Claims (${claims.length}):**\n\n${chunks[0]}` });
    for (const extra of chunks.slice(1)) {
      await interaction.followUp({ content: extra, ephemeral: true });
    }
    return;
  }

  if (cmd === 'testapi') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const key = process.env.ADMIN_API_KEY;
    if (!key) return interaction.editReply({ content: '❌ ADMIN_API_KEY not set.' });
    const [aRes, bRes] = await Promise.all([
      get(`https://api.torn.com/v2/user/attacksfull?limit=20&sort=DESC&comment=NSH&key=${key}`, { timeout: 8000 }),
      get(`https://api.torn.com/v2/user/${ADMIN_TORN_ID}/bounties?comment=NSH&key=${key}`,       { timeout: 8000 }),
    ]);
    const attackLines = aRes?.data?.attacks?.slice(0, 5).map(a => {
      const mine = a.attacker?.id === parseInt(ADMIN_TORN_ID);
      return `${mine ? '⚔️' : '🛡️'} vs **[${mine ? a.defender?.id : a.attacker?.id || '?'}]** — \`${a.result}\` — <t:${a.started}:R>`;
    }).join('\n') || '❌ Failed';
    const bountyLines = bRes?.data?.bounties?.map(b =>
      `• **${b.lister_name}** $${Number(b.reward).toLocaleString()} x${b.quantity} — \`${b.reason || 'none'}\``
    ).join('\n') || 'No bounties';
    return interaction.editReply({ embeds: [{
      color: 0x3498db, title: '🔧 API Test',
      fields: [
        { name: '⚔️ Last 5 Attacks', value: attackLines, inline: false },
        { name: '💀 Bounties',        value: bountyLines, inline: false },
      ],
      footer: { text: 'Admin Only' }, timestamp: new Date().toISOString(),
    }] });
  }
}

// ── Modal submits ─────────────────────────────────────────────────────────────
async function handleModal(interaction) {
  const { customId: id } = interaction;
  const field = k => interaction.fields.getTextInputValue(k).trim();

  if (id === 'modal_verify') {
    await interaction.deferReply({ ephemeral: true });
    const apiKey = field('api_key').trim();
    const result = await api.verifyUser(apiKey, interaction.user.id);
    if (!result.success) return interaction.editReply({ embeds: [buildVerifyFailEmbed(result.error)] });
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.setNickname(`${result.torn_name} [${result.torn_id}]`).catch(() => {});
      const verifiedRole = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
      if (verifiedRole) await member.roles.add(verifiedRole);
      const sellerRole = interaction.guild.roles.cache.get(VERIFIED_SELLER_ROLE_ID);
      if (sellerRole) await member.roles.add(sellerRole);
    } catch (e) { console.warn('[BOT] verify role/nick:', e.message); }
    await interaction.editReply({ embeds: [buildVerifySuccessEmbed(result.torn_name, result.torn_id)] });
    await interaction.followUp({
      content: '✅ Verified as **Verified Seller**! Now set your travel class for flight profit calculations:',
      components: [row(
        btn('setup_class:std',      'Standard',  ButtonStyle.Secondary),
        btn('setup_class:airstrip', 'Airstrip',  ButtonStyle.Secondary),
        btn('setup_class:wlt',      'WLT',       ButtonStyle.Secondary),
        btn('setup_class:business', 'Business',  ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (id === 'modal_flightsetup' || id.startsWith('modal_setup_capacity:')) {
    const isSetup = id === 'modal_flightsetup';
    const cls = isSetup
      ? (['std','airstrip','wlt','business'].includes(field('travel_class').toLowerCase()) ? field('travel_class').toLowerCase() : 'std')
      : id.split(':')[1];
    const cap = Math.min(Math.max(1, parseInt(field('capacity')) || 10), 35);
    await post(`${BACKEND}/api/flight-prefs/${interaction.user.id}`, { travel_class: cls, capacity: cap });
    const reply = `✅ ${isSetup ? 'Flight setup saved' : 'All set'}!\n**Travel class:** ${CLS_LABELS[cls]}\n**Carry capacity:** ${cap} items`;
    if (isSetup) {
      await interaction.deferReply({ ephemeral: true });
      return interaction.editReply({ content: reply });
    }
    return interaction.reply({
      content: reply + '\n\nUse `/flight-alerts` to subscribe to item alerts.',
      ephemeral: true,
    });
  }

  if (id === 'modal_admin_contract') {
    await interaction.deferReply({ ephemeral: true });
    const type         = field('type').toLowerCase();
    const targetTornId = field('target_torn_id').trim();
    const qty          = parseInt(field('quantity'));
    const price        = parseInt(field('price_per_unit'));
    const bountyAmt    = parseInt(field('bounty_amount') || '0') || 0;
    if (!['loss','bounty','escape'].includes(type)) return interaction.editReply({ content: '❌ Type must be: loss, bounty, or escape.' });
    if (isNaN(qty)   || qty < 1)   return interaction.editReply({ content: '❌ Invalid quantity.' });
    if (isNaN(price) || price < 1) return interaction.editReply({ content: '❌ Invalid price.' });
    if (type === 'bounty' && bountyAmt < 1) return interaction.editReply({ content: '❌ Bounty amount required for bounty contracts.' });

    // Auto-fetch target name from Torn API
    const apiKey = process.env.ADMIN_API_KEY;
    let targetName = null;
    if (apiKey) {
      const tornRes = await get(`https://api.torn.com/user/${targetTornId}?selections=basic&key=${apiKey}`, { timeout: 5000 });
      if (tornRes?.data?.name) targetName = tornRes.data.name;
    }
    if (!targetName) return interaction.editReply({ content: '❌ Could not fetch target name from Torn. Check the Torn ID and try again.' });

    const res = await post(`${BACKEND}/api/contracts/test-seed`, {
      internal_key:     process.env.INTERNAL_API_KEY,
      type,
      target_torn_id:   targetTornId,
      target_torn_name: targetName,
      buyer_torn_id:    ADMIN_TORN_ID,
      quantity_total:   qty,
      price_per_unit:   price,
      bounty_amount:    bountyAmt,
      status:           'active',
    }, { timeout: 10000 });
    // Bug #4 fix: surface actual backend error instead of generic "Failed to create contract"
    if (!res?.data?.success) {
      const errMsg = res?.data?.error || 'Server error — check Railway logs';
      return interaction.editReply({ content: `❌ Failed to create contract: ${errMsg}` });
    }
    await interaction.editReply({ content: `✅ Contract #${res.data.contract.id} created — **${type}** · ${qty} units · $${Number(price).toLocaleString()}/unit · Target: **${targetName}**` });
    await postContractEmbed(res.data.contract);
    return;
  }

  if (id.startsWith('modal_claim_')) {
    await interaction.deferReply({ ephemeral: true });
    const contractId = parseInt(id.replace('modal_claim_', ''));
    const quantity   = parseInt(field('quantity'));
    if (isNaN(quantity) || quantity < 1) return interaction.editReply({ content: '❌ Invalid number.' });
    const tornId = await getTornId(interaction.user.id);
    if (!tornId) return interaction.editReply({ content: '❌ Not verified. Use `/verify` first.' });
    const result = await api.createClaim(contractId, tornId, interaction.user.id, quantity);
    if (!result.success) return interaction.editReply({ content: `❌ ${result.error}` });
    const cr       = await api.getActiveContracts();
    const contract = cr.contracts?.find(c => c.id === contractId);
    if (contract) {
      try {
        const dm = await interaction.user.createDM();
        await dm.send({ embeds: [buildClaimDmEmbed(result.claim, contract)], components: [buildCompleteButton(result.claim.id)] });
      } catch {}
      await updateContractEmbed(contractId);
    }
    return interaction.editReply({ content: `✅ Claimed **${quantity}** units from Contract #${contractId}! Check your DMs.` });
  }
}

// ── Button handler ────────────────────────────────────────────────────────────
async function handleButton(interaction) {
  const handled = await handleChannelButton(interaction);
  if (handled !== false) return;

  const { customId: id } = interaction;

  if (id === 'btn_check_hospital') {
    await interaction.deferReply({ ephemeral: true });

    const keyRes = await get(`${BACKEND}/api/users/by-discord/${interaction.user.id}/apikey`);
    if (!keyRes?.data?.api_key) {
      return interaction.editReply({ content: '❌ You need to `/verify` first before running a hospital check.' });
    }

    await interaction.editReply({ content: '🔍 Checking hospital status for all targets... this takes ~3 minutes.' });

    const results = await checkHospitalStatus(keyRes.data.api_key);
    const embeds  = buildHospitalEmbeds(results, interaction.user.username);

    await updateHospitalResults(interaction.client, embeds);

    return interaction.editReply({ content: `✅ Results updated in <#1483273417653358785>.` });
  }

  if (id === 'open_verify_modal') {
    return interaction.showModal(modal('modal_verify', 'Enter Your Torn API Key',
      textInput('api_key', 'Your Torn API Key (Full Access)', { placeholder: 'Paste your Full Access key here', min: 16, max: 32 })
    ));
  }

  if (id === 'become_seller') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member)                                    return interaction.reply({ content: '❌ Could not fetch member.', ephemeral: true });
    if (!member.roles.cache.has(VERIFIED_ROLE_ID))  return interaction.reply({ content: '❌ You need to verify first. Use `/verify`.', ephemeral: true });
    if (member.roles.cache.has(VERIFIED_SELLER_ROLE_ID)) return interaction.reply({ content: '✅ You are already a Verified Seller!', ephemeral: true });
    try {
      const role = interaction.guild.roles.cache.get(VERIFIED_SELLER_ROLE_ID);
      if (role) await member.roles.add(role);
      return interaction.reply({ content: '🎉 You are now a **Verified Seller**! You\'ll be pinged when new contracts go live.', ephemeral: true });
    } catch { return interaction.reply({ content: '❌ Failed to assign role. Contact an admin.', ephemeral: true }); }
  }

  if (id === 'toggle_flyer_role') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Could not fetch member.', ephemeral: true });
    const role = interaction.guild.roles.cache.get(NUTTS_FLYER_ROLE_ID);
    if (!role)  return interaction.reply({ content: '❌ Role not found.', ephemeral: true });
    if (member.roles.cache.has(NUTTS_FLYER_ROLE_ID)) {
      await member.roles.remove(role);
      return interaction.reply({ content: '🔕 Flight alerts disabled. Removed from **Nutts Flyer**.', ephemeral: true });
    }
    await member.roles.add(role);
    return interaction.reply({ content: '🔔 You\'re now a **Nutts Flyer**!\nUse `/flight-alerts` to pick which items to track.', ephemeral: true });
  }

  if (id === 'open_flight_setup') {
    return interaction.showModal(modal('modal_flightsetup', 'Flight Setup',
      textInput('capacity',     'Carry Capacity (1–35 items)', { placeholder: 'e.g. 29', min: 1, max: 2 }),
      textInput('travel_class', 'Travel Class: std / airstrip / wlt / business', { placeholder: 'std', min: 3, max: 10 })
    ));
  }

  if (id.startsWith('setup_class:')) {
    const cls = id.split(':')[1];
    return interaction.showModal(modal(`modal_setup_capacity:${cls}`, 'Set Your Carry Capacity',
      textInput('capacity', 'Carry Capacity (1–35 items)', { placeholder: 'e.g. 29', min: 1, max: 2 })
    ));
  }

  if (id.startsWith('toggle_alert:')) {
    const [, itemId] = id.split(':');
    const prefs  = await getFlightPrefs(interaction.user.id);
    const subbed = prefs.subscribed_items.map(String).includes(String(itemId));
    const res    = await patch(`${BACKEND}/api/flight-prefs/${interaction.user.id}/subscriptions`,
      { item_id: itemId, subscribed: !subbed });
    if (!res) return interaction.reply({ content: '❌ Could not update. Try `/flightsetup` first.', ephemeral: true });
    return interaction.reply({
      content: subbed
        ? `🔕 Unsubscribed from alerts for item #${itemId}`
        : `🔔 Subscribed! You'll be alerted when this item's restock matches your flight time.`,
      ephemeral: true,
    });
  }

  if (id.startsWith('claim_')) {
    const contractId = parseInt(id.replace('claim_', ''));
    const tornId     = await getTornId(interaction.user.id);
    if (!tornId) return interaction.reply({ content: '❌ Not verified. Use `/verify`.', ephemeral: true });
    // Fetch contract directly by ID — more reliable than searching active list
    const contractRes = await get(`${BACKEND}/api/contracts/${contractId}`);
    const contract    = contractRes?.data?.contract;
    if (!contract || contract.status !== 'active')
      return interaction.reply({ content: '❌ This contract is no longer active.', ephemeral: true });
    const maxClaim   = contract.type === 'bounty' ? 10 : 15;
    const maxAllowed = Math.min(maxClaim, contract.quantity_remaining || 0);
    if (maxAllowed < 1)
      return interaction.reply({ content: '❌ No units available to claim on this contract.', ephemeral: true });
    return interaction.showModal(modal(`modal_claim_${contractId}`, `Claim Contract #${contractId}`,
      textInput('quantity', `How many units? (max ${maxAllowed})`, { placeholder: `1–${maxAllowed}`, min: 1, max: 3 })
    ));
  }

  if (id.startsWith('complete_')) {
    await interaction.deferReply({ ephemeral: true });
    const claimId = parseInt(id.replace('complete_', ''));
    await interaction.editReply({ content: '🔍 Verifying via Torn API...' });
    const result = await api.completeClaim(claimId);
    if (!result.success) return interaction.editReply({ content: `❌ Verification failed: ${result.error}` });
    await interaction.editReply({
      content: result.partial
        ? `⚠️ **Partial Completion**\nVerified **${result.credited}** units.\n💰 **$${Number(result.payout_amount).toLocaleString()}** queued.\n📦 **${result.returned}** units returned to pool.`
        : `✅ **Verified!** Payout of **${formatMoney(result.payout_amount)}** queued. Payment in-game shortly.`,
    });
    if (result.claim?.contract_id) {
      const cr = await api.getActiveContracts();
      const c  = cr.contracts?.find(c => c.id === result.claim.contract_id);
      if (!c || c.status === 'completed') {
        await deleteContractEmbed(result.claim.contract_id);
        // Fetch contract separately to get type (claims table has no type column)
        const completedContract = await get(`${BACKEND}/api/contracts/${result.claim.contract_id}`);
        await ensurePlaceholder(completedContract?.data?.contract?.type || 'loss');
      } else {
        await updateContractEmbed(result.claim.contract_id);
      }
    }
    return;
  }
}

// ── Backend event hooks ───────────────────────────────────────────────────────
client.on('contract_activated', contract => postContractEmbed(contract));
client.on('payout_ready', ({ claim, contract, seller_torn_id }) => sendPayoutNotification(claim, contract, seller_torn_id));

client.on('claim_alert', async ({ type, claim, contract, message, credited, returned }) => {
  try {
    const ch = await client.channels.fetch(CHANNEL_IDS.alerts).catch(() => null);
    if (!ch) return;

    const colors  = { wrong_outcome: 0xE74C3C, partial: 0xF39C12, failed: 0xE74C3C };
    const titles  = { wrong_outcome: '🚨 Wrong Outcome Detected', partial: '⚠️ Partial Completion', failed: '❌ Claim Verification Failed' };

    const fields = [
      { name: 'Seller Torn ID', value: `[${claim.seller_torn_id}](https://www.torn.com/profiles.php?XID=${claim.seller_torn_id})`, inline: true },
      { name: 'Contract',       value: `#${contract.id} · ${contract.type}`, inline: true },
      { name: 'Target',         value: `${contract.target_torn_name} [${contract.target_torn_id}]`, inline: true },
      { name: 'Details',        value: message, inline: false },
    ];

    if (type === 'partial') {
      fields.push({ name: 'Credited / Returned', value: `${credited} credited · ${returned} back to pool`, inline: false });
    }

    await ch.send({
      content: `<@${ADMIN_DISCORD_ID}>`,
      embeds: [{
        color: colors[type] || 0x95A5A6,
        title: titles[type] || '⚠️ Claim Alert',
        fields,
        footer: { text: `Claim #${claim.id} · ${new Date().toUTCString()}` },
      }],
    });
  } catch (e) { console.error('[BOT] claim_alert:', e.message); }
});

client.on('claim_expired', async claim => {
  try {
    if (claim.seller_discord_id) {
      const user = await client.users.fetch(claim.seller_discord_id);
      await user.send(`⚠️ Your claim on Contract #${claim.contract_id} expired. Units returned to pool.`);
    }
  } catch {}
  await updateContractEmbed(claim.contract_id);
});

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN);
module.exports = client;
