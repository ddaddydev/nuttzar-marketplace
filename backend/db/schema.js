const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/marketplace.db');
let db;

function getDb() {
  if (!db) {
    const fs  = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      torn_id          TEXT UNIQUE NOT NULL,
      torn_name        TEXT,
      discord_id       TEXT UNIQUE,
      encrypted_api_key TEXT,
      role             TEXT DEFAULT 'unverified',
      is_verified      INTEGER DEFAULT 0,
      created_at       INTEGER DEFAULT (unixepoch()),
      updated_at       INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid                  TEXT UNIQUE NOT NULL,
      type                  TEXT NOT NULL CHECK(type IN ('loss','bounty','escape')),
      status                TEXT DEFAULT 'pending_payment' CHECK(status IN (
        'pending_payment','active','completed','cancelled','expired'
      )),
      buyer_torn_id         TEXT NOT NULL,
      buyer_torn_name       TEXT,
      target_torn_id        TEXT,
      target_torn_name      TEXT,
      price_per_unit        INTEGER NOT NULL,
      buyer_price_per_unit  INTEGER NOT NULL,
      bounty_amount         INTEGER DEFAULT 0,
      quantity              INTEGER NOT NULL,
      quantity_remaining    INTEGER NOT NULL,
      quantity_completed    INTEGER DEFAULT 0,
      total_amount          INTEGER NOT NULL,
      payment_confirmed     INTEGER DEFAULT 0,
      payment_confirmed_at  INTEGER,
      discord_message_id    TEXT,
      discord_channel_id    TEXT,
      created_at            INTEGER DEFAULT (unixepoch()),
      updated_at            INTEGER DEFAULT (unixepoch()),
      expires_at            INTEGER
    );

    CREATE TABLE IF NOT EXISTS claims (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id       INTEGER NOT NULL REFERENCES contracts(id),
      seller_torn_id    TEXT NOT NULL,
      seller_discord_id TEXT,
      quantity_claimed  INTEGER NOT NULL,
      quantity_verified INTEGER DEFAULT 0,
      status            TEXT DEFAULT 'active' CHECK(status IN (
        'active','completed','expired','failed'
      )),
      claimed_at        INTEGER DEFAULT (unixepoch()),
      expires_at        INTEGER NOT NULL,
      completed_at      INTEGER,
      payout_amount     INTEGER,
      payout_sent       INTEGER DEFAULT 0,
      payout_sent_at    INTEGER,
      dm_message_id     TEXT
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id         INTEGER NOT NULL REFERENCES claims(id),
      contract_id      INTEGER NOT NULL REFERENCES contracts(id),
      seller_torn_id   TEXT NOT NULL,
      seller_torn_name TEXT,
      amount           INTEGER NOT NULL,
      status           TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
      discord_notified INTEGER DEFAULT 0,
      created_at       INTEGER DEFAULT (unixepoch()),
      sent_at          INTEGER
    );

    CREATE TABLE IF NOT EXISTS transaction_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT NOT NULL,
      contract_id INTEGER,
      claim_id    INTEGER,
      torn_id     TEXT,
      details     TEXT,
      created_at  INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS flight_prefs (
      discord_id       TEXT PRIMARY KEY,
      torn_id          TEXT,
      travel_class     TEXT NOT NULL DEFAULT 'std',
      capacity         INTEGER NOT NULL DEFAULT 10,
      subscribed_items TEXT NOT NULL DEFAULT '[]',
      updated_at       INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_contracts_status  ON contracts(status);
    CREATE INDEX IF NOT EXISTS idx_contracts_type    ON contracts(type);
    CREATE INDEX IF NOT EXISTS idx_claims_contract   ON claims(contract_id);
    CREATE INDEX IF NOT EXISTS idx_claims_seller     ON claims(seller_torn_id);
    CREATE INDEX IF NOT EXISTS idx_claims_status     ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_payouts_status    ON payouts(status);
  `);
  console.log('[DB] Schema initialised');
}

module.exports = { getDb };
