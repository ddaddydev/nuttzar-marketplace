require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('verify').setDescription('Link your Torn account to get access'),
  new SlashCommandBuilder().setName('flightsetup').setDescription('Set your travel class and carry capacity'),
  new SlashCommandBuilder().setName('flight-alerts').setDescription('Subscribe to flight alerts for specific items'),
  new SlashCommandBuilder().setName('myclaims').setDescription('View your active claims'),
  new SlashCommandBuilder().setName('contracts').setDescription('View active contracts')
    .addStringOption(o => o.setName('type').setDescription('Filter by type').setRequired(false)
      .addChoices(
        { name: 'Loss',   value: 'loss'   },
        { name: 'Bounty', value: 'bounty' },
        { name: 'Escape', value: 'escape' },
      )),
  new SlashCommandBuilder().setName('bal').setDescription('Check your Nuttzar earnings and pending payouts'),
  new SlashCommandBuilder().setName('cancelclaim').setDescription('Request cancellation of a claim')
    .addIntegerOption(o => o.setName('claim_id').setDescription('Claim ID').setRequired(true)),
  new SlashCommandBuilder().setName('markpaid').setDescription('[Admin] Mark a payout as sent')
    .addIntegerOption(o => o.setName('payout_id').setDescription('Payout ID').setRequired(true)),
  new SlashCommandBuilder().setName('admin-contract').setDescription('[Admin] Manually create a contract'),
  new SlashCommandBuilder().setName('admin-verify-claim').setDescription('[Admin] Force-approve a claim')
    .addIntegerOption(o => o.setName('claim_id').setDescription('Claim ID to approve').setRequired(true)),
  new SlashCommandBuilder().setName('testapi').setDescription('[Admin] Test Torn API connectivity'),
  new SlashCommandBuilder().setName('bestarrival').setDescription('Get best items for a specific flight time')
    .addIntegerOption(o => o.setName('minutes').setDescription('Your flight time in minutes').setRequired(true)
      .setMinValue(1).setMaxValue(300)),
  new SlashCommandBuilder().setName('xanax').setDescription('Get Xanax stock status across all countries sent to your DMs'),
  new SlashCommandBuilder().setName('admin-cancel-contract').setDescription('[Admin] Cancel a contract and expire all active claims')
    .addIntegerOption(o => o.setName('contract_id').setDescription('Contract ID to cancel').setRequired(true)),
  // Bug #5: Added admin-claims command for viewing active claims with IDs
  new SlashCommandBuilder().setName('admin-claims').setDescription('[Admin] View all active claims with IDs')
    .addIntegerOption(o => o.setName('contract_id')
      .setDescription('Filter by contract ID (optional)')
      .setRequired(false)),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} commands...`);
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log('✅ All commands deployed');
  } catch (e) {
    console.error('❌ Deploy failed:', e);
  }
})();
