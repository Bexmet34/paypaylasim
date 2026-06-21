const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../paypaylasim.sqlite');
const db = new Database(dbPath);

// Create table for sessions
db.prepare(`
  CREATE TABLE IF NOT EXISTS contents (
    contentId TEXT PRIMARY KEY,
    leaderId TEXT,
    voiceChannelId TEXT,
    channelId TEXT,
    messageId TEXT,
    title TEXT,
    maxPlayers INTEGER,
    status TEXT,
    startTime INTEGER,
    endTime INTEGER,
    totalLoot INTEGER,
    repairCost INTEGER,
    botShare INTEGER,
    deleteVcWhenEmpty INTEGER DEFAULT 0
  )
`).run();

try {
  const tableInfo = db.pragma('table_info(contents)');
  const columns = tableInfo.map(c => c.name);

  if (!columns.includes('channelId')) {
    db.prepare('ALTER TABLE contents ADD COLUMN channelId TEXT').run();
  }
  if (!columns.includes('botShare')) {
    db.prepare('ALTER TABLE contents ADD COLUMN botShare INTEGER DEFAULT 0').run();
  }
  if (!columns.includes('deleteVcWhenEmpty')) {
    db.prepare('ALTER TABLE contents ADD COLUMN deleteVcWhenEmpty INTEGER DEFAULT 0').run();
  }
  if (!columns.includes('silverBag')) {
    db.prepare('ALTER TABLE contents ADD COLUMN silverBag INTEGER DEFAULT 0').run();
  }
} catch (err) {
  console.error("Migration error:", err);
}

// Create table for participants
db.prepare(`
  CREATE TABLE IF NOT EXISTS participants (
    contentId TEXT,
    userId TEXT,
    joinTime INTEGER,
    leaveTime INTEGER,
    isPaused INTEGER,
    lastPauseStart INTEGER,
    totalPausedTime INTEGER,
    status TEXT,
    multiplier REAL DEFAULT 1.0,
    bonusMinutes INTEGER DEFAULT 0,
    penaltyMinutes INTEGER DEFAULT 0,
    FOREIGN KEY(contentId) REFERENCES contents(contentId) ON DELETE CASCADE
  )
`).run();

module.exports = db;
