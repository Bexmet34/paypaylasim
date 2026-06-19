const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ganksplit')
    .setDescription('Yeni bir Gank loot paylaşımlı content başlatır.'),
  
  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('start_gank_modal')
      .setTitle('Yeni Gank Başlat');

    const limitInput = new TextInputBuilder()
      .setCustomId('gank_limit')
      .setLabel('Katılımcı Sayısı (Limit)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Örn: 7');

    const firstActionRow = new ActionRowBuilder().addComponents(limitInput);

    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  },
};
