import 'dotenv/config';

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from 'discord.js';
import fs from 'fs';

const TOKEN = process.env.TOKEN;
const GUILD_ID = '1376633819884687501';
const PREFIX = '?';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

const invitesCache = new Map();

const configFile = './config.json';
function loadConfig() {
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, '{}');
  return JSON.parse(fs.readFileSync(configFile));
}
function saveConfig(data) {
  fs.writeFileSync(configFile, JSON.stringify(data, null, 2));
}

const inviteDataFile = './inviteData.json';
function loadInviteData() {
  if (!fs.existsSync(inviteDataFile)) fs.writeFileSync(inviteDataFile, '{}');
  return JSON.parse(fs.readFileSync(inviteDataFile));
}
function saveInviteData(data) {
  fs.writeFileSync(inviteDataFile, JSON.stringify(data, null, 2));
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  const guild = await client.guilds.fetch(GUILD_ID);
  const invites = await guild.invites.fetch();
  invitesCache.set(GUILD_ID, invites);

  await guild.commands.set([
    {
      name: 'invite-panel',
      description: 'Sends the invite checker panel',
    },
    {
      name: 'set-invite-channel',
      description: 'Set the channel where invite join messages are sent',
      options: [
        {
          name: 'channel',
          type: 7,
          description: 'Text channel for invite messages',
          required: true,
        },
      ],
    },
    {
      name: 'checkinvites',
      description: 'Check how many invites a user has (by user ID)',
      options: [
        {
          name: 'userid',
          description: 'The user ID to check invites for',
          type: 3, // STRING type
          required: true,
        },
      ],
    },
  ]);
  console.log('Slash commands registered.');
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'invite-panel') {
    const embed = new EmbedBuilder()
      .setTitle('📨 Invite Tracker')
      .setDescription("Click the button below to check how many people you've invited!")
      .setColor('Purple');

    const button = new ButtonBuilder()
      .setCustomId('check_invites')
      .setLabel('Check Invites')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);
    await message.channel.send({ embeds: [embed], components: [row] });
  }

  if (command === 'set-invite-channel') {
    const channelMention = args[0];
    if (!channelMention) return message.reply('Please specify a channel (mention or ID).');

    const channelId = channelMention.replace(/[<#>]/g, '');
    const channel = message.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return message.reply('Please provide a valid text channel.');

    const config = loadConfig();
    config.inviteMessageChannelId = channel.id;
    saveConfig(config);

    message.reply(`Invite join messages will now be sent in ${channel}.`);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId === 'check_invites') {
    const data = loadInviteData();
    data.invites = data.invites || {};
    const userInvites = data.invites[interaction.user.id] || 0;

    await interaction.reply({
      content: `You have invited **${userInvites}** user${userInvites === 1 ? '' : 's'}!`,
      ephemeral: true,
    });
  }

  if (interaction.isChatInputCommand()) {
    const command = interaction.commandName;

    if (command === 'invite-panel') {
      await interaction.deferReply();

      const embed = new EmbedBuilder()
        .setTitle('📨 Invite Tracker')
        .setDescription("Click the button below to check how many people you've invited!")
        .setColor('Purple');

      const button = new ButtonBuilder()
        .setCustomId('check_invites')
        .setLabel('Check Invites')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);
      await interaction.followUp({ embeds: [embed], components: [row] });
    }

    if (command === 'set-invite-channel') {
      const channel = interaction.options.getChannel('channel');
      if (!channel.isTextBased()) {
        return interaction.reply({ content: 'Please select a text channel!', ephemeral: true });
      }

      const config = loadConfig();
      config.inviteMessageChannelId = channel.id;
      saveConfig(config);

      return interaction.reply({ content: `Invite join messages will now be sent in ${channel}.`, ephemeral: true });
    }

    if (command === 'checkinvites') {
      const userId = interaction.options.getString('userid');
      const data = loadInviteData();
      data.invites = data.invites || {};

      const count = data.invites[userId] || 0;

      await interaction.reply({
        content: `<@${userId}> has **${count}** invite${count === 1 ? '' : 's'}.`,
        ephemeral: true,
      });
    }
  }
});

client.on(Events.GuildMemberAdd, async member => {
  try {
    const guildId = member.guild.id;
    const previousInvites = invitesCache.get(guildId);
    const currentInvites = await member.guild.invites.fetch();
    invitesCache.set(guildId, currentInvites);

    const usedInvite = currentInvites.find(inv => {
      const prevUses = previousInvites.get(inv.code)?.uses || 0;
      return inv.uses > prevUses;
    });

    if (!usedInvite || !usedInvite.inviter) return;

    const inviterId = usedInvite.inviter.id;
    const inviteData = loadInviteData();
    inviteData.invites = inviteData.invites || {};
    inviteData.invitedBy = inviteData.invitedBy || {};

    const previousInviter = inviteData.invitedBy[member.id];
    if (previousInviter && previousInviter !== inviterId) {
      inviteData.invites[previousInviter] = (inviteData.invites[previousInviter] || 1) - 1;
      if (inviteData.invites[previousInviter] < 0) inviteData.invites[previousInviter] = 0;
    }

    if (previousInviter !== inviterId) {
      inviteData.invites[inviterId] = (inviteData.invites[inviterId] || 0) + 1;
      inviteData.invitedBy[member.id] = inviterId;

      saveInviteData(inviteData);

      const config = loadConfig();
      let channel = member.guild.channels.cache.get(config.inviteMessageChannelId);
      if (!channel) {
        channel = member.guild.systemChannel || member.guild.channels.cache.find(c =>
          c.isTextBased() && c.permissionsFor(member.guild.members.me).has('SendMessages')
        );
      }

      if (channel) {
        channel.send(`👋 <@${member.id}> has been invited by **${usedInvite.inviter.tag}** and now has **${inviteData.invites[inviterId]} invites**!`);
      }
    }
  } catch (err) {
    console.error('Error handling guildMemberAdd:', err);
  }
});

client.on(Events.GuildMemberRemove, async member => {
  try {
    const inviteData = loadInviteData();
    inviteData.invites = inviteData.invites || {};
    inviteData.invitedBy = inviteData.invitedBy || {};

    const inviterId = inviteData.invitedBy[member.id];
    if (inviterId) {
      inviteData.invites[inviterId] = (inviteData.invites[inviterId] || 1) - 1;
      if (inviteData.invites[inviterId] < 0) inviteData.invites[inviterId] = 0;

      delete inviteData.invitedBy[member.id];
      saveInviteData(inviteData);
    }
  } catch (err) {
    console.error('Error handling guildMemberRemove:', err);
  }
});

client.login(TOKEN);

