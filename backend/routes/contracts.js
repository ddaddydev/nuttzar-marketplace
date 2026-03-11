const express = require('express');
const router = express.Router();
const { verifyApiKey, verifyPayment } = require('../services/tornApi');
const { encrypt } = require('../services/encryption');
const {
  calculatePricing,
  createContract,
  activateContract,
  getActiveContracts,
  getContract,
  getContractByUuid,
  MIN_PRICES,
  FEE
} = require('../services/contracts');
const { getDb } = require('../db/schema');

// GET /api/contracts - list active contracts (optionally filter by type)
router.get('/', (req, res) => {
  try {
    const { type } = req.query;
    const contracts = getActiveContracts(type);
    res.json({ success: true, contracts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/contracts/:uuid - get single contract
router.get('/:uuid', (req, res) => {
  try {
    const contract = getContractByUuid(req.params.uuid);
    if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
    res.json({ success: true, contract });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contracts/calculate - preview pricing before checkout
router.post('/calculate', (req, res) => {
  try {
    const { type, seller_price_per_unit, quantity, bounty_amount = 0 } = req.body;

    if (!['loss', 'bounty', 'escape'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid contract type' });
    }

    const minPrice = MIN_PRICES[type];
    if (seller_price_per_unit < minPrice) {
      return res.status(400).json({
        success: false,
        error: `Minimum seller price for ${type} is ${minPrice.toLocaleString()}`
      });
    }

    const pricing = calculatePricing(type, seller_price_per_unit, quantity, bounty_amount);
    res.json({ success: true, pricing });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/contracts/checkout - buyer submits contract + api key
router.post('/checkout', async (req, res) => {
  try {
    const {
      type,
      seller_price_per_unit,
      quantity,
      bounty_amount = 0,
      target_torn_id,
      buyer_api_key
    } = req.body;

    if (!buyer_api_key) {
      return res.status(400).json({ success: false, error: 'API key required' });
    }

    // Verify buyer identity
    const tornCheck = await verifyApiKey(buyer_api_key);
    if (!tornCheck.valid) {
      return res.status(400).json({ success: false, error: `Invalid API key: ${tornCheck.error}` });
    }

    // Validate pricing
    const minPrice = MIN_PRICES[type];
    if (seller_price_per_unit < minPrice) {
      return res.status(400).json({
        success: false,
        error: `Minimum seller price for ${type} is ${minPrice.toLocaleString()}`
      });
    }

    const pricing = calculatePricing(type, seller_price_per_unit, quantity, bounty_amount);

    // Create contract (pending payment)
    const contract = createContract({
      type,
      buyer_torn_id: tornCheck.torn_id,
      buyer_torn_name: tornCheck.torn_name,
      target_torn_id: target_torn_id || tornCheck.torn_id,
      target_torn_name: tornCheck.torn_name,
      seller_price_per_unit,
      quantity,
      bounty_amount
    });

    // Store encrypted buyer API key for payment verification
    const db = getDb();
    const encryptedKey = encrypt(buyer_api_key);
    db.prepare(`
      INSERT INTO users (torn_id, torn_name, encrypted_api_key, role, is_verified)
      VALUES (?, ?, ?, 'buyer', 1)
      ON CONFLICT(torn_id) DO UPDATE SET
        torn_name = excluded.torn_name,
        encrypted_api_key = excluded.encrypted_api_key,
        updated_at = unixepoch()
    `).run(tornCheck.torn_id, tornCheck.torn_name, encryptedKey);

    res.json({
      success: true,
      contract_uuid: contract.uuid,
      contract_id: contract.id,
      buyer_name: tornCheck.torn_name,
      pricing,
      payment_instructions: {
        send_to: 'Nuttzar [4042794]',
        amount: pricing.total_buyer_pays,
        message: `Contract #${contract.id}`,
        note: 'Send the EXACT amount shown. Payment is verified automatically via your Torn API.'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contracts/:uuid/verify-payment - check if buyer sent payment
router.post('/:uuid/verify-payment', async (req, res) => {
  try {
    const contract = getContractByUuid(req.params.uuid);
    if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });
    if (contract.payment_confirmed) {
      return res.json({ success: true, already_confirmed: true, contract });
    }

    // Get buyer's encrypted API key
    const db = getDb();
    const user = db.prepare(`SELECT * FROM users WHERE torn_id = ?`).get(contract.buyer_torn_id);
    if (!user?.encrypted_api_key) {
      return res.status(400).json({ success: false, error: 'Buyer API key not found' });
    }

    const { decrypt } = require('../services/encryption');
    const apiKey = decrypt(user.encrypted_api_key);

    const paymentCheck = await verifyPayment(apiKey, contract.total_amount);
    if (!paymentCheck.verified) {
      return res.status(400).json({ success: false, error: paymentCheck.error });
    }

    // Activate contract
    const activated = activateContract(contract.id);

    // Notify Discord bot (via internal event)
    if (global.discordBot) {
      global.discordBot.emit('contract_activated', activated);
    }

    res.json({ success: true, contract: activated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
