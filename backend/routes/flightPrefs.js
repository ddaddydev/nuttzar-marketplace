const express      = require('express');
const router       = express.Router();
const internalAuth = require('../middleware/internalAuth');
const { getDb }    = require('../db/schema');

const VALID_CLASSES = new Set(['std','airstrip','wlt','business']);
const clampCap = v  => Math.min(Math.max(1, parseInt(v) || 10), 35);
const validCls = v  => VALID_CLASSES.has(v) ? v : 'std';
const now      = () => Math.floor(Date.now() / 1000);

// ── GET /api/flight-prefs/:discordId ─────────────────────────────────────────
// Protected: internal key required
router.get('/:discordId', internalAuth, (req, res) => {
  try {
    const row = getDb().prepare('SELECT * FROM flight_prefs WHERE discord_id = ?').get(req.params.discordId);
    if (!row) return res.json({ travel_class: 'std', capacity: 10, subscribed_items: [] });
    res.json({
      travel_class:     row.travel_class,
      capacity:         row.capacity,
      subscribed_items: JSON.parse(row.subscribed_items || '[]'),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/flight-prefs/:discordId ────────────────────────────────────────
// Protected: internal key required
router.post('/:discordId', internalAuth, (req, res) => {
  try {
    const db  = getDb();
    const cls = validCls(req.body.travel_class);
    const cap = clampCap(req.body.capacity);
    const existing = db.prepare('SELECT subscribed_items FROM flight_prefs WHERE discord_id = ?')
      .get(req.params.discordId);

    db.prepare(`
      INSERT INTO flight_prefs (discord_id, torn_id, travel_class, capacity, subscribed_items, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        travel_class = excluded.travel_class,
        capacity     = excluded.capacity,
        torn_id      = COALESCE(excluded.torn_id, torn_id),
        updated_at   = excluded.updated_at
    `).run(req.params.discordId, req.body.torn_id || null, cls, cap, existing?.subscribed_items || '[]', now());

    res.json({ success: true, travel_class: cls, capacity: cap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/flight-prefs/:discordId/subscriptions ────────────────────────
// Protected: internal key required
router.patch('/:discordId/subscriptions', internalAuth, (req, res) => {
  try {
    const db  = getDb();
    const id  = String(req.body.item_id);
    const row = db.prepare('SELECT subscribed_items FROM flight_prefs WHERE discord_id = ?')
      .get(req.params.discordId);
    if (!row) return res.status(404).json({ error: 'User not set up. Run /flightsetup first.' });

    let subs = JSON.parse(row.subscribed_items || '[]').map(String);
    if (req.body.subscribed && !subs.includes(id)) subs.push(id);
    if (!req.body.subscribed) subs = subs.filter(s => s !== id);

    db.prepare('UPDATE flight_prefs SET subscribed_items = ?, updated_at = ? WHERE discord_id = ?')
      .run(JSON.stringify(subs), now(), req.params.discordId);

    res.json({ success: true, subscribed_items: subs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/flight-prefs — all users with active subscriptions ───────────────
// Protected: internal key required
router.get('/', internalAuth, (req, res) => {
  try {
    const rows = getDb().prepare("SELECT * FROM flight_prefs WHERE subscribed_items != '[]'").all();
    res.json(rows.map(r => ({
      discord_id:       r.discord_id,
      torn_id:          r.torn_id,
      travel_class:     r.travel_class,
      capacity:         r.capacity,
      subscribed_items: JSON.parse(r.subscribed_items || '[]'),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
