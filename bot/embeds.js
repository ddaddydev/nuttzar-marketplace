const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const TYPE_COLORS = {
  loss: 0xe74c3c,
  bounty: 0xf39c12,
  escape: 0x9b59b6
};

const TYPE_EMOJI = {
  loss: '⚔️',
  bounty: '💀',
  escape: '🏃'
};

function formatMoney(amount) {
  return `$${Number(amount).toLocaleString()}`;
}

function getAttackLink(targetTornId) {
  return `https://www.torn.com/loader.php?sid=attack&user2ID=${targetTornId}`;
}

function getBountyLink(targetTornId) {
  return `https://www.torn.com/bounties.php?p=add&XID=${targetTornId}`;
}

function buildNoContractsEmbed(type) {
  const emoji = TYPE_EMOJI[type];
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return new EmbedBuilder()
    .setColor(0x2c2f33)
    .setTitle(`${emoji}  ${typeLabel.toUpperCase()} CONTRACTS`)
    .setDescription(
      `> *The battlefield is quiet...*\n\n` +
      `No active **${typeLabel}** contracts right now.\n` +
      `Check back soon or visit the marketplace to post one.`
    )
    .setFooter({ text: 'Nuttzar Marketplace • marketplace.nuttzar.website' })
    .setTimestamp();
}

function buildContractEmbed(contract) {
  const emoji = TYPE_EMOJI[contract.type];
  const color = TYPE_COLORS[contract.type];
  const typeLabel = contract.type.charAt(0).toUpperCase() + contract.type.slice(1);
  const attackLink = getAttackLink(contract.target_torn_id);
  const bountyLink = getBountyLink(contract.target_torn_id);
  const actionLink = contract.type === 'bounty' ? bountyLink : attackLink;
  const actionLabel = contract.type === 'bounty' ? '💀 Add Bounty Here' : '⚔️ Attack Here';

  const total = contract.quantity;
  const remaining = contract.quantity_remaining;
  const completed = contract.quantity_completed;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji}  CONTRACT #${contract.id} — ${typeLabel.toUpperCase()}`)
    .setTimestamp(new Date(contract.created_at * 1000))
    .setFooter({ text: 'Nuttzar Marketplace • marketplace.nuttzar.website' });

  if (contract.target_torn_name && contract.target_torn_id) {
    embed.addFields({
      name: 'Target',
      value: `${contract.target_torn_name} [${contract.target_torn_id}]\n[${actionLabel}](${actionLink})`,
      inline: true
    });
  }

  embed.addFields({
    name: contract.type === 'loss' ? 'Per Loss' :
          contract.type === 'escape' ? 'Per Escape' : 'Per Bounty Slot',
    value: formatMoney(contract.price_per_unit),
    inline: true
  });

  if (contract.type === 'bounty' && contract.bounty_amount > 0) {
    embed.addFields({
      name: 'Bounty Amount',
      value: formatMoney(contract.bounty_amount),
      inline: true
    });
  }

  embed.addFields(
    {
      name: 'Units',
      value: `✅ ${completed} done  •  🟢 ${remaining} open  •  📦 ${total} total`,
      inline: false
    },
    {
      name: 'Status',
      value: remaining > 0 ? '🟢 **Open — accepting claims**' : '🔴 **Fully claimed**',
      inline: false
    }
  );

  return embed;
}

function buildContractButtons(contract) {
  const canClaim = contract.quantity_remaining > 0 && contract.status === 'active';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_${contract.id}`)
      .setLabel('🎯  Claim Units')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canClaim)
  );
}

function buildClaimDmEmbed(claim, contract) {
  const emoji = TYPE_EMOJI[contract.type];
  const typeLabel = contract.type.charAt(0).toUpperCase() + contract.type.slice(1);
  const attackLink = getAttackLink(contract.target_torn_id);
  const bountyLink = getBountyLink(contract.target_torn_id);
  const actionLink = contract.type === 'bounty' ? bountyLink : attackLink;
  const actionLabel = contract.type === 'bounty' ? '💀 Add Bounty Here' : '⚔️ Attack Here';

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${emoji}  Claim Confirmed — ${typeLabel} Contract #${contract.id}`)
    .setDescription('You have **30 minutes** to complete your claim. Once done, click the button below.')
    .addFields(
      {
        name: 'Target',
        value: `${contract.target_torn_name} [${contract.target_torn_id}]\n[${actionLabel}](${actionLink})`,
        inline: true
      },
      { name: 'Units Claimed', value: `${claim.quantity_claimed}`, inline: true },
      { name: 'Your Payout', value: formatMoney(claim.payout_amount), inline: true },
      { name: '⏱️ Expires', value: `<t:${claim.expires_at}:R>`, inline: false }
    );

  if (contract.type === 'loss') {
    embed.addFields({
      name: '📋 Instructions',
      value: `Attack **${contract.target_torn_name} [${contract.target_torn_id}]** and **lose** ${claim.quantity_claimed} time(s).\n[⚔️ Click here to attack](${attackLink})\nMake sure the attack shows in your attack log.`,
      inline: false
    });
  } else if (contract.type === 'escape') {
    embed.addFields({
      name: '📋 Instructions',
      value: `The buyer will attack you. **Escape** ${claim.quantity_claimed} time(s).\nRequires your DEX to exceed the buyer's SPD.`,
      inline: false
    });
  } else if (contract.type === 'bounty') {
    embed.addFields({
      name: '📋 Instructions',
      value: `Place a bounty on **${contract.target_torn_name} [${contract.target_torn_id}]** and fulfill ${claim.quantity_claimed} slot(s).\n[💀 Add Bounty Here](${bountyLink})\n⚠️ NSH bounties are flagged automatically.`,
      inline: false
    });
  }

  embed.setFooter({ text: `Claim ID: ${claim.id} • Nuttzar Marketplace` });
  return embed;
}

function buildCompleteButton(claimId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`complete_${claimId}`)
      .setLabel('✅  Click when completed')
      .setStyle(ButtonStyle.Success)
  );
}

function buildPayoutEmbed(claim, contract, sellerName) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰  PAYOUT REQUIRED — Contract #${contract.id}`)
    .addFields(
      { name: 'Seller', value: `${sellerName} [${claim.seller_torn_id}]`, inline: true },
      { name: 'Amount to Send', value: `**${formatMoney(claim.payout_amount)}**`, inline: true },
      { name: 'Contract Type', value: contract.type.charAt(0).toUpperCase() + contract.type.slice(1), inline: true },
      { name: 'Units Completed', value: `${claim.quantity_claimed}`, inline: true },
      { name: 'Claim ID', value: `#${claim.id}`, inline: true },
      { name: 'Target', value: `${contract.target_torn_name} [${contract.target_torn_id}]`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'Use /markpaid <payout_id> once sent' });
}

function buildBalanceEmbed(tornName, tornId, balance) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`💰  Balance — ${tornName} [${tornId}]`)
    .addFields(
      {
        name: '⏳ Pending Payout',
        value: `**${formatMoney(balance.pending_payout)}**\n*Earned but not yet sent*`,
        inline: true
      },
      {
        name: '✅ Total Paid Out',
        value: `**${formatMoney(balance.lifetime_earned)}**\n*Already received*`,
        inline: true
      },
      {
        name: '📊 Net Earnings',
        value: `**${formatMoney(balance.total_net)}**\n*Lifetime total*`,
        inline: false
      },
      {
        name: '🎯 Completed Claims',
        value: `${balance.completed_claims}`,
        inline: true
      }
    )
    .setFooter({ text: 'Nuttzar Marketplace • marketplace.nuttzar.website' })
    .setTimestamp();
}

function buildVerifySuccessEmbed(tornName, tornId) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅  Verification Successful')
    .setDescription(`You are now verified as **${tornName} [${tornId}]**.\n\nYou can now claim contracts in the marketplace channels.`)
    .setFooter({ text: 'Nuttzar Marketplace' });
}

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
  buildBalanceEmbed,
  buildVerifySuccessEmbed,
  buildVerifyFailEmbed,
  buildNoContractsEmbed,
  formatMoney
};
