const express = require('express');
const router = express.Router();
const {
  claimUnits,
  completeClaim,
  getClaim,
  getPendingPayouts,
  markPayoutSent,
  getContract
} = require('../services/contracts');
const { verifyAttackLog, verifyEscapeLog } = require('../services/tornApi');
const { decrypt } = require('../services/encryption');
const { getDb } = require('../db/schema');

// POST /api/claims - seller claims units (also called by Discord bot)
router.post('/', async (req, res) => {
  try {
    const { contract_id, seller_torn_id, seller_discord_id, quantity_claimed } = req.body;

    const claim = claimUnits(
      parseInt(contract_id),
      String(seller_torn_id),
      seller_discord_id,
      parseInt(quantity_claimed)
    );

    res.json({ success: true, claim });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/claims/:id - get claim details
router.get('/:id', (req, res) => {
  try {
    const claim = getClaim(parseInt(req.params.id));
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    res.json({ success: true, claim });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claims/:id/complete - seller marks done, triggers API verification
router.post('/:id/complete', async (req, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const claim = getClaim(claimId);

    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    if (claim.status !== 'active') {
      return res.status(400).json({ success: false, error: `Claim is ${claim.status}` });
    }

    // Check if claim has expired
    const now = Math.floor(Date.now() / 1000);
    if (now > claim.expires_at) {
      return res.status(400).json({ success: false, error: 'Claim has expired (30 min window passed)' });
    }

    const contract = getContract(claim.contract_id);

    // Get seller's encrypted API key
    const db = getDb();
    const seller = db.prepare(`SELECT * FROM users WHERE torn_id = ?`).get(claim.seller_torn_id);

    if (!seller?.encrypted_api_key) {
      return res.status(400).json({
        success: false,
        error: 'Seller API key not found. Please re-verify in Discord.'
      });
    }

    const apiKey = decrypt(seller.encrypted_api_key);

    // Verify based on contract type
    let verification;
    if (contract.type === 'loss') {
      verification = await verifyAttackLog(
        apiKey,
        contract.target_torn_id,
        claim.quantity_claimed,
        claim.claimed_at
      );
    } else if (contract.type === 'escape') {
      verification = await verifyEscapeLog(
        apiKey,
        contract.buyer_torn_id,
        claim.quantity_claimed,
        claim.claimed_at
      );
    } else if (contract.type === 'bounty') {
      // For bounties: check attack log against target
      verification = await verifyAttackLog(
        apiKey,
        contract.target_torn_id,
        claim.quantity_claimed,
        claim.claimed_at
      );
    }

    if (!verification.verified) {
      return res.status(400).json({
        success: false,
        error: `Verification failed. Found ${verification.count}/${verification.needed} confirmed actions.`,
        details: verification
      });
    }

    // Complete the claim
    const result = completeClaim(claimId);

    // Notify Discord bot to ping payout queue
    if (global.discordBot) {
      global.discordBot.emit('payout_ready', {
        claim: result.claim,
        contract: result.contract,
        seller_torn_id: claim.seller_torn_id
      });
    }

    res.json({
      success: true,
      message: 'Verified! Payout has been queued.',
      payout_amount: claim.payout_amount,
      claim: result.claim
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/payouts - admin: get pending payouts
router.get('/payouts/pending', (req, res) => {
  try {
    const payouts = getPendingPayouts();
    res.json({ success: true, payouts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/payouts/:id/sent - admin: mark payout as sent
router.post('/payouts/:id/sent', (req, res) => {
  try {
    const payout = markPayoutSent(parseInt(req.params.id));
    res.json({ success: true, payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
