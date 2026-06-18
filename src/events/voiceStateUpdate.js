const { Events } = require('discord.js');
const db = require('../db/database');

module.exports = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    // We only care if something changed regarding channels or deaf/mute status
    if (oldState.channelId === newState.channelId && oldState.serverDeaf === newState.serverDeaf && oldState.selfDeaf === newState.selfDeaf) {
      return;
    }

    const userId = newState.member.id;
    const now = Date.now();

    // Check if user left a channel
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const vc = oldState.channel;
      if (vc && vc.members.size === 0) {
        // Channel is empty. Check if it should be deleted.
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

    // Find if user is part of an ACTIVE content
    const activeParticipantRow = db.prepare(`
      SELECT p.*, c.voiceChannelId 
      FROM participants p 
      JOIN contents c ON p.contentId = c.contentId 
      WHERE p.userId = ? AND c.status = 'ACTIVE'
    `).get(userId);

    if (!activeParticipantRow) return;

    const contentId = activeParticipantRow.contentId;
    const targetVoiceChannelId = activeParticipantRow.voiceChannelId;
    const isPausedInDb = activeParticipantRow.isPaused;

    // Check if they are currently deafened or if they left the target channel
    const isDeafened = newState.serverDeaf || newState.selfDeaf;
    const isLeftTargetChannel = newState.channelId !== targetVoiceChannelId;

    const shouldBePaused = isDeafened || isLeftTargetChannel;

    if (shouldBePaused && !isPausedInDb) {
      // Pause them
      db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND userId = ?').run(now, contentId, userId);
      const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
      updateSingleActiveEmbed(newState.client, contentId);
    } else if (!shouldBePaused && isPausedInDb) {
      // If they returned to the target channel and undeafened, unpause them
      // ONLY IF they weren't manually paused for a long time?
      // Wait, if they manually clicked pause, and then undeafened, should it unpause?
      // Yes, because voice state reflects their actual presence. If they want to be paused while in channel, they can just deafen.
      const pauseDuration = now - activeParticipantRow.lastPauseStart;
      const newTotal = (activeParticipantRow.totalPausedTime || 0) + pauseDuration;
      db.prepare('UPDATE participants SET isPaused = 0, totalPausedTime = ? WHERE contentId = ? AND userId = ?').run(newTotal, contentId, userId);
      const { updateSingleActiveEmbed } = require('../utils/embedUpdater');
      updateSingleActiveEmbed(newState.client, contentId);
    }
  },
};
