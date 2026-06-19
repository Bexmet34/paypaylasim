const { EmbedBuilder } = require('discord.js');

function calculateParticipantData(content, participants) {
  const endTime = content.endTime || Date.now();
  let contentDurationMinutes = 0;
  if (content.startTime > 0) {
    contentDurationMinutes = (endTime - content.startTime) / 60000;
  }

  let totalPartyMinutes = 0;
  const results = [];

  for (const p of participants) {
    if (p.status !== 'APPROVED') continue;

    let netActiveMinutes = 0;
    let isRisk = false;

    if (content.startTime > 0) {
      const effectiveContentEndTime = content.endTime || Date.now();
      const contentDurationMs = effectiveContentEndTime - content.startTime;
      let effectiveEndTime = p.leaveTime || effectiveContentEndTime;
      
      let effectivePauseTime = p.totalPausedTime || 0;
      if (p.isPaused) {
        effectiveEndTime = p.lastPauseStart;
      }

      const netActiveMs = effectiveEndTime - Math.max(p.joinTime, content.startTime) - effectivePauseTime;
      netActiveMinutes = Math.max(0, netActiveMs / (1000 * 60));

      const joinOffsetMs = Math.max(p.joinTime, content.startTime) - content.startTime;
      const leaveOffsetMs = effectiveContentEndTime - effectiveEndTime;
      const joinOffsetMin = joinOffsetMs / (1000 * 60);
      const leaveOffsetMin = leaveOffsetMs / (1000 * 60);

      isRisk = joinOffsetMin > 15 && leaveOffsetMin > 15;
    }

    totalPartyMinutes += netActiveMinutes;
    
    results.push({
      userId: p.userId,
      netActiveMinutes,
      isRisk,
      isPaused: p.isPaused,
      status: p.status
    });
  }

  const botShare = content.botShare || 0;
  const netPool = content.totalLoot - content.repairCost - botShare;
  const silverPerMinute = totalPartyMinutes > 0 ? netPool / totalPartyMinutes : 0;

  for (const r of results) {
    r.share = Math.floor(r.netActiveMinutes * silverPerMinute);
  }

  return {
    results,
    totalPartyMinutes,
    netPool,
    silverPerMinute,
    contentDurationMinutes
  };
}

function generateLeaderBoardEmbed(content, calculatedData) {
  const embed = new EmbedBuilder()
    .setTitle('Lider Onay Masası')
    .setDescription(`Toplam Süre: **${calculatedData.contentDurationMinutes.toFixed(1)} dk**\nNet Havuz: **${calculatedData.netPool.toLocaleString()} Silver**\nDakika Başı: **${Math.floor(calculatedData.silverPerMinute).toLocaleString()} Silver**\n\nAşağıdaki listeden oyuncuları onaylayın veya düzenleyin. \n🔴 Kırmızı: Riskli/Yetersiz süre (Geç girip erken çıkmış).`)
    .setColor('#FFA500');

  const chunks = [];
  let currentChunk = '';
  for (const r of calculatedData.results) {
    const riskIndicator = r.isRisk ? '🔴' : '🟢';
    const pauseIndicator = r.isPaused ? ' ⏸️' : '';
    const line = `${riskIndicator} <@${r.userId}>: ${r.netActiveMinutes.toFixed(1)}m${pauseIndicator}\n`;
    if (currentChunk.length + line.length > 950) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += line;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  if (chunks.length === 0) chunks.push('Henüz kimse katılmadı.');

  for (let i = 0; i < chunks.length; i++) {
    embed.addFields({ name: i === 0 ? 'Oyuncular' : 'Oyuncular (Devamı)', value: chunks[i] });
  }
  return embed;
}

function generateFinalLootEmbed(content, calculatedData) {
  const totalMins = calculatedData.totalWeightedMinutes || calculatedData.totalPartyMinutes || 0;
  const participantCount = calculatedData.results.length;
  const perPersonRepair = participantCount > 0 ? Math.floor(content.repairCost / participantCount) : 0;

  const embed = new EmbedBuilder()
    .setTitle('🏆 GANK TAMAMLANDI - FİNAL LOOT SONUÇLARI')
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/5132/5132047.png')
    .setDescription(`👑 **Lider:** <@${content.leaderId}>
👥 **Katılımcı Sayısı:** ${participantCount} Kişi

📊 **HESAPLAMA DETAYLARI**
💵 **Brüt Loot:** \`${content.totalLoot.toLocaleString()}\` Silver
🛠️ **Toplam Tamir:** \`-${content.repairCost.toLocaleString()}\` Silver *(Kişi Başı: ${perPersonRepair.toLocaleString()})*
` + 
      (content.botShare ? `💼 **Özel Kesinti:** \`-${content.botShare.toLocaleString()}\` Silver\n` : '') +
      `
✅ **NET DAĞITILACAK HAVUZ:** \`${calculatedData.netPool.toLocaleString()}\` Silver

⏱️ **Toplam Geçerli Süre:** \`${totalMins.toFixed(1)}\` Dakika
💰 **Dakika Başına Düşen:** \`${Math.floor(calculatedData.silverPerMinute).toLocaleString()}\` Silver
`)
    .setColor('#FFD700')
    .setFooter({ text: 'Loot Paylaşım Sistemi | Albion Online', iconURL: 'https://cdn-icons-png.flaticon.com/512/616/616490.png' })
    .setTimestamp();

  const chunks = [];
  let currentChunk = '';
  
  // Sort participants by share descending
  const sortedResults = [...calculatedData.results].sort((a, b) => b.share - a.share);

  for (const r of sortedResults) {
    const line = `> <@${r.userId}> ➔ **${r.share.toLocaleString()} Silver** *(⏱️ ${r.netActiveMinutes.toFixed(1)} dk)*\n`;
    if (currentChunk.length + line.length > 950) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += line;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  if (chunks.length === 0) chunks.push('> Katılımcı bulunamadı.');

  for (let i = 0; i < chunks.length; i++) {
    embed.addFields({ name: i === 0 ? '💎 OYUNCU HİSSELERİ (Sıralı)' : '💎 OYUNCU HİSSELERİ (Devamı)', value: chunks[i] });
  }
  return embed;
}

module.exports = {
  calculateParticipantData,
  generateLeaderBoardEmbed,
  generateFinalLootEmbed
};
