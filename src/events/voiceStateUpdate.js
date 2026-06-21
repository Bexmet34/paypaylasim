const { Events } = require('discord.js');
const db = require('../db/database');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    try {
      if (oldState.channelId === newState.channelId && oldState.serverDeaf === newState.serverDeaf && oldState.selfDeaf === newState.selfDeaf) {
        return;
      }

      const userId = newState.member.id;
      const now = Date.now();

      // Check if user left a channel
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const vc = oldState.channel;
        if (vc && vc.members.size === 0) {
          const cRow = db.prepare('SELECT * FROM contents WHERE voiceChannelId = ? ORDER BY startTime DESC LIMIT 1').get(vc.id);
          if (cRow && cRow.deleteVcWhenEmpty === 1) {
            setTimeout(async () => {
              try {
                const currentVc = await oldState.client.channels.fetch(vc.id).catch(()=>null);
                if (currentVc && currentVc.members.size === 0) {
                  await currentVc.delete().catch(()=>null);
                  db.prepare('UPDATE contents SET deleteVcWhenEmpty = 0 WHERE voiceChannelId = ?').run(vc.id);
                }
              } catch(e){}
            }, 30000);
          }
        }
      }

      // 1. AUTO-JOIN LOGIC REMOVED (Users must explicitly click "Katılmak İstiyorum" under the Discord embed)


      // 2. AUTO-PAUSE LOGIC
      // 2. AUTO-PAUSE LOGIC
      // A user might be in multiple active ganks (e.g., if leader didn't close an old one).
      // We must fetch ALL active participations and pause/unpause them accordingly.
      const activeParticipantRows = db.prepare(`
        SELECT p.*, c.voiceChannelId 
        FROM participants p 
        JOIN contents c ON p.contentId = c.contentId 
        WHERE p.userId = ? AND c.status = 'ACTIVE' AND p.status = 'APPROVED'
      `).all(userId);

      if (!activeParticipantRows || activeParticipantRows.length === 0) return;

      for (const activeParticipantRow of activeParticipantRows) {
        const contentId = activeParticipantRow.contentId;
        const targetVoiceChannelId = activeParticipantRow.voiceChannelId;
        const isPausedInDb = activeParticipantRow.isPaused;

        const isDeafened = newState.serverDeaf || newState.selfDeaf;
        const isLeftTargetChannel = newState.channelId !== targetVoiceChannelId;

        const shouldBePaused = isDeafened || isLeftTargetChannel;

        if (shouldBePaused && !isPausedInDb) {
          db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND userId = ?').run(now, contentId, userId);
          const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
          updateSingleActiveEmbed(newState.client, contentId);
          const { emitUpdate } = require('../../api_server/server');
          emitUpdate(contentId);
        } else if (!shouldBePaused && isPausedInDb) {
          const pauseDuration = now - activeParticipantRow.lastPauseStart;
          const newTotal = (activeParticipantRow.totalPausedTime || 0) + pauseDuration;
          db.prepare('UPDATE participants SET isPaused = 0, totalPausedTime = ? WHERE contentId = ? AND userId = ?').run(newTotal, contentId, userId);
          const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
          updateSingleActiveEmbed(newState.client, contentId);
          const { emitUpdate } = require('../../api_server/server');
          emitUpdate(contentId);
        }
      }
    } catch (error) {
      console.error('voiceStateUpdate Error:', error);
    }
  },
};
