const { Events, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('../db/database');
const { calculateParticipantData, generateLeaderBoardEmbed, generateFinalLootEmbed } = require('../utils/calculator');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction, client);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
      }
    } catch (error) {
      console.error(error);
      const msg = 'İşlem sırasında bir hata oluştu!';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: 64 }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
      }
    }
  },
};

async function handleButton(interaction) {
  const { customId } = interaction;

  if (customId.startsWith('toggle_pause_')) {
    const contentId = customId.replace('toggle_pause_', '');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ? AND status = ?').get(contentId, 'ACTIVE');
    if (!content) return interaction.reply({ content: 'Bu content artık aktif değil.', flags: 64 });

    const p = db.prepare('SELECT * FROM participants WHERE contentId = ? AND userId = ?').get(contentId, interaction.user.id);
    if (!p) return interaction.reply({ content: 'Önce ses kanalına katılarak partiye dahil olmalısınız!', flags: 64 });

    const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
    const now = Date.now();
    if (p.isPaused) {
      const pauseDuration = now - p.lastPauseStart;
      const newTotal = (p.totalPausedTime || 0) + pauseDuration;
      db.prepare('UPDATE participants SET isPaused = 0, totalPausedTime = ? WHERE contentId = ? AND userId = ?').run(newTotal, contentId, interaction.user.id);
      updateSingleActiveEmbed(interaction.client, contentId);
      const { emitUpdate } = require('../../api_server/server');
      emitUpdate(contentId);
      await interaction.reply({ content: '▶️ **Moladan döndünüz!** Süreniz tekrar işlemeye başladı.', flags: 64 });
      setTimeout(() => interaction.deleteReply().catch(console.error), 5000);
      return;
    } else {
      // Pause
      db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND userId = ?').run(now, contentId, interaction.user.id);
      updateSingleActiveEmbed(interaction.client, contentId);
      const { emitUpdate } = require('../../api_server/server');
      emitUpdate(contentId);

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
      const { emitUpdate } = require('../../api_server/server');
      emitUpdate(contentId);

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

    const { emitUpdate } = require('../../api_server/server');
    emitUpdate(contentId);

    return interaction.reply({ content: '⏱️ Süre başarıyla başlatıldı! Tüm oyuncuların sayacı sıfırdan başladı.', flags: 64 });
  }



  if (customId.startsWith('web_panel_')) {
    const contentId = customId.replace('web_panel_', '');
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
    if (!content) return interaction.reply({ content: 'Bu content artık aktif değil.', flags: 64 });
    if (interaction.user.id !== content.leaderId) return interaction.reply({ content: 'Bu butonu sadece parti lideri kullanabilir!', flags: 64 });

    const vpsIp = process.env.VPS_IP || '155.254.35.250';

    return interaction.reply({ 
      content: `👑 **Web Kontrol Paneli Linkiniz:**\n🔹 [Panele Git](http://${vpsIp}:3000/dashboard/${contentId})\n\n*(Bu linki kimseyle paylaşmayın)*`, 
      flags: 64 
    });
  }
}

async function handleModal(interaction, client) {
  if (interaction.customId === 'start_gank_modal') {
    await interaction.deferReply();
    const limitStr = interaction.fields.getTextInputValue('gank_limit');
    let limit = parseInt(limitStr.replace(/[^0-9]/g, '')) || 0;
    if (limit > 99) limit = 99; // Discord VC limit max 99

    const { v4: uuidv4 } = require('uuid');
    const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const contentId = uuidv4();
    const leaderId = interaction.user.id;
    const guild = interaction.guild;
    const categoryId = process.env.CATEGORY_ID ? process.env.CATEGORY_ID.trim() : null;
    if (!categoryId) {
      await interaction.editReply({ content: 'HATA: Bot ayarlarında CATEGORY_ID bulunamadı. Lütfen `.env` dosyasını kontrol edin.' });
      return;
    }

    try {
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

      const voiceChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        userLimit: limit,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: ['Connect', 'ViewChannel']
          },
          {
            id: leaderId,
            allow: ['Connect', 'ViewChannel', 'ManageChannels']
          }
        ]
      });

      const createTime = Date.now();
      db.prepare(`
        INSERT INTO contents (contentId, leaderId, voiceChannelId, status, startTime, endTime, totalLoot, repairCost, botShare, title, maxPlayers, deleteVcWhenEmpty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(contentId, leaderId, voiceChannel.id, 'ACTIVE', 0, null, 0, 0, 0, title, limit, 0);

      // Auto-insert leader as approved
      db.prepare(`
        INSERT INTO participants (contentId, userId, joinTime, leaveTime, isPaused, lastPauseStart, totalPausedTime, status, multiplier, bonusMinutes, penaltyMinutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(contentId, leaderId, createTime, null, 1, createTime, 0, 'APPROVED', 1.0, 0, 0);

      const { generateActiveEmbed } = require('../utils/embedUpdater');
      const tempContent = {
        contentId, leaderId, voiceChannelId: voiceChannel.id, status: 'ACTIVE', startTime: 0, endTime: null, totalLoot: 0, repairCost: 0, title, maxPlayers: limit
      };
      const embed = generateActiveEmbed(tempContent);

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

      const panelBtn = new ButtonBuilder()
        .setCustomId(`web_panel_${contentId}`)
        .setLabel('Web Paneli')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🌐');

      const row = new ActionRowBuilder().addComponents(pauseBtn, startTimerBtn, panelBtn);

      const replyMsg = await interaction.editReply({ embeds: [embed], components: [row] });

      db.prepare('UPDATE contents SET messageId = ?, channelId = ? WHERE contentId = ?').run(replyMsg.id, interaction.channelId, contentId);

      // Lidere özel web linki
      const vpsIp = process.env.VPS_IP || '155.254.35.250';
      
      await interaction.followUp({ 
        content: `👑 **Web Kontrol Paneli Linkiniz:**\n🔹 [Panele Git](http://${vpsIp}:3000/dashboard/${contentId})\n\n*(Bu linki kimseyle paylaşmayın)*`, 
        flags: 64 
      });

    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: 'Kanal oluşturulurken bir hata oluştu. Botun gerekli yetkilere (Kanalları Yönet) sahip olduğundan ve CATEGORY_ID nin doğru olduğundan emin olun.' });
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

    let origMsg = null;
    try {
      origMsg = await interaction.channel.messages.fetch(content.messageId).catch(() => null);
      if (origMsg) {
        const oldEmbeds = origMsg.embeds;
        const newEmbed = EmbedBuilder.from(oldEmbeds[0]);
        newEmbed.setDescription('🛑 **BU CONTENT KAPANMIŞTIR** 🛑\n\n' + (newEmbed.data.description || ''));
        newEmbed.setColor('#FF0000');
        await origMsg.edit({ embeds: [newEmbed], components: [] }).catch(()=>{});
      }
    } catch(e) {}

    db.prepare('UPDATE contents SET status = ?, deleteVcWhenEmpty = 1 WHERE contentId = ?').run('COMPLETED', contentId);
    db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND isPaused = 0').run(endTime, contentId);

    try {
      const vc = await interaction.client.channels.fetch(content.voiceChannelId).catch(() => null);
      if (vc && vc.members.size === 0) {
        setTimeout(async () => {
          try {
            const currentVc = await interaction.client.channels.fetch(vc.id).catch(()=>null);
            if (currentVc && currentVc.members.size === 0) {
              await currentVc.delete().catch(()=>null);
              db.prepare('UPDATE contents SET deleteVcWhenEmpty = 0 WHERE voiceChannelId = ?').run(vc.id);
            }
          } catch(e){}
        }, 30000);
      }
    } catch(e) {}

    await interaction.deferReply();
    
    try {
      const apiData = {
        contentId: contentId
      };
      
      const response = await fetch('http://localhost:3000/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiData)
      });
      
      if (!response.ok) {
        throw new Error('API yaniti basarisiz.');
      }
      
      const calcData = await response.json();
      const finalContent = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
      
      const finalEmbed = generateFinalLootEmbed(finalContent, calcData);
      
      if (origMsg) {
        await origMsg.edit({ embeds: [finalEmbed], components: [] }).catch(()=>{});
      } else {
        await interaction.channel.send({ embeds: [finalEmbed] }).catch(()=>{});
      }
      await interaction.editReply({ content: '✅ Gank başarıyla sonlandırıldı ve sonuçlar web API tarafından hesaplandı.', flags: 64 });
    } catch (apiError) {
      console.error("API Error:", apiError);
      const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(contentId);
      const finalContent = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
      const calcData = calculateParticipantData(finalContent, participants);
      const finalEmbed = generateFinalLootEmbed(finalContent, calcData);
      
      if (origMsg) {
        await origMsg.edit({ embeds: [finalEmbed], components: [] }).catch(()=>{});
      } else {
        await interaction.channel.send({ embeds: [finalEmbed] }).catch(()=>{});
      }
      await interaction.editReply({ content: '⚠️ Yerel API ulaşılamadı, sonuçlar bot içerisinde hesaplandı.', flags: 64 });
    }
  }
}

async function handleSelectMenu(interaction) {
  await interaction.reply({ content: 'Bu işlem artık Web Paneli üzerinden yapılıyor.', flags: 64 });
}
