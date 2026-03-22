const express      = require('express');
const router       = express.Router();
const { verifyApiKey } = require('../services/tornApi');
const { encrypt }  = require('../services/encryption');
const { getDb }    = require('../db/schema');
const internalAuth = require('../middleware/internalAuth');

// ── POST /api/users/verify ────────────────────────────────────────────────────
// Called by the Discord bot after a user submits their API key
// Protected: internal key required
router.post('/verify', internalAuth, async (req, res) => {
  try {
    const { discord_id } = req.body;
    const api_key = (req.body.api_key || '').trim().replace(/[\r\n\t]/g, '');
    if (!api_key)         return res.status(400).json({ success: false, error: 'API key required' });
    if (api_key.length !== 16) return res.status(400).json({ success: false, error: `Your API key looks incomplete — it should be exactly 16 characters, but you sent ${api_key.length}. Copy the full key from Torn and try again.` });
    if (!discord_id) return res.status(400).json({ success: false, error: 'Discord ID required' });

    console.log(`[VERIFY] key received — length: ${api_key.length}, chars: ${JSON.stringify(api_key)}`);
    const tornCheck = await verifyApiKey(api_key);
    if (!tornCheck.valid) return res.status(400).json({ success: false, error: tornCheck.error });

    const db = getDb();

    // Block if this Discord account is already verified
    const existingDiscord = db.prepare('SELECT torn_id, torn_name FROM users WHERE discord_id = ? AND is_verified = 1').get(discord_id);
    if (existingDiscord) {
      return res.status(409).json({ success: false, error: `You are already verified as **${existingDiscord.torn_name}** [${existingDiscord.torn_id}]. Contact an admin if you need to relink.` });
    }

    // Block if this Torn ID is already linked to a DIFFERENT Discord account
    const existingTorn = db.prepare('SELECT discord_id FROM users WHERE torn_id = ?').get(tornCheck.torn_id);
    if (existingTorn && existingTorn.discord_id !== discord_id) {
      return res.status(409).json({ success: false, error: 'This Torn account is already linked to another Discord user. Contact an admin if this is a mistake.' });
    }

    db.prepare(`
      INSERT INTO users (torn_id, torn_name, discord_id, encrypted_api_key, role, is_verified)
      VALUES (?, ?, ?, ?, 'seller', 1)
      ON CONFLICT(torn_id) DO UPDATE SET
        torn_name         = excluded.torn_name,
        discord_id        = excluded.discord_id,
        encrypted_api_key = excluded.encrypted_api_key,
        is_verified       = 1,
        updated_at        = unixepoch()
    `).run(tornCheck.torn_id, tornCheck.torn_name, discord_id, encrypt(api_key));

    res.json({ success: true, torn_id: tornCheck.torn_id, torn_name: tornCheck.torn_name, level: tornCheck.level });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/users/by-discord/:discord_id ─────────────────────────────────────
// Bot looks up torn_id from discord_id
// Protected: internal key required
router.get('/by-discord/:discord_id', internalAuth, (req, res) => {
  try {
    if (!/^\d{17,20}$/.test(req.params.discord_id))
      return res.status(400).json({ success: false, error: 'Invalid Discord ID' });

    const user = getDb().prepare('SELECT torn_id, torn_name, role FROM users WHERE discord_id = ?')
      .get(req.params.discord_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, ...user });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/users/by-torn/:torn_id ──────────────────────────────────────────
// Bot looks up discord_id from torn_id (e.g. for payout DMs)
// Protected: internal key required
router.get('/by-torn/:torn_id', internalAuth, (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.torn_id))
      return res.status(400).json({ success: false, error: 'Invalid Torn ID' });

    const user = getDb().prepare('SELECT torn_id, torn_name, discord_id, role FROM users WHERE torn_id = ?')
      .get(req.params.torn_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, ...user });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/users/:torn_id/claims ────────────────────────────────────────────
// Seller's active claims
// Protected: internal key required
router.get('/:torn_id/claims', internalAuth, (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.torn_id))
      return res.status(400).json({ success: false, error: 'Invalid Torn ID' });

    const claims = getDb().prepare(`
      SELECT cl.*, co.type, co.target_torn_name, co.target_torn_id, co.price_per_unit
      FROM claims cl
      JOIN contracts co ON cl.contract_id = co.id
      WHERE cl.seller_torn_id = ? AND cl.status = 'active'
      ORDER BY cl.claimed_at DESC
    `).all(req.params.torn_id);

    res.json({ success: true, claims });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/users/:torn_id/balance ──────────────────────────────────────────
// Seller's earnings summary
// Protected: internal key required
router.get('/:torn_id/balance', internalAuth, (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.torn_id))
      return res.status(400).json({ success: false, error: 'Invalid Torn ID' });

    const db = getDb();
    const tornId = req.params.torn_id;

    const pending = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as total
      FROM payouts p
      JOIN claims c ON p.claim_id = c.id
      WHERE c.seller_torn_id = ? AND p.status = 'pending'
    `).get(tornId);

    const earned = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as total
      FROM payouts p
      JOIN claims c ON p.claim_id = c.id
      WHERE c.seller_torn_id = ? AND p.status = 'sent'
    `).get(tornId);

    const completedCount = db.prepare(`
      SELECT COUNT(*) as count FROM claims
      WHERE seller_torn_id = ? AND status = 'completed'
    `).get(tornId);

    res.json({
      success:         true,
      pending_payout:  pending.total,
      total_earned:    earned.total,
      completed_claims: completedCount.count,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});


// ── GET /api/users/by-discord/:discord_id/apikey ─────────────────────────────
// Returns decrypted Torn API key for the user (bot uses for on-demand checks)
// Protected: internal key required
router.get('/by-discord/:discord_id/apikey', internalAuth, (req, res) => {
  try {
    if (!/^\d{17,20}$/.test(req.params.discord_id))
      return res.status(400).json({ success: false, error: 'Invalid Discord ID' });

    const user = getDb().prepare('SELECT encrypted_api_key FROM users WHERE discord_id = ?')
      .get(req.params.discord_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (!user.encrypted_api_key) return res.status(404).json({ success: false, error: 'No API key stored' });

    const { decrypt } = require('../services/encryption');
    const apiKey = decrypt(user.encrypted_api_key);
    res.json({ success: true, api_key: apiKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/users/leaderboard — top 5 lifetime earners ──────────────────────
router.get('/leaderboard', internalAuth, (req, res) => {
  try {
    const db = getDb();
    const top = db.prepare(`
      SELECT u.torn_id, u.torn_name,
        COALESCE(SUM(CASE WHEN p.status = 'sent' THEN p.amount ELSE 0 END), 0) as lifetime_earned,
        COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) as completed_claims
      FROM users u
      LEFT JOIN claims c  ON c.seller_torn_id = u.torn_id
      LEFT JOIN payouts p ON p.claim_id = c.id
      WHERE u.role = 'seller'
      GROUP BY u.torn_id
      ORDER BY lifetime_earned DESC
      LIMIT 5
    `).all();
    res.json({ success: true, leaderboard: top });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
