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
  buildVerifySuccessEmbed,
  buildVerifyFailEmbed,
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

// Track live contract message IDs for updating embeds
// { contractId: { channelId, messageId } }
const contractMessages = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ]
});

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  await refreshAllContractEmbeds();
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

  // ── /verify ──
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

  // ── /myclaims ──
  else if (commandName === 'myclaims') {
    await interaction.deferReply({ ephemeral: true });

    // Look up torn_id from discord_id
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

    await interaction.editReply({
      content: `**Your Active Claims:**\n${lines.join('\n')}`
    });
  }

  // ── /contracts ──
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

  // ── /markpaid (admin only) ──
  else if (commandName === 'markpaid') {
    if (interaction.user.id !== ADMIN_DISCORD_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const payoutId = interaction.options.getInteger('payout_id');
    const result = await api.markPayoutSent(payoutId);

    if (result.success) {
      await interaction.editReply({ content: `✅ Payout #${payoutId} marked as sent.` });
    } else {
      await interaction.editReply({ content: `❌ ${result.error}` });
    }
  }

  // ── /cancelclaim ──
  else if (commandName === 'cancelclaim') {
    await interaction.deferReply({ ephemeral: true });
    const claimId = interaction.options.getInteger('claim_id');

    // For now just inform — full cancel logic can be added
    await interaction.editReply({
      content: `⚠️ To cancel claim #${claimId}, please contact an admin in #support.\nNote: Repeated cancellations may result in removal from the marketplace.`
    });
  }
}

// ── Modal Submit Handler ───────────────────────────────────────────────────────
async function handleModalSubmit(interaction) {

  // ── Verify modal ──
  if (interaction.customId === 'modal_verify') {
    await interaction.deferReply({ ephemeral: true });

    const apiKey = interaction.fields.getTextInputValue('api_key').trim();
    const result = await api.verifyUser(apiKey, interaction.user.id);

    if (!result.success) {
      return interaction.editReply({
        embeds: [buildVerifyFailEmbed(result.error)]
      });
    }

    // Rename Discord nickname to TornName [TornID]
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.setNickname(`${result.torn_name} [${result.torn_id}]`);
    } catch (e) {
      console.warn('[BOT] Could not set nickname (may lack permission):', e.message);
    }

    // Assign Verified Seller role
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const role = interaction.guild.roles.cache.find(r => r.name === 'Verified Seller');
      if (role) await member.roles.add(role);
    } catch (e) {
      console.warn('[BOT] Could not assign role:', e.message);
    }

    await interaction.editReply({
      embeds: [buildVerifySuccessEmbed(result.torn_name, result.torn_id)]
    });
  }

  // ── Claim quantity modal ──
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

    // Fetch contract details for the DM
    const contractResult = await api.getActiveContracts();
    const contract = contractResult.contracts?.find(c => c.id === contractId);

    if (contract) {
      // Send DM with instructions + complete button
      try {
        const dmChannel = await interaction.user.createDM();
        await dmChannel.send({
          embeds: [buildClaimDmEmbed(claim, contract)],
          components: [buildCompleteButton(claim.id)]
        });
      } catch (e) {
        console.warn('[BOT] Could not DM user:', e.message);
      }

      // Update the contract embed in channel
      await updateContractEmbed(contractId);
    }

    await interaction.editReply({
      content: `✅ Claimed **${quantity}** unit(s) from Contract #${contractId}!\nCheck your DMs for instructions.`
    });
  }
}

// ── Button Handler ─────────────────────────────────────────────────────────────
async function handleButton(interaction) {

  // ── Claim button on contract embed ──
  if (interaction.customId.startsWith('claim_')) {
    const contractId = parseInt(interaction.customId.replace('claim_', ''));

    // Check if user is verified
    const tornId = await getTornIdFromDiscord(interaction.user.id);
    if (!tornId) {
      return interaction.reply({
        content: '❌ You must be verified to claim. Use `/verify` in #verify-here.',
        ephemeral: true
      });
    }

    // Get contract info for max claim limit
    const contractResult = await api.getActiveContracts();
    const contract = contractResult.contracts?.find(c => c.id === contractId);
    const maxClaim = contract ? (contract.type === 'bounty' ? 10 : 15) : 15;
    const available = contract?.quantity_remaining || 0;
    const maxAllowed = Math.min(maxClaim, available);

    // Show quantity modal
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

  // ── "Click when completed" button in DMs ──
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

    await interaction.editReply({
      content: `✅ **Verified!** Your payout of **${formatMoney(result.payout_amount)}** has been queued.\nYou will receive payment in-game from Nuttzar shortly.`
    });

    // Update the contract embed
    if (result.claim?.contract_id) {
      await updateContractEmbed(result.claim.contract_id);
    }
  }
}

// ── Contract Embed Management ──────────────────────────────────────────────────

// Post or update a contract embed in its channel
async function postContractEmbed(contract) {
  const channelId = CHANNEL_IDS[contract.type];
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const embed = buildContractEmbed(contract);
  const buttons = buildContractButtons(contract);

  if (contractMessages.has(contract.id)) {
    // Update existing message
    const { messageId } = contractMessages.get(contract.id);
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed], components: [buttons] });
      return;
    } catch {
      // Message was deleted — fall through to post new
    }
  }

  // Post new message
  const msg = await channel.send({ embeds: [embed], components: [buttons] });
  contractMessages.set(contract.id, { channelId, messageId: msg.id });
}

// Update a contract's embed after a claim/completion
async function updateContractEmbed(contractId) {
  try {
    const result = await api.getActiveContracts();
    const contract = result.contracts?.find(c => c.id === contractId);
    if (contract) await postContractEmbed(contract);
  } catch (err) {
    console.error('[BOT] Failed to update contract embed:', err.message);
  }
}

// On startup, refresh all active contract embeds
async function refreshAllContractEmbeds() {
  try {
    const result = await api.getActiveContracts();
    if (!result.success) return;

    for (const contract of result.contracts) {
      await postContractEmbed(contract);
    }
    console.log(`[BOT] Refreshed ${result.contracts.length} contract embed(s)`);
  } catch (err) {
    console.error('[BOT] Failed to refresh embeds:', err.message);
  }
}

// ── Payout notification ───────────────────────────────────────────────────────
async function sendPayoutNotification(claim, contract, sellerName) {
  try {
    const channel = await client.channels.fetch(CHANNEL_IDS.payout);
    if (!channel) return;

    const embed = buildPayoutEmbed(claim, contract, sellerName);
    await channel.send({
      content: `<@${ADMIN_DISCORD_ID}> 💰 **New payout required!**`,
      embeds: [embed]
    });
  } catch (err) {
    console.error('[BOT] Failed to send payout notification:', err.message);
  }
}

// ── Helper: get Torn ID from Discord ID via DB ─────────────────────────────────
async function getTornIdFromDiscord(discordId) {
  try {
    // Use a direct DB lookup via backend
    const result = await require('axios').get(
      `${process.env.BACKEND_URL}/api/users/by-discord/${discordId}`
    );
    return result.data?.torn_id || null;
  } catch {
    return null;
  }
}

// ── Backend event listener (when backend emits events) ────────────────────────
// These are called from the backend when running in the same process
// When running separately, use webhooks or polling instead
client.on('contract_activated', async (contract) => {
  await postContractEmbed(contract);
});

client.on('payout_ready', async ({ claim, contract, seller_torn_id }) => {
  // Look up seller name from DB
  const sellerName = `Seller [${seller_torn_id}]`;
  await sendPayoutNotification(claim, contract, sellerName);
});

client.on('claim_expired', async (claim) => {
  // Optionally DM seller to let them know
  try {
    if (claim.seller_discord_id) {
      const user = await client.users.fetch(claim.seller_discord_id);
      await user.send(`⚠️ Your claim on Contract #${claim.contract_id} has **expired** (30 min window passed). The units have been released back to the contract.`);
    }
  } catch {}

  await updateContractEmbed(claim.contract_id);
});

// ── Login ──────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN);

module.exports = client;
