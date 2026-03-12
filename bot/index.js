require('dotenv').config({ path: '../backend/.env' });

const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  InteractionType,
  Events
} = require('discord.js');

const api = require('./apiClient');
const {
  buildContractEmbed,
  buildContractButtons,
  buildClaimDmEmbed,
  buildCompleteButton,
  buildPayoutEmbed,
  buildBalanceEmbed,
  buildVerifySuccessEmbed,
  buildVerifyFailEmbed,
  buildNoContractsEmbed,
  formatMoney
} = require('./embeds');

const ADMIN_TORN_ID = '4042794';
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || '';

const CHANNEL_IDS = {
  loss: process.env.DISCORD_LOSS_CHANNEL,
  bounty: process.env.DISCORD_BOUNTY_CHANNEL,
  escape: process.env.DISCORD_ESCAPE_CHANNEL,
  payout: process.env.DISCORD_PAYOUT_CHANNEL
};

// Track live contract message IDs: { contractId: { channelId, messageId } }
const contractMessages = new Map();

// Track payout message IDs so we can delete them after markpaid: { payoutId: messageId }
const payoutMessages = new Map();

// Track "no active contracts" placeholder message IDs per type: { type: messageId }
const placeholderMessages = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ]
});

// ── Purge all bot messages from a channel on startup ──────────────────────────
async function purgeOldBotMessages(channelId) {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    // Fetch up to 100 recent messages
    const messages = await channel.messages.fetch({ limit: 100 });
    const botMessages = messages.filter(m => m.author.id === client.user.id);

    if (botMessages.size === 0) return;

    // Bulk delete if messages are under 14 days old, otherwise delete individually
    const bulkable = botMessages.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    const old = botMessages.filter(m => Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000);

    if (bulkable.size > 1) await channel.bulkDelete(bulkable).catch(() => {});
    else if (bulkable.size === 1) await bulkable.first().delete().catch(() => {});

    for (const msg of old.values()) await msg.delete().catch(() => {});

    console.log(`[BOT] Purged ${botMessages.size} old message(s) from channel ${channelId}`);
  } catch (err) {
    console.warn(`[BOT] Could not purge channel ${channelId}:`, err.message);
  }
}

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  // Purge old bot messages from all channels on redeploy
  console.log('[BOT] Purging old messages...');
  await Promise.all([
    purgeOldBotMessages(CHANNEL_IDS.loss),
    purgeOldBotMessages(CHANNEL_IDS.bounty),
    purgeOldBotMessages(CHANNEL_IDS.escape),
    purgeOldBotMessages(CHANNEL_IDS.payout)
  ]);

  await refreshAllContractEmbeds();
  setInterval(pollPayouts, 30000);
  console.log('[BOT] Payout poller started');
});

// ── Slash Commands ─────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.type === InteractionType.ModalSubmit) {
      await handleModalSubmit(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (err) {
    console.error('[BOT] Interaction error:', err);
    const msg = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ── Slash Command Handler ──────────────────────────────────────────────────────
async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

  if (commandName === 'verify') {
    const modal = new ModalBuilder()
      .setCustomId('modal_verify')
      .setTitle('Verify Your Torn Identity');

    const apiKeyInput = new TextInputBuilder()
      .setCustomId('api_key')
      .setLabel('Your Torn API Key')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Paste your Torn API key here')
      .setRequired(true)
      .setMinLength(16)
      .setMaxLength(32);

    modal.addComponents(new ActionRowBuilder().addComponents(apiKeyInput));
    await interaction.showModal(modal);
  }

  else if (commandName === 'myclaims') {
    await interaction.deferReply({ ephemeral: true });

    const tornId = await getTornIdFromDiscord(interaction.user.id);
    if (!tornId) {
      return interaction.editReply({ content: '❌ You are not verified. Use `/verify` first.' });
    }

    const result = await api.getActiveClaims(tornId);
    if (!result.success || result.claims.length === 0) {
      return interaction.editReply({ content: '📋 You have no active claims right now.' });
    }

    const lines = result.claims.map(c => {
      const remaining = c.expires_at - Math.floor(Date.now() / 1000);
      const mins = Math.max(0, Math.floor(remaining / 60));
      return `• **Contract #${c.contract_id}** (${c.type}) — ${c.quantity_claimed} unit(s) — ⏱️ ${mins}m left — Payout: **${formatMoney(c.payout_amount)}**`;
    });

    await interaction.editReply({ content: `**Your Active Claims:**\n${lines.join('\n')}` });
  }

  else if (commandName === 'contracts') {
    await interaction.deferReply({ ephemeral: true });
    const type = interaction.options.getString('type');
    const result = await api.getActiveContracts(type);

    if (!result.success || result.contracts.length === 0) {
      return interaction.editReply({ content: '📋 No active contracts found.' });
    }

    const embeds = result.contracts.slice(0, 10).map(c => buildContractEmbed(c));
    await interaction.editReply({ embeds });
  }

  else if (commandName === 'markpaid') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const payoutId = interaction.options.getInteger('payout_id');
    const result = await api.markPayoutSent(payoutId);

    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }

    await interaction.editReply({ content: `✅ Payout #${payoutId} marked as sent.` });

    // Delete the payout message from the payout channel
    if (payoutMessages.has(payoutId)) {
      try {
        const { channelId, messageId } = payoutMessages.get(payoutId);
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(messageId).catch(() => null);
          if (msg) await msg.delete();
        }
        payoutMessages.delete(payoutId);
      } catch (e) {
        console.warn('[BOT] Could not delete payout message:', e.message);
      }
    }

    // DM the seller — wrapped in its own try/catch so failure doesn't break markpaid
    try {
      const payout = result.payout;
      if (payout?.seller_torn_id) {
        const userRes = await require('axios').get(
          `${process.env.BACKEND_URL}/api/users/by-torn/${payout.seller_torn_id}`
        ).catch(() => null);
        const discordId = userRes?.data?.discord_id;
        if (discordId) {
          const user = await client.users.fetch(discordId).catch(() => null);
          if (user) {
            await user.send(
              `💰 **Payout Sent!**\n\nYour payout of **$${Number(payout.amount).toLocaleString()}** has been sent in-game from Nuttzar.\nCheck your Torn inbox!\n\n*Payout ID: #${payoutId}*`
            );
          }
        }
      }
    } catch (e) {
      console.warn('[BOT] Could not DM seller:', e.message);
    }
  }

  else if (commandName === 'bal') {
    await interaction.deferReply({ ephemeral: true });

    const tornId = await getTornIdFromDiscord(interaction.user.id);
    if (!tornId) {
      return interaction.editReply({ content: '❌ You are not verified. Use `/verify` first.' });
    }

    const userRes = await require('axios').get(
      `${process.env.BACKEND_URL}/api/users/by-discord/${interaction.user.id}`
    ).catch(() => null);

    const tornName = userRes?.data?.torn_name || `User [${tornId}]`;
    const result = await api.getBalance(tornId);

    if (!result.success) {
      return interaction.editReply({ content: `❌ Could not fetch balance: ${result.error}` });
    }

    await interaction.editReply({ embeds: [buildBalanceEmbed(tornName, tornId, result)] });
  }

  else if (commandName === 'testapi') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const adminApiKey = process.env.ADMIN_API_KEY;
      if (!adminApiKey) {
        return interaction.editReply({ content: '❌ `ADMIN_API_KEY` not set in environment variables.' });
      }

      const axios = require('axios');

      // v2 attacksfull
      const attackRes = await axios.get(
        `https://api.torn.com/v2/user/attacksfull?limit=20&sort=DESC&comment=NSH&key=${adminApiKey}`,
        { timeout: 8000 }
      ).catch(() => null);

      // v2 bounties on admin's torn ID
      const bountyRes = await axios.get(
        `https://api.torn.com/v2/user/${ADMIN_TORN_ID}/bounties?comment=NSH&key=${adminApiKey}`,
        { timeout: 8000 }
      ).catch(() => null);

      // Format attacks — v2: array, attacker.id / defender.id, started
      let attackLines = '❌ Failed to fetch';
      if (attackRes?.data?.attacks) {
        const attacks = attackRes.data.attacks.slice(0, 5);
        attackLines = attacks.length === 0
          ? 'No recent attacks found'
          : attacks.map(a => {
              const iAmAttacker = a.attacker?.id === parseInt(ADMIN_TORN_ID);
              const opponentId = iAmAttacker ? a.defender?.id : a.attacker?.id;
              const dir = iAmAttacker ? '⚔️' : '🛡️';
              return `${dir} vs **[${opponentId || 'Unknown'}]** — \`${a.result}\` — <t:${a.started}:R>`;
            }).join('\n');
      } else if (attackRes?.data?.error) {
        attackLines = `❌ API Error: ${attackRes.data.error.error}`;
      }

      // v2 bounties on admin's torn ID
      let bountyLines = '❌ Failed to fetch';
      if (bountyRes?.data) {
        if (bountyRes.data.error) {
          bountyLines = `❌ API Error: ${bountyRes.data.error.error}`;
        } else {
          const bounties = bountyRes.data.bounties || [];
          bountyLines = bounties.length === 0
            ? 'No active bounties on your account'
            : bounties.map(b =>
                `• **${b.lister_name}** placed $${Number(b.reward).toLocaleString()} x${b.quantity} — reason: \`${b.reason || 'none'}\``
              ).join('\n');
        }
      }

      await interaction.editReply({
        embeds: [{
          color: 0x3498db,
          title: '🔧 API Test Results',
          fields: [
            { name: '⚔️ Last 5 Attacks', value: attackLines, inline: false },
            { name: '💀 Last 5 Bounty Log Entries', value: bountyLines, inline: false }
          ],
          footer: { text: 'Nuttzar Marketplace • Admin Only' },
          timestamp: new Date().toISOString()
        }]
      });
    } catch (err) {
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }

  else if (commandName === 'cancelclaim') {
    await interaction.deferReply({ ephemeral: true });
    const claimId = interaction.options.getInteger('claim_id');
    await interaction.editReply({
      content: `⚠️ To cancel claim #${claimId}, please contact an admin in #support.\nNote: Repeated cancellations may result in removal from the marketplace.`
    });
  }
}

// ── Modal Submit Handler ───────────────────────────────────────────────────────
async function handleModalSubmit(interaction) {

  if (interaction.customId === 'modal_verify') {
    await interaction.deferReply({ ephemeral: true });

    const apiKey = interaction.fields.getTextInputValue('api_key').trim();
    const result = await api.verifyUser(apiKey, interaction.user.id);

    if (!result.success) {
      return interaction.editReply({ embeds: [buildVerifyFailEmbed(result.error)] });
    }

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.setNickname(`${result.torn_name} [${result.torn_id}]`);
    } catch (e) {
      console.warn('[BOT] Could not set nickname:', e.message);
    }

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const role = interaction.guild.roles.cache.find(r => r.name === 'Verified Seller');
      if (role) await member.roles.add(role);
    } catch (e) {
      console.warn('[BOT] Could not assign role:', e.message);
    }

    await interaction.editReply({ embeds: [buildVerifySuccessEmbed(result.torn_name, result.torn_id)] });
  }

  else if (interaction.customId.startsWith('modal_claim_')) {
    await interaction.deferReply({ ephemeral: true });

    const contractId = parseInt(interaction.customId.replace('modal_claim_', ''));
    const quantityRaw = interaction.fields.getTextInputValue('quantity').trim();
    const quantity = parseInt(quantityRaw);

    if (isNaN(quantity) || quantity < 1) {
      return interaction.editReply({ content: '❌ Please enter a valid number.' });
    }

    const tornId = await getTornIdFromDiscord(interaction.user.id);
    if (!tornId) {
      return interaction.editReply({ content: '❌ You are not verified. Use `/verify` first.' });
    }

    const result = await api.createClaim(contractId, tornId, interaction.user.id, quantity);

    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }

    const claim = result.claim;
    const contractResult = await api.getActiveContracts();
    const contract = contractResult.contracts?.find(c => c.id === contractId);

    if (contract) {
      try {
        const dmChannel = await interaction.user.createDM();
        await dmChannel.send({
          embeds: [buildClaimDmEmbed(claim, contract)],
          components: [buildCompleteButton(claim.id)]
        });
      } catch (e) {
        console.warn('[BOT] Could not DM user:', e.message);
      }

      await updateContractEmbed(contractId);
    }

    await interaction.editReply({
      content: `✅ Claimed **${quantity}** unit(s) from Contract #${contractId}!\nCheck your DMs for instructions.`
    });
  }
}

// ── Button Handler ─────────────────────────────────────────────────────────────
async function handleButton(interaction) {

  if (interaction.customId.startsWith('claim_')) {
    const contractId = parseInt(interaction.customId.replace('claim_', ''));

    const tornId = await getTornIdFromDiscord(interaction.user.id);
    if (!tornId) {
      return interaction.reply({
        content: '❌ You must be verified to claim. Use `/verify` in #verify-here.',
        ephemeral: true
      });
    }

    const contractResult = await api.getActiveContracts();
    const contract = contractResult.contracts?.find(c => c.id === contractId);
    const maxClaim = contract ? (contract.type === 'bounty' ? 10 : 15) : 15;
    const available = contract?.quantity_remaining || 0;
    const maxAllowed = Math.min(maxClaim, available);

    const modal = new ModalBuilder()
      .setCustomId(`modal_claim_${contractId}`)
      .setTitle(`Claim Contract #${contractId}`);

    const quantityInput = new TextInputBuilder()
      .setCustomId('quantity')
      .setLabel(`How many units? (max ${maxAllowed})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`Enter a number between 1 and ${maxAllowed}`)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);

    modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));
    await interaction.showModal(modal);
  }

  else if (interaction.customId.startsWith('complete_')) {
    await interaction.deferReply({ ephemeral: true });
    const claimId = parseInt(interaction.customId.replace('complete_', ''));

    await interaction.editReply({
      content: '🔍 Verifying your completion via Torn API... This may take a moment.'
    });

    const result = await api.completeClaim(claimId);

    if (!result.success) {
      return interaction.editReply({
        content: `❌ Verification failed: ${result.error}`
      });
    }

    if (result.partial) {
      await interaction.editReply({
        content: `⚠️ **Partial Completion**\n\nVerified **${result.credited}** out of your claimed units.\n💰 Partial payout of **$${Number(result.payout_amount).toLocaleString()}** has been queued.\n📦 **${result.returned}** unit(s) have been returned to the contract pool.`
      });
    } else {
      await interaction.editReply({
        content: `✅ **Verified!** Your payout of **${formatMoney(result.payout_amount)}** has been queued.\nYou will receive payment in-game from Nuttzar shortly.`
      });
    }

    if (result.claim?.contract_id) {
      // Check if contract is now fully completed — if so delete embed, show placeholder
      const contractResult = await api.getActiveContracts();
      const contract = contractResult.contracts?.find(c => c.id === result.claim.contract_id);

      if (!contract || contract.status === 'completed') {
        await deleteContractEmbed(result.claim.contract_id);
        await ensurePlaceholder(result.claim.contract_type || 'loss');
      } else {
        await updateContractEmbed(result.claim.contract_id);
      }
    }
  }
}

// ── Contract Embed Management ──────────────────────────────────────────────────

async function postContractEmbed(contract) {
  const channelId = CHANNEL_IDS[contract.type];
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  // Remove placeholder for this type if it exists
  await removePlaceholder(contract.type, channel);

  const embed = buildContractEmbed(contract);
  const buttons = buildContractButtons(contract);

  if (contractMessages.has(contract.id)) {
    const { messageId } = contractMessages.get(contract.id);
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed], components: [buttons] });
      return;
    } catch {
      // Message deleted — fall through to post new
    }
  }

  // Ping Verified Sellers role on new contract
  const verifiedRole = channel.guild.roles.cache.find(r => r.name === 'Verified Seller');
  const ping = verifiedRole ? `<@&${verifiedRole.id}> ` : '';
  const typeLabel = contract.type.charAt(0).toUpperCase() + contract.type.slice(1);
  const pingMsg = await channel.send(`${ping}🆕 New **${typeLabel}** contract is live — $${Number(contract.price_per_unit).toLocaleString()} per unit!`);

  const msg = await channel.send({ embeds: [embed], components: [buttons] });
  contractMessages.set(contract.id, { channelId, messageId: msg.id });
}

async function updateContractEmbed(contractId) {
  try {
    const result = await api.getActiveContracts();
    const contract = result.contracts?.find(c => c.id === contractId);
    if (contract) await postContractEmbed(contract);
  } catch (err) {
    console.error('[BOT] Failed to update contract embed:', err.message);
  }
}

async function deleteContractEmbed(contractId) {
  try {
    if (!contractMessages.has(contractId)) return;
    const { channelId, messageId } = contractMessages.get(contractId);
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (msg) await msg.delete();

    contractMessages.delete(contractId);
    console.log(`[BOT] Deleted embed for completed contract #${contractId}`);
  } catch (err) {
    console.error('[BOT] Failed to delete contract embed:', err.message);
  }
}

// Post a "no active contracts" placeholder for a type if no contracts exist
async function ensurePlaceholder(type) {
  const channelId = CHANNEL_IDS[type];
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  // Check if any active contracts of this type still exist
  const result = await api.getActiveContracts(type);
  const hasContracts = result.success && result.contracts.length > 0;
  if (hasContracts) return; // don't post placeholder if contracts still exist

  // Already have a placeholder? Skip
  if (placeholderMessages.has(type)) return;

  const msg = await channel.send({ embeds: [buildNoContractsEmbed(type)] });
  placeholderMessages.set(type, msg.id);
  console.log(`[BOT] Posted placeholder for ${type} channel`);
}

async function removePlaceholder(type, channel) {
  if (!placeholderMessages.has(type)) return;
  try {
    const msgId = placeholderMessages.get(type);
    const msg = await channel.messages.fetch(msgId).catch(() => null);
    if (msg) await msg.delete();
    placeholderMessages.delete(type);
    console.log(`[BOT] Removed placeholder for ${type} channel`);
  } catch (err) {
    console.warn('[BOT] Could not remove placeholder:', err.message);
    placeholderMessages.delete(type);
  }
}

// On startup: refresh all active embeds and post placeholders for empty channels
async function refreshAllContractEmbeds() {
  try {
    const result = await api.getActiveContracts();
    if (!result.success) return;

    for (const contract of result.contracts) {
      await postContractEmbed(contract);
    }
    console.log(`[BOT] Refreshed ${result.contracts.length} contract embed(s)`);

    // Post placeholders for any type with no active contracts
    for (const type of ['loss', 'bounty', 'escape']) {
      await ensurePlaceholder(type);
    }
  } catch (err) {
    console.error('[BOT] Failed to refresh embeds:', err.message);
  }
}

// ── Payout notification ────────────────────────────────────────────────────────
async function sendPayoutNotification(fakeClaim, fakeContract, sellerTornId, payoutId) {
  try {
    const channel = await client.channels.fetch(CHANNEL_IDS.payout);
    if (!channel) return;

    const embed = buildPayoutEmbed(fakeClaim, fakeContract, sellerTornId, payoutId);
    const msg = await channel.send({
      content: `<@${ADMIN_DISCORD_ID}> 💰 **New payout required! Use \`/markpaid ${payoutId}\` once sent.**`,
      embeds: [embed]
    });

    if (payoutId) payoutMessages.set(payoutId, { channelId: CHANNEL_IDS.payout, messageId: msg.id });
  } catch (err) {
    console.error('[BOT] Failed to send payout notification:', err.message);
  }
}

// ── Helper: get Torn ID from Discord ID ───────────────────────────────────────
async function getTornIdFromDiscord(discordId) {
  try {
    const result = await require('axios').get(
      `${process.env.BACKEND_URL}/api/users/by-discord/${discordId}`
    );
    return result.data?.torn_id || null;
  } catch {
    return null;
  }
}

// ── Backend event listeners ────────────────────────────────────────────────────
client.on('contract_activated', async (contract) => {
  await postContractEmbed(contract);
});

client.on('payout_ready', async ({ claim, contract, seller_torn_id }) => {
  const sellerName = `Seller [${seller_torn_id}]`;
  await sendPayoutNotification(claim, contract, sellerName);
});

client.on('claim_expired', async (claim) => {
  try {
    if (claim.seller_discord_id) {
      const user = await client.users.fetch(claim.seller_discord_id);
      await user.send(`⚠️ Your claim on Contract #${claim.contract_id} has **expired** (30 min window passed). The units have been released back to the contract.`);
    }
  } catch {}

  await updateContractEmbed(claim.contract_id);
});

// ── Payout Poller (runs every 30s, catches payouts backend can't emit directly) ─
const notifiedPayouts = new Set();

async function pollPayouts() {
  try {
    const result = await api.getPendingPayouts();
    if (!result.success || !result.payouts.length) return;

    for (const payout of result.payouts) {
      if (notifiedPayouts.has(payout.id)) continue;

      const contract = await api.getActiveContracts()
        .then(r => r.contracts?.find(c => c.id === payout.contract_id))
        .catch(() => null);

      const fakeClaim = {
        id: payout.claim_id,
        seller_torn_id: payout.seller_torn_id,
        payout_amount: payout.amount,
        quantity_claimed: '?'
      };

      const fakeContract = contract || {
        id: payout.contract_id,
        type: payout.contract_type || 'loss',
        target_torn_name: 'Unknown',
        target_torn_id: '0'
      };

      await sendPayoutNotification(fakeClaim, fakeContract, payout.seller_torn_id, payout.id);
      notifiedPayouts.add(payout.id);
    }
  } catch (err) {
    console.error('[BOT] Payout poll error:', err.message);
  }
}

// ── Login ──────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN);

module.exports = client;
