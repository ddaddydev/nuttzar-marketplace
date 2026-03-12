const express = require('express');
const router = express.Router();
const { verifyApiKey } = require('../services/tornApi');
const { encrypt } = require('../services/encryption');
const { getDb } = require('../db/schema');

// POST /api/users/verify
router.post('/verify', async (req, res) => {
  try {
    const { api_key, discord_id } = req.body;
    if (!api_key) return res.status(400).json({ success: false, error: 'API key required' });

    const tornCheck = await verifyApiKey(api_key);
    if (!tornCheck.valid) return res.status(400).json({ success: false, error: tornCheck.error });

    const db = getDb();
    const encryptedKey = encrypt(api_key);

    db.prepare(`
      INSERT INTO users (torn_id, torn_name, discord_id, encrypted_api_key, role, is_verified)
      VALUES (?, ?, ?, ?, 'seller', 1)
      ON CONFLICT(torn_id) DO UPDATE SET
        torn_name = excluded.torn_name,
        discord_id = excluded.discord_id,
        encrypted_api_key = excluded.encrypted_api_key,
        is_verified = 1,
        updated_at = unixepoch()
    `).run(tornCheck.torn_id, tornCheck.torn_name, discord_id || null, encryptedKey);

    res.json({ success: true, torn_id: tornCheck.torn_id, torn_name: tornCheck.torn_name, level: tornCheck.level });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/users/by-torn/:torn_id
router.get('/by-torn/:torn_id', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`SELECT torn_id, torn_name, discord_id, role FROM users WHERE torn_id = ?`)
      .get(req.params.torn_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, ...user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/users/by-discord/:discord_id
router.get('/by-discord/:discord_id', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`SELECT torn_id, torn_name, role FROM users WHERE discord_id = ?`)
      .get(req.params.discord_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, ...user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/users/:torn_id/claims
router.get('/:torn_id/claims', (req, res) => {
  try {
    const db = getDb();
    const claims = db.prepare(`
      SELECT cl.*, co.type, co.target_torn_name, co.target_torn_id, co.price_per_unit
      FROM claims cl
      JOIN contracts co ON cl.contract_id = co.id
      WHERE cl.seller_torn_id = ? AND cl.status = 'active'
      ORDER BY cl.claimed_at DESC
    `).all(req.params.torn_id);
    res.json({ success: true, claims });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/users/:torn_id/balance - pending owed + net lifetime earnings
router.get('/:torn_id/balance', (req, res) => {
  try {
    const db = getDb();
    const tornId = req.params.torn_id;

    // Total pending (completed but not yet paid out)
    const pending = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as total
      FROM payouts p
      WHERE p.seller_torn_id = ? AND p.status = 'pending'
    `).get(tornId);

    // Total lifetime earned (all sent payouts)
    const lifetime = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as total
      FROM payouts p
      WHERE p.seller_torn_id = ? AND p.status = 'sent'
    `).get(tornId);

    // Total completed claims count
    const claimCount = db.prepare(`
      SELECT COUNT(*) as total
      FROM claims
      WHERE seller_torn_id = ? AND status = 'completed'
    `).get(tornId);

    res.json({
      success: true,
      pending_payout: pending.total,
      lifetime_earned: lifetime.total,
      total_net: pending.total + lifetime.total,
      completed_claims: claimCount.total
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
