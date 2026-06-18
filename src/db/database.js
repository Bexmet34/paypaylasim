const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath);

// Create table for sessions
db.prepare(`
  CREATE TABLE IF NOT EXISTS contents (
    contentId TEXT PRIMARY KEY,
    leaderId TEXT,
    voiceChannelId TEXT,
    status TEXT,
    startTime INTEGER,
    endTime INTEGER,
    totalLoot INTEGER,
    repairCost INTEGER
  )
`).run();

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
    FOREIGN KEY(contentId) REFERENCES contents(contentId) ON DELETE CASCADE
  )
`).run();

module.exports = db;
