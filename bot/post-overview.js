// bot/post-overview.js
// Run once to post the NuttHub overview to the overview channel
// Usage: node post-overview.js

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const OVERVIEW_CHANNEL_ID = '1481080217425678407';

const embeds = [
  {
    color: 0x5865F2,
    title: '🛒 NuttHub Marketplace — What We Offer',
    description:
      'NuttHub is a player-run Torn City marketplace where you can buy and sell **attack contracts** — losses, escapes, and bounty kills — safely and with guaranteed payouts.\n\n' +
      'All contracts are listed publicly, payments go directly to **Brxxntt [4042794]** in-game, and sellers are paid out automatically once their work is verified on-chain.',
    fields: [
      {
        name: '📋 Contract Types',
        value:
          '**Loss** — Take a deliberate loss in a fight · Min $250k\n' +
          '**Escape** — Allow someone to escape from you · Min $350k\n' +
          '**Bounty** — Collect a specific bounty for a buyer · Min $50k',
        inline: false,
      },
      {
        name: '💸 Pricing',
        value:
          'A 10% service fee is built into the listed price — you always see the exact amount the seller receives.\n' +
          'Buyers pay slightly more to cover the fee. No hidden charges.',
        inline: false,
      },
    ],
    footer: { text: 'Use /verify to get started' },
  },
  {
    color: 0x2ECC71,
    title: '🤖 Bot Commands — What You Can Do',
    fields: [
      {
        name: '🔑 /verify',
        value: 'Link your Torn account to the server. Required before using any other commands. Your API key is stored encrypted and only used to confirm your identity.',
        inline: false,
      },
      {
        name: '📋 /contracts',
        value: 'Browse currently available contracts. Filter by type: Loss, Escape, or Bounty.',
        inline: false,
      },
      {
        name: '💰 /bal',
        value: 'Check your total earnings, pending payouts, and claim history on Nuttzar.',
        inline: false,
      },
      {
        name: '🗒️ /myclaims',
        value: 'See your currently active claims — what you\'ve committed to delivering and when they expire.',
        inline: false,
      },
      {
        name: '❌ /cancelclaim',
        value: 'Request to cancel an active claim if you can no longer fulfil it.',
        inline: false,
      },
      {
        name: '✈️ /flightsetup',
        value: 'Set your travel class and carry capacity so the bot can give you personalised flight intel.',
        inline: false,
      },
      {
        name: '🔔 /flight-alerts',
        value: 'Subscribe to DM alerts for specific foreign stock items. Get notified when something you want is in stock and you have time to fly.',
        inline: false,
      },
      {
        name: '🏥 /checkhospital',
        value: 'Runs a live check on all Baldr levelling targets using your API key and posts results here — showing who\'s in hospital and when they\'re out. Takes about 3 minutes.',
        inline: false,
      },
    ],
  },
  {
    color: 0xE67E22,
    title: '📡 Live Intel Channels',
    description: 'These channels update automatically 24/7 — no commands needed.',
    fields: [
      {
        name: '⚔️ Baldr Target List',
        value: 'Full list of Baldr levelling targets grouped by level, with direct attack links. Run `/checkhospital` to see who\'s currently hospitalised.',
        inline: false,
      },
      {
        name: '✈️ Flight Intel',
        value: 'Live foreign stock levels with Weav3r pricing and restock predictions. Items you can make it to in time are highlighted.',
        inline: false,
      },
      {
        name: '💀 NPC Loot Timers',
        value: 'Countdown timers for all major NPC loot windows. Toggle the **Loot Fighter** role to get pinged when a window opens.',
        inline: false,
      },
      {
        name: '🔍 Crimes Intel',
        value: 'Live readout of Search for Cash and Shoplifting success rates. Alerts when conditions hit the threshold. Toggle the **Crime** role to get pinged.',
        inline: false,
      },
      {
        name: '📅 Torn Calendar',
        value: 'Upcoming Torn events and competitions in TCT, updated automatically.',
        inline: false,
      },
      {
        name: '💵 Loss / Escape / Bounty / Payout Channels',
        value: 'Live contract listings and payout confirmations posted automatically as they happen.',
        inline: false,
      },
    ],
    footer: { text: 'NuttHub — Built for Brxxntt [4042794]' },
    timestamp: new Date().toISOString(),
  },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const ch = await client.channels.fetch(OVERVIEW_CHANNEL_ID);

    // Delete existing bot messages
    const fetched = await ch.messages.fetch({ limit: 50 });
    const botMsgs = [...fetched.filter(m => m.author.id === client.user.id).values()];
    for (const msg of botMsgs) await msg.delete().catch(() => {});

    // Post overview
    for (const embed of embeds) {
      await ch.send({ embeds: [embed] });
    }

    console.log('✅ Overview posted');
  } catch (e) {
    console.error('❌ Failed:', e.message);
  }
  client.destroy();
});

client.login(process.env.DISCORD_BOT_TOKEN);
