const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const { generateFinalLootEmbed } = require('../src/utils/calculator');
const http = require('http');
const { Server } = require('socket.io');

const dbPath = path.join(__dirname, '../paypaylasim.sqlite');
const db = new Database(dbPath);

let io;
let globalDiscordClient;

async function emitUpdate(contentId) {
  if (!io) return;
  try {
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
    if (!content) return;
    const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(contentId);
    for (let p of participants) {
      p.username = p.userId;
      p.avatarUrl = '';
      if (globalDiscordClient) {
        try {
          const guild = globalDiscordClient.guilds.cache.get(process.env.GUILD_ID);
          if (guild) {
            const member = guild.members.cache.get(p.userId) || await guild.members.fetch(p.userId).catch(() => null);
            if (member) {
              p.username = member.nickname || member.displayName || member.user.globalName || member.user.username;
              p.avatarUrl = member.user.displayAvatarURL({ size: 64 });
            }
          } else {
            const user = globalDiscordClient.users.cache.get(p.userId) || await globalDiscordClient.users.fetch(p.userId).catch(() => null);
            if (user) {
              p.username = user.globalName || user.username;
              p.avatarUrl = user.displayAvatarURL({ size: 64 });
            }
          }
        } catch(e) {}
      }
    }
    io.to(contentId).emit('data_update', { content, participants });
  } catch (err) {
    console.error('Socket emitUpdate error:', err);
  }
}

function startServer(discordClient) {
  globalDiscordClient = discordClient;
  const app = express();
  const PORT = process.env.PORT || 3000;
  
  const server = http.createServer(app);
  io = new Server(server, { cors: { origin: '*' } });
  
  io.on('connection', (socket) => {
    socket.on('join_content', (contentId) => {
      socket.join(contentId);
      emitUpdate(contentId);
    });
  });

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Serve the dashboard
  app.get('/dashboard/:contentId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // API: Get content and participants
  app.get('/api/content/:contentId', async (req, res) => {
    try {
      const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(req.params.contentId);
      if (!content) return res.status(404).json({ error: 'Content not found' });

      const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(req.params.contentId);

      for (let p of participants) {
        p.username = p.userId;
        p.avatarUrl = '';
        if (discordClient) {
          try {
            const guild = discordClient.guilds.cache.get(process.env.GUILD_ID);
            if (guild) {
              const member = guild.members.cache.get(p.userId) || await guild.members.fetch(p.userId).catch(() => null);
              if (member) {
                p.username = member.nickname || member.displayName || member.user.globalName || member.user.username;
                p.avatarUrl = member.user.displayAvatarURL({ size: 64 });
              }
            } else {
              const user = discordClient.users.cache.get(p.userId) || await discordClient.users.fetch(p.userId).catch(() => null);
              if (user) {
                p.username = user.globalName || user.username;
                p.avatarUrl = user.displayAvatarURL({ size: 64 });
              }
            }
          } catch(e) {}
        }
      }

      res.json({ content, participants });
    } catch (error) {
      console.error('API GET /content Error:', error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // API: Update participant (Multiplier, Pause, etc)
  app.post('/api/participant/:contentId/:userId', async (req, res) => {
    try {
      const { action, value } = req.body;
      const { contentId, userId } = req.params;

      const p = db.prepare('SELECT * FROM participants WHERE contentId = ? AND userId = ?').get(contentId, userId);
      if (!p) return res.status(404).json({ error: 'Participant not found' });

      const now = Date.now();

      if (action === 'multiplier') {
        db.prepare('UPDATE participants SET multiplier = ? WHERE contentId = ? AND userId = ?').run(value, contentId, userId);
      } else if (action === 'toggle_pause') {
        if (p.isPaused) {
          const pauseDuration = now - p.lastPauseStart;
          const newTotal = (p.totalPausedTime || 0) + pauseDuration;
          db.prepare('UPDATE participants SET isPaused = 0, totalPausedTime = ? WHERE contentId = ? AND userId = ?').run(newTotal, contentId, userId);
        } else {
          db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND userId = ?').run(now, contentId, userId);
        }
      } else if (action === 'kick') {
        db.prepare('DELETE FROM participants WHERE contentId = ? AND userId = ?').run(contentId, userId);
      } else if (action === 'approve') {
        db.prepare("UPDATE participants SET status = 'APPROVED', joinTime = ?, totalPausedTime = 0, isPaused = 0, lastPauseStart = 0 WHERE contentId = ? AND userId = ?")
          .run(now, contentId, userId);
      }

      emitUpdate(contentId);
      res.json({ success: true });
    } catch (error) {
      console.error('API POST /participant Error:', error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // Reusable Calculation Function
  function calculateData(contentId) {
    const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
    if (!content) throw new Error('Content not found');

    const participants = db.prepare('SELECT * FROM participants WHERE contentId = ?').all(contentId);

    const grossLoot = content.totalLoot || 0;
    const marketTaxRate = 0;
    const marketTax = Math.floor(grossLoot * marketTaxRate);
    const guildTax = content.botShare || 0; 
    const repairCosts = content.repairCost || 0;
    
    const netPool = grossLoot - marketTax - guildTax - repairCosts;
    const endTime = content.endTime || Date.now();
    const contentDurationMin = content.startTime > 0 ? (endTime - content.startTime) / 60000 : 0;

    let totalWeightedMinutes = 0;
    const results = [];

    for (const p of participants) {
      if (p.status !== 'APPROVED') continue;

      let effectiveEndTime = p.leaveTime || endTime;
      let effectivePauseTime = p.totalPausedTime || 0;
      if (p.isPaused) {
        effectiveEndTime = p.lastPauseStart;
      }

      const netActiveMs = effectiveEndTime - Math.max(p.joinTime, content.startTime) - effectivePauseTime;
      let netActiveMinutes = Math.max(0, netActiveMs / (1000 * 60));

      let finalMultiplier = p.multiplier;
      let weightedMinutes = netActiveMinutes * finalMultiplier;
      totalWeightedMinutes += weightedMinutes;

      results.push({
        userId: p.userId,
        roleName: 'Çöpçü',
        netActiveMinutes,
        cappedMinutes: netActiveMinutes,
        weightedMinutes,
        multiplier: finalMultiplier,
        isRisk: false,
        isPaused: p.isPaused
      });
    }

    const silverPerWeightedMin = totalWeightedMinutes > 0 ? netPool / totalWeightedMinutes : 0;

    for (const r of results) {
      r.share = Math.floor(r.weightedMinutes * silverPerWeightedMin);
      if (r.share < 0) r.share = 0;
    }

    return {
      grossLoot,
      marketTax,
      guildTax,
      repairCosts,
      netPool,
      totalWeightedMinutes,
      silverPerMinute: silverPerWeightedMin,
      contentDurationMinutes: contentDurationMin,
      results,
      distributionMode: 'WEIGHTED'
    };
  }

  // API: Calculate
  app.post('/api/calculate', (req, res) => {
    try {
      const data = calculateData(req.body.contentId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: End Gank from Web Dashboard
  app.post('/api/end_gank_web', async (req, res) => {
    try {
      const { contentId, gross, repair, tax } = req.body;
      const content = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
      if (!content) return res.status(404).json({ error: 'Content not found', success: false });

      if (content.status === 'COMPLETED') return res.status(400).json({ error: 'Gank zaten bitirilmiş', success: false });

      const endTime = Date.now();

      db.prepare('UPDATE contents SET totalLoot = ?, repairCost = ?, botShare = ?, endTime = ?, status = ?, deleteVcWhenEmpty = 1 WHERE contentId = ?')
        .run(gross, repair, tax, endTime, 'COMPLETED', contentId);
      
      db.prepare('UPDATE participants SET isPaused = 1, lastPauseStart = ? WHERE contentId = ? AND isPaused = 0').run(endTime, contentId);

      // Check if voice channel is empty right now
      if (globalDiscordClient && content.voiceChannelId) {
        try {
          const vc = await globalDiscordClient.channels.fetch(content.voiceChannelId).catch(() => null);
          if (vc && vc.members.size === 0) {
            setTimeout(async () => {
              try {
                const currentVc = await globalDiscordClient.channels.fetch(vc.id).catch(()=>null);
                if (currentVc && currentVc.members.size === 0) {
                  await currentVc.delete().catch(()=>null);
                  db.prepare('UPDATE contents SET deleteVcWhenEmpty = 0 WHERE voiceChannelId = ?').run(vc.id);
                }
              } catch(e){}
            }, 30000);
          }
        } catch(e) {}
      }

      // Close discord message
      try {
        if (discordClient && content.channelId && content.messageId) {
          const channel = await discordClient.channels.fetch(content.channelId).catch(()=>null);
          if (channel) {
            const origMsg = await channel.messages.fetch(content.messageId).catch(() => null);
            if (origMsg) {
              // Post Final Embed
              const calcData = calculateData(contentId);
              const finalContent = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
              const finalEmbed = generateFinalLootEmbed(finalContent, calcData);
              await origMsg.edit({ embeds: [finalEmbed], components: [] }).catch(()=>{});
            } else {
              const calcData = calculateData(contentId);
              const finalContent = db.prepare('SELECT * FROM contents WHERE contentId = ?').get(contentId);
              const finalEmbed = generateFinalLootEmbed(finalContent, calcData);
              await channel.send({ embeds: [finalEmbed] }).catch(()=>{});
            }
          }
        }
      } catch (e) { console.error("Discord error on end_gank_web:", e); }

      emitUpdate(contentId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message, success: false });
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Web Dashboard Server running on Port ${PORT}`);
  });
}

module.exports = { startServer, emitUpdate };
