const { EmbedBuilder } = require('discord.js');
const db = require('../db/database');
const { calculateParticipantData } = require('./calculator');

async function updateAllActiveEmbeds(client) {
  const activeContents = db.prepare("SELECT * FROM contents WHERE status = 'ACTIVE' AND messageId IS NOT NULL AND channelId IS NOT NULL").all();
  
  for (const content of activeContents) {
    try {
      const channel = client.channels.cache.get(content.channelId) || await client.channels.fetch(content.channelId).catch(() => null);
      if (!channel) continue;
      
      const message = await channel.messages.fetch(content.messageId).catch(() => null);
      if (!message) continue;

      const embed = generateActiveEmbed(content);
      await message.edit({ embeds: [embed], components: message.components });
    } catch (e) {
      console.error('Error updating active embed for content', content.contentId, e);
    }
  }
}

async function updateSingleActiveEmbed(client, contentId) {
  const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
  if (!content || content.status !== 'ACTIVE' || !content.messageId || !content.channelId) return;
  
  try {
    const channel = client.channels.cache.get(content.channelId) || await client.channels.fetch(content.channelId).catch(() => null);
    if (!channel) return;
    
    const message = await channel.messages.fetch(content.messageId).catch(() => null);
    if (!message) return;

    const embed = generateActiveEmbed(content);
    await message.edit({ embeds: [embed], components: message.components });
  } catch (e) {
    console.error('Error updating active embed for content', contentId, e);
  }
}

function generateActiveEmbed(content) {
  const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(content.contentId);
  const calcData = calculateParticipantData(content, participants);

  const durationText = content.startTime > 0 
    ? `**Süre:** ${calcData.contentDurationMinutes.toFixed(1)} dk`
    : `**Süre:** ⏳ Liderin Başlatması Bekleniyor`;

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${content.title}`)
    .setDescription(`**Lider:** <@${content.leaderId}>\n**Kişi Sınırı:** ${content.maxPlayers > 0 ? content.maxPlayers : 'Limitsiz'}\n**Ses Kanalı:** <#${content.voiceChannelId}>\n\n${durationText}\n\nSisteme kayıt olmak için önce yukarıdaki **Ses Kanalına** katılmalı, ardından aşağıdaki **Katılmak İstiyorum** butonuna basmalısınız.\n\nEğer AFK kalmanız veya çıkmanız gerekirse **[ Mola / Devam ]** butonunu kullanın.\n\n**Katılımcılar ve Süreleri:**`)
    .setColor('#00FF00')
    .setTimestamp();

  const chunks = [];
  let currentChunk = '';
  for (const p of calcData.results) {
    let line = '';
    if (p.status === 'PENDING') {
      line = `> <@${p.userId}> : ⏳ **Lider Onayı Bekliyor**\n`;
    } else {
      const pauseIndicator = p.isPaused ? '⏸️ Molada' : '⏱️ Aktif';
      line = `> <@${p.userId}> : **${Math.floor(p.netActiveMinutes)} dk** (${pauseIndicator})\n`;
    }
    if (currentChunk.length + line.length > 1000) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += line;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  if (chunks.length === 0) chunks.push('Henüz kimse katılmadı.');

  for (let i = 0; i < chunks.length; i++) {
    embed.addFields({ name: i === 0 ? 'Oyuncu Listesi' : 'Oyuncu Listesi (Devamı)', value: chunks[i] });
  }

  return embed;
}

module.exports = {
  updateAllActiveEmbeds,
  updateSingleActiveEmbed,
  generateActiveEmbed
};
