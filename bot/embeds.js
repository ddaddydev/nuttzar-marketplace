const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const TYPE_COLORS = {
  loss: 0xe74c3c,     // red
  bounty: 0xf39c12,   // orange
  escape: 0x9b59b6    // purple
};

const TYPE_EMOJI = {
  loss: '⚔️',
  bounty: '💀',
  escape: '🏃'
};

function formatMoney(amount) {
  return `$${Number(amount).toLocaleString()}`;
}

function timeRemaining(expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = expiresAt - now;
  if (remaining <= 0) return 'Expired';
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `${mins}m ${secs}s`;
}

// Main contract embed shown in channel
function buildContractEmbed(contract) {
  const emoji = TYPE_EMOJI[contract.type];
  const color = TYPE_COLORS[contract.type];
  const typeLabel = contract.type.charAt(0).toUpperCase() + contract.type.slice(1);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji}  CONTRACT #${contract.id} — ${typeLabel.toUpperCase()}`)
    .setTimestamp(new Date(contract.created_at * 1000))
    .setFooter({ text: 'Nuttzar Marketplace • marketplace.nuttzar.website' });

  // Target field
  if (contract.target_torn_name && contract.target_torn_id) {
    embed.addFields({
      name: 'Target',
      value: `${contract.target_torn_name} [${contract.target_torn_id}]`,
      inline: true
    });
  }

  // Per unit payout
  embed.addFields({
    name: contract.type === 'loss' ? 'Per Loss' :
          contract.type === 'escape' ? 'Per Escape' : 'Per Bounty Slot',
    value: formatMoney(contract.price_per_unit),
    inline: true
  });

  // Bounty extra info
  if (contract.type === 'bounty' && contract.bounty_amount > 0) {
    embed.addFields({
      name: 'Bounty Amount',
      value: formatMoney(contract.bounty_amount),
      inline: true
    });
  }

  // Progress bar
  const total = contract.quantity;
  const remaining = contract.quantity_remaining;
  const completed = contract.quantity_completed;
  const claimed = total - remaining - completed;

  const barLength = 20;
  const completedBars = Math.round((completed / total) * barLength);
  const claimedBars = Math.round((claimed / total) * barLength);
  const openBars = barLength - completedBars - claimedBars;

  const bar = '█'.repeat(completedBars) + '▒'.repeat(claimedBars) + '░'.repeat(openBars);

  embed.addFields({
    name: 'Progress',
    value: `\`${bar}\`\n✅ ${completed} done  •  🔒 ${claimed} claimed  •  🟢 ${remaining} open`,
    inline: false
  });

  // Status
  embed.addFields({
    name: 'Status',
    value: remaining > 0 ? '🟢 **Open — accepting claims**' : '🔴 **Fully claimed**',
    inline: false
  });

  return embed;
}

// Claim button row for contract embeds
function buildContractButtons(contract) {
  const canClaim = contract.quantity_remaining > 0 && contract.status === 'active';

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_${contract.id}`)
      .setLabel('🎯  Claim Units')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canClaim)
  );

  return row;
}

// DM embed sent to seller after claiming
function buildClaimDmEmbed(claim, contract) {
  const emoji = TYPE_EMOJI[contract.type];
  const typeLabel = contract.type.charAt(0).toUpperCase() + contract.type.slice(1);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${emoji}  Claim Confirmed — ${typeLabel} Contract #${contract.id}`)
    .setDescription('You have **30 minutes** to complete your claim. Once done, click the button below.')
    .addFields(
      {
        name: 'Target',
        value: `${contract.target_torn_name} [${contract.target_torn_id}]`,
        inline: true
      },
      {
        name: 'Units Claimed',
        value: `${claim.quantity_claimed}`,
        inline: true
      },
      {
        name: 'Your Payout',
        value: formatMoney(claim.payout_amount),
        inline: true
      },
      {
        name: '⏱️ Grace Period Expires',
        value: `<t:${claim.expires_at}:R>`,
        inline: false
      }
    );

  // Type-specific instructions
  if (contract.type === 'loss') {
    embed.addFields({
      name: '📋 Instructions',
      value: `Attack **${contract.target_torn_name} [${contract.target_torn_id}]** and **lose** the fight ${claim.quantity_claimed} time(s).\nMake sure the attack shows in your attack log.`,
      inline: false
    });
  } else if (contract.type === 'escape') {
    embed.addFields({
      name: '📋 Instructions',
      value: `The buyer will attack you. You must **escape** ${claim.quantity_claimed} time(s).\nRequires your DEX to exceed the buyer's SPD.`,
      inline: false
    });
  } else if (contract.type === 'bounty') {
    embed.addFields({
      name: '📋 Instructions',
      value: `Place a bounty on **${contract.target_torn_name} [${contract.target_torn_id}]** using your bounty slot(s) and fulfill ${claim.quantity_claimed} slot(s).`,
      inline: false
    });
  }

  embed.setFooter({ text: `Claim ID: ${claim.id} • Nuttzar Marketplace` });

  return embed;
}

// "Click when completed" button for DMs
function buildCompleteButton(claimId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`complete_${claimId}`)
      .setLabel('✅  Click when completed')
      .setStyle(ButtonStyle.Success)
  );
}

// Payout notification embed for admin channel
function buildPayoutEmbed(claim, contract, sellerName) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰  PAYOUT REQUIRED — Contract #${contract.id}`)
    .addFields(
      {
        name: 'Seller',
        value: `${sellerName} [${claim.seller_torn_id}]`,
        inline: true
      },
      {
        name: 'Amount to Send',
        value: `**${formatMoney(claim.payout_amount)}**`,
        inline: true
      },
      {
        name: 'Contract Type',
        value: contract.type.charAt(0).toUpperCase() + contract.type.slice(1),
        inline: true
      },
      {
        name: 'Units Completed',
        value: `${claim.quantity_claimed}`,
        inline: true
      },
      {
        name: 'Claim ID',
        value: `#${claim.id}`,
        inline: true
      },
      {
        name: 'Target',
        value: `${contract.target_torn_name} [${contract.target_torn_id}]`,
        inline: true
      }
    )
    .setTimestamp()
    .setFooter({ text: 'Use /markpaid <payout_id> once sent' });

  return embed;
}

// Verification success embed
function buildVerifySuccessEmbed(tornName, tornId) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅  Verification Successful')
    .setDescription(`You are now verified as **${tornName} [${tornId}]**.\n\nYou can now claim contracts in the marketplace channels.`)
    .setFooter({ text: 'Nuttzar Marketplace' });
}

// Verification failure embed
function buildVerifyFailEmbed(reason) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('❌  Verification Failed')
    .setDescription(`Could not verify your Torn API key.\n\n**Reason:** ${reason}\n\nMake sure your API key has **basic access** enabled.`)
    .setFooter({ text: 'Nuttzar Marketplace' });
}

module.exports = {
  buildContractEmbed,
  buildContractButtons,
  buildClaimDmEmbed,
  buildCompleteButton,
  buildPayoutEmbed,
  buildVerifySuccessEmbed,
  buildVerifyFailEmbed,
  formatMoney
};
