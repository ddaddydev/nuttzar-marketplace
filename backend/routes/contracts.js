const express      = require('express');
const router       = express.Router();
const { verifyApiKey, verifyPayment } = require('../services/tornApi');
const { encrypt }  = require('../services/encryption');
const internalAuth = require('../middleware/internalAuth');
const {
  calculatePricing, createContract, activateContract,
  getActiveContracts, getContract, getContractByUuid, MIN_PRICES,
} = require('../services/contracts');
const { getDb } = require('../db/schema');

// ── GET /api/contracts ────────────────────────────────────────────────────────
// Public — list active contracts (optionally filter by type)
router.get('/', (req, res) => {
  try {
    const { type } = req.query;
    if (type && !['loss','bounty','escape'].includes(type))
      return res.status(400).json({ success: false, error: 'Invalid type' });
    res.json({ success: true, contracts: getActiveContracts(type) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/contracts/:id — by numeric ID or UUID ───────────────────────────
router.get('/:id', (req, res) => {
  try {
    const id = req.params.id;
    // Numeric ID lookup (used by bot pollPayouts)
    if (/^\d+$/.test(id)) {
      const contract = getContract(parseInt(id));
      if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
      return res.json({ success: true, contract });
    }
    // UUID lookup (used by frontend)
    const contract = getContractByUuid(id);
    if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
    res.json({ success: true, contract });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/contracts/calculate ────────────────────────────────────────────
// Public — preview pricing before checkout
router.post('/calculate', (req, res) => {
  try {
    const { type, seller_price_per_unit, quantity, bounty_amount = 0 } = req.body;
    if (!['loss','bounty','escape'].includes(type))
      return res.status(400).json({ success: false, error: 'Invalid contract type' });
    if (!Number.isInteger(quantity) || quantity < 1)
      return res.status(400).json({ success: false, error: 'Invalid quantity' });
    if (!Number.isInteger(seller_price_per_unit) || seller_price_per_unit < MIN_PRICES[type])
      return res.status(400).json({ success: false, error: `Minimum price for ${type} is ${MIN_PRICES[type].toLocaleString()}` });

    res.json({ success: true, pricing: calculatePricing(type, seller_price_per_unit, quantity, bounty_amount) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ── POST /api/contracts/checkout ─────────────────────────────────────────────
// Public — buyer submits contract + api key
router.post('/checkout', async (req, res) => {
  try {
    const { type, seller_price_per_unit, quantity, bounty_amount = 0, target_torn_id, buyer_api_key } = req.body;

    if (!buyer_api_key)
      return res.status(400).json({ success: false, error: 'API key required' });
    if (!['loss','bounty','escape'].includes(type))
      return res.status(400).json({ success: false, error: 'Invalid contract type' });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      return res.status(400).json({ success: false, error: 'Invalid quantity (1–100)' });
    if (!Number.isInteger(seller_price_per_unit) || seller_price_per_unit < MIN_PRICES[type])
      return res.status(400).json({ success: false, error: `Minimum price for ${type} is ${MIN_PRICES[type].toLocaleString()}` });

    const tornCheck = await verifyApiKey(buyer_api_key);
    if (!tornCheck.valid)
      return res.status(400).json({ success: false, error: `Invalid API key: ${tornCheck.error}` });

    const pricing  = calculatePricing(type, seller_price_per_unit, quantity, bounty_amount);
    const contract = createContract({
      type, buyer_torn_id: tornCheck.torn_id, buyer_torn_name: tornCheck.torn_name,
      target_torn_id: target_torn_id || tornCheck.torn_id,
      target_torn_name: tornCheck.torn_name,
      seller_price_per_unit, quantity, bounty_amount,
    });

    // Store encrypted buyer API key for payment verification
    getDb().prepare(`
      INSERT INTO users (torn_id, torn_name, encrypted_api_key, role, is_verified)
      VALUES (?, ?, ?, 'buyer', 1)
      ON CONFLICT(torn_id) DO UPDATE SET
        torn_name         = excluded.torn_name,
        encrypted_api_key = excluded.encrypted_api_key,
        updated_at        = unixepoch()
    `).run(tornCheck.torn_id, tornCheck.torn_name, encrypt(buyer_api_key));

    res.json({
      success: true, contract_uuid: contract.uuid, contract_id: contract.id,
      buyer_name: tornCheck.torn_name, pricing,
      payment_instructions: {
        send_to: 'Brxxntt [4042794]', amount: pricing.total_buyer_pays,
        message: `Contract #${contract.id}`,
        note: 'Send the EXACT amount shown. Payment is verified automatically via your Torn API.',
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/contracts/:uuid/verify-payment ─────────────────────────────────
// Public — check if buyer sent payment
router.post('/:uuid/verify-payment', async (req, res) => {
  try {
    const contract = getContractByUuid(req.params.uuid);
    if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
    if (contract.payment_confirmed) return res.json({ success: true, already_confirmed: true, contract });

    const user = getDb().prepare('SELECT * FROM users WHERE torn_id = ?').get(contract.buyer_torn_id);
    if (!user?.encrypted_api_key)
      return res.status(400).json({ success: false, error: 'Buyer API key not found' });

    const { decrypt } = require('../services/encryption');
    const paymentCheck = await verifyPayment(decrypt(user.encrypted_api_key), contract.total_amount);
    if (!paymentCheck.verified)
      return res.status(400).json({ success: false, error: paymentCheck.error });

    const activated = activateContract(contract.id);
    if (global.discordBot) global.discordBot.emit('contract_activated', activated);

    res.json({ success: true, contract: activated });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/contracts/test-seed ────────────────────────────────────────────
// Internal only — admin manually creates a contract via /admin-contract
router.post('/test-seed', internalAuth, (req, res) => {
  try {
    const { type, target_torn_id, target_torn_name, buyer_torn_id, quantity_total, price_per_unit, status } = req.body;

    if (!['loss','bounty','escape'].includes(type))
      return res.status(400).json({ success: false, error: 'Invalid type' });
    const qty   = parseInt(quantity_total);
    const price = parseInt(price_per_unit);
    if (isNaN(qty) || qty < 1)     return res.status(400).json({ success: false, error: 'Invalid quantity' });
    if (isNaN(price) || price < 1) return res.status(400).json({ success: false, error: 'Invalid price' });

    const bountyAmt = parseInt(req.body.bounty_amount) || 0;
    const contract = createContract({
      type, buyer_torn_id: String(buyer_torn_id),
      buyer_torn_name: 'Admin', target_torn_id: String(target_torn_id),
      target_torn_name: String(target_torn_name),
      seller_price_per_unit: price, quantity: qty, bounty_amount: bountyAmt,
    });

    // Immediately activate if requested
    if (status === 'active') {
      const activated = activateContract(contract.id);
      if (global.discordBot) global.discordBot.emit('contract_activated', activated);
      return res.json({ success: true, contract: activated });
    }

    res.json({ success: true, contract });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/contracts/:id/cancel ───────────────────────────────────────────
// Internal only — admin cancels a contract, expiring all active claims
router.post('/:id/cancel', internalAuth, (req, res) => {
  try {
    const id       = parseInt(req.params.id);
    const contract = getContract(id);
    if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
    if (contract.status === 'completed') return res.status(400).json({ success: false, error: 'Contract already completed' });

    const db = getDb();

    // Expire all active claims and return units to pool
    const activeClaims = db.prepare(`SELECT * FROM claims WHERE contract_id = ? AND status = 'active'`).all(id);
    for (const claim of activeClaims) {
      db.prepare(`UPDATE claims SET status = 'expired' WHERE id = ?`).run(claim.id);
      db.prepare(`UPDATE contracts SET quantity_remaining = quantity_remaining + ?, updated_at = unixepoch() WHERE id = ?`)
        .run(claim.quantity_claimed, id);
      if (global.discordBot && claim.seller_discord_id) {
        global.discordBot.emit('claim_expired', claim);
      }
    }

    db.prepare(`UPDATE contracts SET status = 'cancelled', updated_at = unixepoch() WHERE id = ?`).run(id);
    res.json({ success: true, type: contract.type, cancelled_claims: activeClaims.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
