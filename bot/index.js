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
const { fetchScoredItems, buildStockEmbed, buildAlertSelectionEmbed, buildAlertEmbed, FLIGHT_MINS } = require('./flightAlerts');
const { initChannels, handleChannelButton } = require('./channelManager');
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
  loss:      process.env.DISCORD_LOSS_CHANNEL,
  bounty:    process.env.DISCORD_BOUNTY_CHANNEL,
  escape:    process.env.DISCORD_ESCAPE_CHANNEL,
  payout:    process.env.DISCORD_PAYOUT_CHANNEL,
  alerts:    '1481475449182748797', // failed/partial/wrong-outcome claim alerts
  howToSell: '1481079970490220686',
  flight:    '1482148186138214494',
};

// ── State ─────────────────────────────────────────────────────────────────────
const contractMessages    = new Map();
const payoutMessages      = new Map();
const placeholderMessages = new Map();
const notifiedPayouts     = new Set();
const notifiedAlerts      = new Map(); // `${discordId}:${itemId}:${country}` -> ts

let flightEmbedMsgId = null;

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
const post  = (url, data, opts = {}) => axios.post(url, data,  { timeout: 5000, headers: _ikey(), ...opts }).catch(() => null);
const patch = (url, data, opts = {}) => axios.patch(url, data, { timeout: 5000, headers: _ikey(), ...opts }).catch(() => null);

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

// ── Flight intel embed ────────────────────────────────────────────────────────
async function refreshFlightEmbed() {
  try {
    const ch = await client.channels.fetch(CHANNEL_IDS.flight).catch(() => null);
    if (!ch) return;
    const { inStock, predicted, updatedAt } = await fetchScoredItems();
    const embed = buildStockEmbed(inStock, predicted, updatedAt);
    const btns  = row(
      btn('toggle_flyer_role', '🔔 Get Flight Alerts'),
      btn('open_flight_setup', '⚙️ Set Class & Capacity')
    );
    if (flightEmbedMsgId) {
      try {
        const msg = await ch.messages.fetch(flightEmbedMsgId);
        await msg.edit({ embeds: [embed], components: [btns] });
        return;
      } catch { flightEmbedMsgId = null; }
    }
    await purgeChannel(CHANNEL_IDS.flight);
    const msg = await ch.send({ embeds: [embed], components: [btns] });
    flightEmbedMsgId = msg.id;
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

        const flMins = FLIGHT_MINS[item.country]?.[cls] || FLIGHT_MINS[item.country]?.std || 120;
        const flMs   = flMins * 60000;
        let shouldAlert = false;

        if (item.inStock && item.depletionEtaMs) {
          const toEmpty = item.depletionEtaMs - now;
          shouldAlert = toEmpty > 0 && toEmpty <= flMs * 1.1;
        } else if (!item.inStock && item.restockEtaMs) {
          const toRestock = item.restockEtaMs - now;
          shouldAlert = toRestock >= 0 && toRestock <= flMs;
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
      const contract = await api.getActiveContracts()
        .then(r => r.contracts?.find(c => c.id === payout.contract_id)).catch(() => null);
      await sendPayoutNotification(
        { id: payout.claim_id, seller_torn_id: payout.seller_torn_id, payout_amount: payout.amount, quantity_claimed: '?' },
        contract || { id: payout.contract_id, type: payout.contract_type || 'loss', target_torn_name: 'Unknown', target_torn_id: '0' },
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
  await ch.send(`${role ? `<@&${role.id}> ` : ''}🆕 New **${lbl}** contract — $${Number(contract.price_per_unit).toLocaleString()}/unit`);
  const msg = await ch.send({ embeds: [embed], components: [buttons] });
  contractMessages.set(contract.id, { channelId, messageId: msg.id });
}

async function updateContractEmbed(contractId) {
  const result   = await api.getActiveContracts().catch(() => ({ contracts: [] }));
  const contract = result.contracts?.find(c => c.id === contractId);
  if (contract) await postContractEmbed(contract);
}

async function deleteContractEmbed(contractId) {
  if (!contractMessages.has(contractId)) return;
  try {
    const { channelId, messageId } = contractMessages.get(contractId);
    const ch  = await client.channels.fetch(channelId).catch(() => null);
    const msg = await ch?.messages.fetch(messageId).catch(() => null);
    if (msg) await msg.delete();
    contractMessages.delete(contractId);
  } catch (e) { console.error('[BOT] deleteContractEmbed:', e.message); }
}

async function ensurePlaceholder(type) {
  const channelId = CHANNEL_IDS[type];
  if (!channelId || placeholderMessages.has(type)) return;
  const ch     = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  const result = await api.getActiveContracts(type);
  if (result.success && result.contracts?.length) return;
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
  await initChannels(client);
  setInterval(pollPayouts,        30000);
  setInterval(refreshFlightEmbed, 5 * 60000);
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
    return interaction.editReply({
      content: `⚠️ To cancel claim #${interaction.options.getInteger('claim_id')}, contact an admin in #support.`,
    });
  }

  if (cmd === 'admin-contract') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return interaction.showModal(modal('modal_admin_contract', 'Create Contract (Admin)',
      textInput('type',            'Type: loss / bounty / escape',  { placeholder: 'loss' }),
      textInput('target_torn_id',  'Target Torn ID'),
      textInput('target_torn_name','Target Torn Name'),
      textInput('quantity',        'Total Units',                   { placeholder: '10' }),
      textInput('price_per_unit',  'Price Per Unit ($)',            { placeholder: '300000' })
    ));
  }

  if (cmd === 'admin-verify-claim') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const claimId = interaction.options.getInteger('claim_id');
    const result  = await post(`${BACKEND}/api/claims/${claimId}/test-complete`, {
      internal_key: process.env.INTERNAL_API_KEY, verified_count: null,
    }, { timeout: 10000 });
    if (!result) return interaction.editReply({ content: '❌ Request failed.' });
    return interaction.editReply({ content: `✅ Claim #${claimId} force-approved.\nPayout: **$${Number(result.data.payout_amount).toLocaleString()}** queued.` });
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
      // Also grant Verified Seller automatically
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
    const type  = field('type').toLowerCase();
    const qty   = parseInt(field('quantity'));
    const price = parseInt(field('price_per_unit'));
    if (!['loss','bounty','escape'].includes(type)) return interaction.editReply({ content: '❌ Type must be: loss, bounty, or escape.' });
    if (isNaN(qty)   || qty < 1)   return interaction.editReply({ content: '❌ Invalid quantity.' });
    if (isNaN(price) || price < 1) return interaction.editReply({ content: '❌ Invalid price.' });
    const res = await post(`${BACKEND}/api/contracts/test-seed`, {
      internal_key: process.env.INTERNAL_API_KEY,
      type, target_torn_id: field('target_torn_id'), target_torn_name: field('target_torn_name'),
      buyer_torn_id: ADMIN_TORN_ID, quantity_total: qty, price_per_unit: price, status: 'active',
    }, { timeout: 10000 });
    if (!res) return interaction.editReply({ content: '❌ Failed to create contract.' });
    await interaction.editReply({ content: `✅ Contract #${res.data.contract.id} created — **${type}** · ${qty} units · $${Number(price).toLocaleString()}/unit` });
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

    await interaction.editReply({ content: '🔍 Checking hospital status for all targets... takes about 3 minutes.' });

    const results = await checkHospitalStatus(keyRes.data.api_key);
    const embeds  = buildHospitalEmbeds(results, interaction.user.username);

    const ch = await interaction.client.channels.fetch(LEVEL_LIST_CHANNEL_ID).catch(() => null);
    if (!ch) return interaction.followUp({ content: '❌ Could not find the level list channel.', ephemeral: true });

    for (const embed of embeds) {
      await ch.send({ embeds: [embed] });
    }

    return interaction.followUp({ content: `✅ Results posted above.`, ephemeral: true });
  }

  if (id === 'open_verify_modal') {
    // Show modal immediately — Discord requires showModal() to be called synchronously
    // Already-verified check happens in the modal submit handler
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
    const cr         = await api.getActiveContracts();
    const contract   = cr.contracts?.find(c => c.id === contractId);
    const maxClaim   = contract?.type === 'bounty' ? 10 : 15;
    const maxAllowed = Math.min(maxClaim, contract?.quantity_remaining || 0);
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
        await ensurePlaceholder(result.claim.contract_type || 'loss');
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
