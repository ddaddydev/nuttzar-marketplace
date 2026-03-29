// bot/embeds.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const TYPE_COLORS = { loss: 0xE74C3C, bounty: 0xF39C12, escape: 0x9B59B6 };
const TYPE_EMOJI  = { loss: '⚔️', bounty: '💀', escape: '🏃' };

function formatMoney(amount) {
  return `$${Number(amount).toLocaleString()}`;
}

function typeLabel(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ── Contract embed (shown in channel) ────────────────────────────────────────
function buildContractEmbed(contract) {
  const emoji = TYPE_EMOJI[contract.type];
  const total     = contract.quantity;
  const completed = contract.quantity_completed;
  const remaining = contract.quantity_remaining;
  const claimed   = total - remaining - completed;

  const embed = new EmbedBuilder()
    .setColor(TYPE_COLORS[contract.type])
    .setTitle(`${emoji}  CONTRACT #${contract.id} — ${typeLabel(contract.type).toUpperCase()}`)
    .setTimestamp(new Date(contract.created_at * 1000))
    .setFooter({ text: 'Nuttzar Marketplace · marketplace.nuttzar.website' });

  if (contract.target_torn_name && contract.target_torn_id) {
    embed.addFields({ name: 'Target', value: `[${contract.target_torn_name} [${contract.target_torn_id}]](https://www.torn.com/profiles.php?XID=${contract.target_torn_id})`, inline: true });
  }

  embed.addFields({
    name:  contract.type === 'loss' ? 'Per Loss' : contract.type === 'escape' ? 'Per Escape' : 'Per Bounty Slot',
    value: formatMoney(contract.price_per_unit), inline: true,
  });

  // Bounty: show the bounty amount prominently so admin can fast-check
  if (contract.type === 'bounty') {
    embed.addFields({
      name: '💰 Required Bounty Amount',
      value: `**${formatMoney(contract.bounty_amount)}**\n_Seller must place exactly this amount_`,
      inline: true,
    });
  }

  // Simple status line instead of progress bar
  const statusParts = [];
  if (completed > 0) statusParts.push(`✅ ${completed} done`);
  if (claimed > 0)   statusParts.push(`🔒 ${claimed} claimed`);
  if (remaining > 0) statusParts.push(`🟢 ${remaining} open`);
  const statusLine = statusParts.join('  •  ') || '—';

  embed.addFields(
    { name: `Units (${completed}/${total})`, value: statusLine, inline: false },
    { name: 'Status', value: remaining > 0 ? '🟢 **Open — accepting claims**' : '🔴 **Fully claimed**', inline: false },
  );

  return embed;
}

// ── Contract claim button ─────────────────────────────────────────────────────
function buildContractButtons(contract) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_${contract.id}`).setLabel('🎯  Claim Units')
      .setStyle(ButtonStyle.Primary).setDisabled(contract.quantity_remaining <= 0 || contract.status !== 'active')
  );
}

// ── Claim DM embed ────────────────────────────────────────────────────────────
function buildClaimDmEmbed(claim, contract) {
  const atkLink = `https://www.torn.com/loader.php?sid=attack&user2ID=${contract.target_torn_id}`;
  const btyLink = `https://www.torn.com/bounties.php?p=add&XID=${contract.target_torn_id}`;
  const instructions = {
    loss:   `Attack **[${contract.target_torn_name} [${contract.target_torn_id}]](${atkLink})** and **lose** the fight ${claim.quantity_claimed} time(s). Make sure attacks appear in your log.\n🔗 [Attack ${contract.target_torn_name}](${atkLink})`,
    escape: `The buyer will attack you. You must **escape** ${claim.quantity_claimed} time(s). Requires your DEX to exceed buyer's SPD.\n🔗 [Attack link for ${contract.target_torn_name}](${atkLink})`,
    bounty: `Place a bounty of **exactly ${formatMoney(contract.bounty_amount)}** on **${contract.target_torn_name} [${contract.target_torn_id}]** — ${claim.quantity_claimed} time(s).\n⚠️ The bounty amount must match exactly for verification.\n🔗 [Add Bounty on ${contract.target_torn_name}](${btyLink})`,
  };

  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle(`${TYPE_EMOJI[contract.type]}  Claim Confirmed — ${typeLabel(contract.type)} Contract #${contract.id}`)
    .setDescription('You have **30 minutes** to complete your claim. Click the button below once done.')
    .addFields(
      { name: 'Target',              value: `${contract.target_torn_name} [${contract.target_torn_id}]`, inline: true },
      { name: 'Units Claimed',       value: `${claim.quantity_claimed}`,                                 inline: true },
      { name: 'Your Payout',         value: formatMoney(claim.payout_amount),                            inline: true },
      ...(contract.type === 'bounty' ? [{ name: '💰 Bounty Amount', value: `**${formatMoney(contract.bounty_amount)}** each`, inline: true }] : []),
      { name: '⏱️ Expires',          value: `<t:${claim.expires_at}:R>`,                                 inline: false },
      { name: '📋 Instructions',     value: instructions[contract.type] || '',                            inline: false },
    )
    .setFooter({ text: `Claim ID: ${claim.id} · Nuttzar Marketplace` });
}

// ── Complete button ───────────────────────────────────────────────────────────
function buildCompleteButton(claimId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`complete_${claimId}`).setLabel('✅  Click when completed').setStyle(ButtonStyle.Success)
  );
}

// ── Payout embed (admin channel) ──────────────────────────────────────────────
function buildPayoutEmbed(claim, contract, sellerTornId, payoutId) {
  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle(`💰  PAYOUT REQUIRED — Contract #${contract.id}`)
    .addFields(
      { name: 'Seller',          value: `${sellerTornId} [${claim.seller_torn_id || sellerTornId}]`, inline: true },
      { name: 'Amount to Send',  value: `**${formatMoney(claim.payout_amount)}**`,                   inline: true },
      { name: 'Contract Type',   value: typeLabel(contract.type),                                    inline: true },
      { name: 'Units Completed', value: `${claim.quantity_claimed}`,                                 inline: true },
      { name: 'Payout ID',       value: `#${payoutId || '?'}`,                                       inline: true },
      { name: 'Target',          value: `${contract.target_torn_name} [${contract.target_torn_id}]`, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Use /markpaid <payout_id> once sent' });
}

// ── Balance embed ─────────────────────────────────────────────────────────────
function buildBalanceEmbed(tornName, tornId, data) {
  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle(`💰 Balance — ${tornName} [${tornId}]`)
    .addFields(
      { name: '⏳ Pending Payout',   value: formatMoney(data.pending_payout  || 0), inline: true },
      { name: '✅ Total Earned',      value: formatMoney(data.total_earned    || 0), inline: true },
      { name: '📋 Completed Claims', value: `${data.completed_claims || 0}`,         inline: true },
    )
    .setFooter({ text: 'Nuttzar Marketplace' })
    .setTimestamp();
}

// ── No contracts placeholder ──────────────────────────────────────────────────
function buildNoContractsEmbed(type) {
  const emoji = TYPE_EMOJI[type] || '📋';
  return new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle(`${emoji} No Active ${typeLabel(type)} Contracts`)
    .setDescription('There are no active contracts of this type right now.\n\nCheck back soon or visit **marketplace.nuttzar.website** to place an order.')
    .setFooter({ text: 'Nuttzar Marketplace' })
    .setTimestamp();
}

// ── Verify success / fail ─────────────────────────────────────────────────────
function buildVerifySuccessEmbed(tornName, tornId) {
  return new EmbedBuilder()
    .setColor(0x2ECC71).setTitle('✅  Verification Successful')
    .setDescription(`You are now verified as **${tornName} [${tornId}]**.\n\nYou can now claim contracts in the marketplace channels.`)
    .setFooter({ text: 'Nuttzar Marketplace' });
}

function buildVerifyFailEmbed(reason) {
  return new EmbedBuilder()
    .setColor(0xE74C3C).setTitle('❌  Verification Failed')
    .setDescription(`Could not verify your Torn API key.\n\n**Reason:** ${reason}`)
    .setFooter({ text: 'Nuttzar Marketplace' });
}

module.exports = {
  buildContractEmbed, buildContractButtons, buildClaimDmEmbed, buildCompleteButton,
  buildPayoutEmbed, buildBalanceEmbed, buildNoContractsEmbed,
  buildVerifySuccessEmbed, buildVerifyFailEmbed, formatMoney,
};
