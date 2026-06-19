const { Events } = require('discord.js');
const db = require('../db/database');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    // Register slash commands automatically to the guild
    try {
      const { REST, Routes } = require('discord.js');
      const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
      
      const commands = client.commands.map(cmd => cmd.data.toJSON());
      
      if (process.env.GUILD_ID) {
        console.log(`Started refreshing ${commands.length} application (/) commands for guild ${process.env.GUILD_ID}.`);
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
          { body: commands }
        );
        console.log('Successfully reloaded guild (/) commands. Command is now visible to everyone.');
      }
    } catch (error) {
      console.error('Error registering commands:', error);
    }

    // Ghost channel cleanup
    try {
      const contentsToCheck = db.prepare("SELECT * FROM contents WHERE deleteVcWhenEmpty = 1 OR status = 'ACTIVE'").all();
      for (const row of contentsToCheck) {
        try {
          const channel = await client.channels.fetch(row.voiceChannelId).catch(() => null);
          if (channel) {
            if (channel.members.size === 0) {
              await channel.delete().catch(() => null);
              db.prepare("UPDATE contents SET deleteVcWhenEmpty = 0, status = 'COMPLETED' WHERE contentId = ?").run(row.contentId);
              console.log(`Deleted empty abandoned channel on startup: ${row.voiceChannelId}`);
            }
          } else {
            // Channel already deleted from discord manually
            db.prepare("UPDATE contents SET deleteVcWhenEmpty = 0, status = 'COMPLETED' WHERE contentId = ?").run(row.contentId);
          }
        } catch (e) { }
      }
    } catch (e) {
      console.error('Ghost channel cleanup failed:', e);
    }
  },
};
