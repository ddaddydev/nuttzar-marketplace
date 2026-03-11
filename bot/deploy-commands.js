require('dotenv').config({ path: '../backend/.env' });
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const commands = [
  {
    name: 'verify',
    description: 'Verify your Torn identity to become a seller',
  },
  {
    name: 'myclaims',
    description: 'View your current active claims (only visible to you)',
  },
  {
    name: 'contracts',
    description: 'View all active contracts (only visible to you)',
    options: [
      {
        name: 'type',
        description: 'Filter by contract type',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'Loss', value: 'loss' },
          { name: 'Bounty', value: 'bounty' },
          { name: 'Escape', value: 'escape' }
        ]
      }
    ]
  },
  {
    name: 'markpaid',
    description: '[ADMIN] Mark a payout as sent',
    options: [
      {
        name: 'payout_id',
        description: 'The payout ID to mark as sent',
        type: ApplicationCommandOptionType.Integer,
        required: true
      }
    ]
  },
  {
    name: 'cancelclaim',
    description: 'Cancel one of your active claims (releases units back)',
    options: [
      {
        name: 'claim_id',
        description: 'The claim ID to cancel',
        type: ApplicationCommandOptionType.Integer,
        required: true
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Deploying slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands }
    );
    console.log('✅ Slash commands deployed successfully!');
  } catch (err) {
    console.error('❌ Failed to deploy commands:', err);
  }
})();
