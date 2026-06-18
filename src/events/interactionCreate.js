const { Events, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/database');
const { calculateParticipantData, generateLeaderBoardEmbed, generateFinalLootEmbed } = require('../utils/calculator');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Bu komut çalıştırılırken bir hata oluştu!', flags: 64 });
        } else {
          await interaction.reply({ content: 'Bu komut çalıştırılırken bir hata oluştu!', flags: 64 });
        }
      }
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, client);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    }
  },
};

async function handleButton(interaction) {
  const { customId } = interaction;

  if (customId.startsWith('join_content_')) {
    const contentId = customId.replace('join_content_', '');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    if (!content) return interaction.reply({ content: 'Bu content artık aktif değil.', flags: 64 });

    // Check if already joined
    const existing = db.prepare('SELECT * FROM participants WHERE contentId = ? AND userId = ?').get(contentId, interaction.user.id);
    if (existing) {
      return interaction.reply({ content: 'Zaten bu partiye katıldınız!', flags: 64 });
    }

    db.prepare('INSERT INTO participants (contentId, userId, joinTime, isPaused, totalPausedTime, status) VALUES (?, ?, ?, ?, ?, ?)').run(contentId, interaction.user.id, 0, 0, 0, 'PENDING');

    const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
    updateSingleActiveEmbed(interaction.client, contentId);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const approveBtn = new ButtonBuilder()
      .setCustomId(`approve_join_${contentId}_${interaction.user.id}`)
      .setLabel('Onayla')
      .setStyle(ButtonStyle.Success);
    const rejectBtn = new ButtonBuilder()
      .setCustomId(`reject_join_${contentId}_${interaction.user.id}`)
      .setLabel('Reddet')
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

    await interaction.channel.send({ content: `<@${content.leaderId}>, <@${interaction.user.id}> partiye katılmak istiyor.`, components: [row] });

    return interaction.reply({ content: '⏳ Lidere katılma isteğiniz iletildi. **Onaylandıktan sonra** belirtilen ses kanalına bağlanırsanız süreniz işlemeye başlayacaktır.', flags: 64 });
  }

  if (customId.startsWith('approve_join_')) {
    const parts = customId.split('_');
    const userId = parts.pop();
    const contentId = parts.slice(2).join('_');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    
    if (!content) return interaction.message.delete().catch(()=>{});
    if (interaction.user.id !== content.leaderId) return interaction.reply({ content: 'Sadece parti lideri onaylayabilir.', flags: 64 });

    const p = db.prepare('SELECT * FROM participants WHERE contentId = ? AND userId = ?').get(contentId, userId);
    if (!p || p.status !== 'PENDING') return interaction.message.delete().catch(()=>{});

    try {
      const vc = interaction.guild.channels.cache.get(content.voiceChannelId);
      if (vc) {
        await vc.permissionOverwrites.edit(userId, { Connect: true });
      }
    } catch(e){}

    const member = await interaction.guild.members.fetch(userId).catch(()=>null);
    const inVc = member?.voice.channelId === content.voiceChannelId;
    const now = Date.now();
    const isPaused = inVc ? 0 : 1;
    const lastPauseStart = isPaused ? now : 0;

    db.prepare('UPDATE participants SET status = ?, joinTime = ?, isPaused = ?, lastPauseStart = ? WHERE contentId = ? AND userId = ?')
      .run('APPROVED', now, isPaused, lastPauseStart, contentId, userId);

    const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
    updateSingleActiveEmbed(interaction.client, contentId);

    await interaction.message.delete().catch(()=>{});
    return;
  }

  if (customId.startsWith('reject_join_')) {
    const parts = customId.split('_');
    const userId = parts.pop();
    const contentId = parts.slice(2).join('_');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    
    if (!content) return interaction.message.delete().catch(()=>{});
    if (interaction.user.id !== content.leaderId) return interaction.reply({ content: 'Sadece parti lideri reddedebilir.', flags: 64 });

    db.prepare('DELETE FROM participants WHERE contentId = ? AND userId = ? AND status = ?').run(contentId, userId, 'PENDING');

    const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
    updateSingleActiveEmbed(interaction.client, contentId);

    await interaction.message.delete().catch(()=>{});
    return;
  }

  if (customId.startsWith('toggle_pause_')) {
    const contentId = customId.replace('toggle_pause_', '');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    if (!content) return interaction.reply({ content: 'Bu content artık aktif değil.', flags: 64 });

    const p = db.prepare('SELECT * FROM participants WHERE contentId = ? AND userId = ?').get(contentId, interaction.user.id);
    if (!p) return interaction.reply({ content: 'Önce partiye katılmalısınız!', flags: 64 });

    const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
    const now = Date.now();
    if (p.isPaused) {
      const pauseDuration = now - p.lastPauseStart;
      const newTotal = (p.totalPausedTime || 0) + pauseDuration;
      db.prepare('UPDATE participants SET isPaused = 0, totalPausedTime = ? WHERE contentId = ? AND userId = ?').run(newTotal, contentId, interaction.user.id);
      updateSingleActiveEmbed(interaction.client, contentId);
      await interaction.reply({ content: '▶️ **Moladan döndünüz!** Süreniz tekrar işlemeye başladı.', flags: 64 });
      setTimeout(() => interaction.deleteReply().catch(console.error), 5000);
      return;
    } else {
      // Pause
      db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND userId = ?').run(now, contentId, interaction.user.id);
      updateSingleActiveEmbed(interaction.client, contentId);

      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const resumeBtn = new ButtonBuilder()
        .setCustomId(`resume_pause_${contentId}`)
        .setLabel('Devam Et')
        .setStyle(ButtonStyle.Success)
        .setEmoji('▶️');
      const row = new ActionRowBuilder().addComponents(resumeBtn);

      return interaction.reply({ content: '⏸️ **Molaya ayrıldınız!** Mola süreniz aktif sürenizden düşülecektir.\n\nGeri döndüğünüzde aşağıdaki butona tıklayarak sürenizi tekrar başlatabilirsiniz.', components: [row], flags: 64 });
    }
  }

  if (customId.startsWith('resume_pause_')) {
    const contentId = customId.replace('resume_pause_', '');
    const p = db.prepare('SELECT * FROM participants WHERE contentId = ? AND userId = ?').get(contentId, interaction.user.id);
    if (!p) return interaction.reply({ content: 'Önce partiye katılmalısınız!', flags: 64 });

    if (p.isPaused) {
      const now = Date.now();
      const pauseDuration = now - p.lastPauseStart;
      const newTotal = (p.totalPausedTime || 0) + pauseDuration;
      db.prepare('UPDATE participants SET isPaused = 0, totalPausedTime = ? WHERE contentId = ? AND userId = ?').run(newTotal, contentId, interaction.user.id);

      const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
      updateSingleActiveEmbed(interaction.client, contentId);

      await interaction.update({ content: '▶️ **Moladan döndünüz!** Süreniz tekrar işlemeye başladı.', components: [] });
      setTimeout(() => interaction.deleteReply().catch(console.error), 5000);
      return;
    } else {
      await interaction.update({ content: 'Zaten aktif durumdasınız.', components: [] });
      setTimeout(() => interaction.deleteReply().catch(console.error), 5000);
      return;
    }
  }

  if (customId.startsWith('start_timer_')) {
    const contentId = customId.replace('start_timer_', '');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    if (!content) return interaction.reply({ content: 'Bu content aktif değil.', flags: 64 });
    if (interaction.user.id !== content.leaderId) return interaction.reply({ content: 'Sadece lider süreyi başlatabilir!', flags: 64 });
    if (content.startTime > 0) return interaction.reply({ content: 'Süre zaten başlatılmış!', flags: 64 });

    const now = Date.now();
    db.prepare('UPDATE contents SET startTime = ? WHERE contentId = ?').run(now, contentId);
    
    // Reset all participants
    const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(contentId);
    for (const p of participants) {
      const lastPauseStart = p.isPaused ? now : 0;
      db.prepare('UPDATE participants SET joinTime = ?, totalPausedTime = 0, lastPauseStart = ? WHERE contentId = ? AND userId = ?')
        .run(now, lastPauseStart, contentId, p.userId);
    }

    // Remove the button from components
    const origMsg = await interaction.channel.messages.fetch(content.messageId).catch(() => null);
    if (origMsg) {
      const rows = origMsg.components.map(row => {
        return {
          type: 1,
          components: row.components.filter(c => !c.customId.startsWith('start_timer_'))
        };
      }).filter(row => row.components.length > 0);

      const { generateActiveEmbed } = require('../utils/embedUpdater');
      const updatedContent = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
      const embed = generateActiveEmbed(updatedContent);

      await origMsg.edit({ embeds: [embed], components: rows }).catch(()=>{});
    }

    return interaction.reply({ content: '⏱️ Süre başarıyla başlatıldı! Tüm oyuncuların sayacı sıfırdan başladı.', flags: 64 });
  }

  if (customId.startsWith('active_leader_panel_')) {
    const contentId = customId.replace('active_leader_panel_', '');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    if (!content) return interaction.reply({ content: 'Bu content aktif değil.', flags: 64 });

    if (interaction.user.id !== content.leaderId) {
      return interaction.reply({ content: 'Sadece content lideri paneli açabilir!', flags: 64 });
    }

    await renderLeaderBoard(interaction, contentId, true, true);
    return;
  }

  if (customId.startsWith('end_gank_')) {
    const contentId = customId.replace('end_gank_', '');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    if (!content) return interaction.reply({ content: 'Bu content artık aktif değil.', flags: 64 });

    if (content.leaderId !== interaction.user.id) {
      return interaction.reply({ content: 'Sadece parti lideri gankı bitirebilir.', flags: 64 });
    }

    let devName = 'Geliştirici';
    try {
      const devUser = await interaction.client.users.fetch('407234961582587916');
      if (devUser) devName = devUser.globalName || devUser.username;
    } catch (e) { }

    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

    const modal = new ModalBuilder()
      .setCustomId(`end_content_modal_${contentId}`)
      .setTitle('Loot Değerlerini Girin');

    const totalInput = new TextInputBuilder()
      .setCustomId('total_loot')
      .setLabel('Toplam Brüt Loot (Silver)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Örn: 15.5m veya 15500000')
      .setRequired(true);

    const repairInput = new TextInputBuilder()
      .setCustomId('repair_cost')
      .setLabel('Tamir (Regar) Masrafı (Silver)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Örn: 1.2m veya 1200000')
      .setRequired(true);

    const botShareInput = new TextInputBuilder()
      .setCustomId('bot_share')
      .setLabel(`Bot Payı (Opsiyonel - ${devName})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Zorunlu değil, boş bırakabilirsiniz')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(totalInput),
      new ActionRowBuilder().addComponents(repairInput),
      new ActionRowBuilder().addComponents(botShareInput)
    );

    await interaction.showModal(modal);
  }
}

async function handleModal(interaction, client) {
  if (interaction.customId === 'start_gank_modal') {
    await interaction.deferReply();
    const limitStr = interaction.fields.getTextInputValue('gank_limit');
    let limit = parseInt(limitStr.replace(/[^0-9]/g, '')) || 0;
    if (limit > 99) limit = 99; // Discord VC limit max 99

    const { v4: uuidv4 } = require('uuid');
    const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
    const contentId = uuidv4();
    const leaderId = interaction.user.id;
    const guild = interaction.guild;
    const categoryId = '1262579229976170546';

    try {
      // Sıralı kanal ismi bulma (Gank-1, Gank-2 vs)
      const existingGankVCs = guild.channels.cache
        .filter(c => c.parentId === categoryId && c.type === ChannelType.GuildVoice && c.name.startsWith('Gank-'))
        .map(c => {
          const match = c.name.match(/^Gank-(\d+)$/i);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(n => n > 0);

      let nextNum = 1;
      while (existingGankVCs.includes(nextNum)) {
        nextNum++;
      }

      const channelName = `Gank-${nextNum}`;
      const title = channelName;

      // Create a voice channel
      const voiceChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        userLimit: limit,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: ['Connect'],
            allow: ['ViewChannel']
          },
          {
            id: leaderId,
            allow: ['Connect', 'ViewChannel']
          }
        ]
      });

      // Save to DB
      const createTime = Date.now();
      db.prepare(`
        INSERT INTO contents (contentId, leaderId, voiceChannelId, status, startTime, endTime, totalLoot, repairCost, botShare, title, maxPlayers, deleteVcWhenEmpty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(contentId, leaderId, voiceChannel.id, 'ACTIVE', 0, null, 0, 0, 0, title, limit, 0);

      // Auto-insert leader as approved
      db.prepare(`
        INSERT INTO participants (contentId, userId, joinTime, leaveTime, isPaused, lastPauseStart, totalPausedTime, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(contentId, leaderId, createTime, null, 1, createTime, 0, 'APPROVED');

      // Create Embed and Buttons
      const { generateActiveEmbed } = require('../utils/embedUpdater');
      const tempContent = {
        contentId, leaderId, voiceChannelId: voiceChannel.id, status: 'ACTIVE', startTime, endTime: null, totalLoot: 0, repairCost: 0, title, maxPlayers: limit
      };
      const embed = generateActiveEmbed(tempContent);

      const joinBtn = new ButtonBuilder()
        .setCustomId(`join_content_${contentId}`)
        .setLabel('Partiye Katıl')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const pauseBtn = new ButtonBuilder()
        .setCustomId(`toggle_pause_${contentId}`)
        .setLabel('Mola / Devam')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏸️');

      const startTimerBtn = new ButtonBuilder()
        .setCustomId(`start_timer_${contentId}`)
        .setLabel('Süreyi Başlat')
        .setStyle(ButtonStyle.Success)
        .setEmoji('▶️');

      const leaderBtn = new ButtonBuilder()
        .setCustomId(`active_leader_panel_${contentId}`)
        .setLabel('👑 Lider Paneli')
        .setStyle(ButtonStyle.Primary);

      const endBtn = new ButtonBuilder()
        .setCustomId(`end_gank_${contentId}`)
        .setLabel('Gank\'ı Bitir')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🛑');

      const row = new ActionRowBuilder().addComponents(joinBtn, pauseBtn, startTimerBtn, leaderBtn, endBtn);

      const replyMsg = await interaction.editReply({ embeds: [embed], components: [row] });
      db.prepare('UPDATE contents SET messageId = ?, channelId = ? WHERE contentId = ?').run(replyMsg.id, interaction.channelId, contentId);

    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: 'Kanal oluşturulurken bir hata oluştu. Botun gerekli yetkilere (Kanalları Yönet) sahip olduğundan emin olun.' });
    }
    return;
  }

  if (interaction.customId.startsWith('end_content_modal_')) {
    const contentId = interaction.customId.replace('end_content_modal_', '');

    const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);

    if (interaction.user.id !== content.leaderId) {
      return interaction.reply({ content: 'Sadece lider contenti bitirebilir!', flags: 64 });
    }

    const totalLootStr = interaction.fields.getTextInputValue('total_loot');
    const repairCostStr = interaction.fields.getTextInputValue('repair_cost');
    let botShareStr = '';
    try {
      botShareStr = interaction.fields.getTextInputValue('bot_share');
    } catch (e) { }

    function parseSilver(input) {
      if (!input) return 0;
      let str = input.toLowerCase().trim().replace(/,/g, '.');
      let multiplier = 1;
      if (str.endsWith('m')) { multiplier = 1000000; str = str.slice(0, -1); }
      else if (str.endsWith('k')) { multiplier = 1000; str = str.slice(0, -1); }
      return Math.floor(parseFloat(str) * multiplier) || 0;
    }

    const totalLoot = parseSilver(totalLootStr);
    const repairCost = parseSilver(repairCostStr);
    const botShare = parseSilver(botShareStr);
    const endTime = Date.now();

    db.prepare('UPDATE contents SET totalLoot = ?, repairCost = ?, botShare = ?, endTime = ? WHERE contentId = ?')
      .run(totalLoot, repairCost, botShare, endTime, contentId);

    // Active mesaji kapat ve butonları sil
    try {
      const { EmbedBuilder } = require('discord.js');
      const origMsg = await interaction.channel.messages.fetch(content.messageId).catch(() => null);
      if (origMsg) {
        const oldEmbeds = origMsg.embeds;
        const newEmbed = EmbedBuilder.from(oldEmbeds[0]);
        newEmbed.setDescription('🛑 **BU CONTENT KAPANMIŞTIR** 🛑\n\n' + (newEmbed.data.description || ''));
        newEmbed.setColor('#FF0000');
        await origMsg.edit({ embeds: [newEmbed], components: [] }).catch(()=>{});
      }
    } catch(e) {}

    // Modal sonrasi islem
    db.prepare('UPDATE contents SET status = ?, deleteVcWhenEmpty = 1 WHERE contentId = ?').run('COMPLETED', contentId);
    
    // Herkesi durdur
    db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND isPaused = 0').run(endTime, contentId);

    const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(contentId);
    const finalContent = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
    const calcData = calculateParticipantData(finalContent, participants);
    const finalEmbed = generateFinalLootEmbed(finalContent, calcData);

    await interaction.channel.send({ embeds: [finalEmbed] }).catch(()=>{});
    await interaction.reply({ content: '✅ Gank başarıyla sonlandırıldı ve sonuçlar hesaplandı.', flags: 64 });
  }
}

async function handleSelectMenu(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('leader_pause_') || customId.startsWith('leader_kick_')) {
    const action = customId.startsWith('leader_pause_') ? 'pause' : 'kick';
    const contentId = customId.replace(`leader_${action}_`, '');

    const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
    if (interaction.user.id !== content.leaderId) {
      return interaction.reply({ content: 'Bunu yapmaya yetkiniz yok.', flags: 64 });
    }

    const targetUserId = interaction.values[0];
    if (targetUserId === 'none') {
      return interaction.deferUpdate();
    }

    if (action === 'kick') {
      db.prepare('DELETE FROM participants WHERE contentId = ? AND userId = ?').run(contentId, targetUserId);
    } else if (action === 'pause') {
      const p = db.prepare('SELECT * FROM participants WHERE contentId = ? AND userId = ?').get(contentId, targetUserId);
      if (p) {
        const now = Date.now();
        if (p.isPaused) {
          const pauseDuration = now - p.lastPauseStart;
          const newTotal = (p.totalPausedTime || 0) + pauseDuration;
          db.prepare('UPDATE participants SET isPaused = 0, totalPausedTime = ? WHERE contentId = ? AND userId = ?').run(newTotal, contentId, targetUserId);
        } else {
          db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND userId = ?').run(now, contentId, targetUserId);
        }
      }
    }

    await renderLeaderBoard(interaction, contentId, false, false);
  }
}

async function renderLeaderBoard(interaction, contentId, isFirstReply, isActivePanel) {
  const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
  const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(contentId);

  const calcData = calculateParticipantData(content, participants);
  const embed = generateLeaderBoardEmbed(content, calcData);

  if (isActivePanel) {
    embed.setTitle('👑 Lider Paneli (Aktif Yönetim)');
    embed.setDescription('Bekleyen istekleri onaylayabilir, aktif oyuncuları molaya alabilir veya listeden silebilirsiniz.');
  }

  const { StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  const rows = [];

  const activeParticipants = participants.filter(p => p.status !== 'PENDING');

  const pauseMenu = new StringSelectMenuBuilder()
    .setCustomId(`leader_pause_${contentId}`)
    .setPlaceholder('⏸️ Oyuncuyu Molaya Al / Çıkar')
    .addOptions([{ label: 'İşlem Yapma', value: 'none' }]);

  const kickMenu = new StringSelectMenuBuilder()
    .setCustomId(`leader_kick_${contentId}`)
    .setPlaceholder('❌ Oyuncuyu Listeden Sil')
    .addOptions([{ label: 'İşlem Yapma', value: 'none' }]);

  if (activeParticipants.length > 0) {
    for (const p of activeParticipants) {
      const member = interaction.guild.members.cache.get(p.userId);
      const name = member ? member.displayName : p.userId;
      pauseMenu.addOptions([{ label: name, description: p.isPaused ? 'Şu an molada (Döndür)' : 'Aktif (Molaya al)', value: p.userId }]);
      kickMenu.addOptions([{ label: name, description: 'Listeden tamamen çıkar', value: p.userId }]);
    }
  } else {
    pauseMenu.setDisabled(true);
    kickMenu.setDisabled(true);
  }

  rows.push(new ActionRowBuilder().addComponents(pauseMenu));
  rows.push(new ActionRowBuilder().addComponents(kickMenu));

  if (isFirstReply) {
    await interaction.reply({ embeds: [embed], components: rows, flags: 64 });
  } else {
    await interaction.update({ embeds: [embed], components: rows });
  }
}
