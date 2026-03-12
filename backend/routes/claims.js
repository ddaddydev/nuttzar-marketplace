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
const { verifyAttackLog, verifyEscapeLog, verifyBountyLog } = require('../services/tornApi');
const { decrypt } = require('../services/encryption');
const { getDb } = require('../db/schema');

// POST /api/claims
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

// GET /api/claims/:id
router.get('/:id', (req, res) => {
  try {
    const claim = getClaim(parseInt(req.params.id));
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    res.json({ success: true, claim });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claims/:id/complete
router.post('/:id/complete', async (req, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const claim = getClaim(claimId);

    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    if (claim.status !== 'active') {
      return res.status(400).json({ success: false, error: `Claim is ${claim.status}` });
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > claim.expires_at) {
      return res.status(400).json({ success: false, error: 'Claim has expired (30 min window passed)' });
    }

    const contract = getContract(claim.contract_id);
    const db = getDb();

    const seller = db.prepare(`SELECT * FROM users WHERE torn_id = ?`).get(claim.seller_torn_id);
    if (!seller?.encrypted_api_key) {
      return res.status(400).json({
        success: false,
        error: 'Seller API key not found. Please re-verify in Discord.'
      });
    }

    const apiKey = decrypt(seller.encrypted_api_key);
    const sellerName = seller.torn_name || claim.seller_torn_id;

    let verification;

    if (contract.type === 'loss') {
      verification = await verifyAttackLog(
        apiKey, contract.target_torn_id, claim.quantity_claimed,
        claim.claimed_at, sellerName, contract.id, claimId, db
      );
    } else if (contract.type === 'escape') {
      verification = await verifyEscapeLog(
        apiKey, contract.buyer_torn_id, claim.quantity_claimed,
        claim.claimed_at, sellerName, contract.id, claimId, db
      );
    } else if (contract.type === 'bounty') {
      verification = await verifyBountyLog(
        apiKey, contract.target_torn_id, claim.quantity_claimed,
        claim.claimed_at, sellerName, contract.id, claimId, db
      );
    }

    // Nothing verified at all
    if (verification.count === 0) {
      return res.status(400).json({
        success: false,
        error: `No completed actions found. Found ${verification.count}/${verification.needed}.`
      });
    }

    // Partial completion — credit what they did, return the rest to the pool
    if (verification.partial) {
      const credited = verification.count;
      const returned = claim.quantity_claimed - credited;
      const partialPayout = Math.floor((claim.payout_amount / claim.quantity_claimed) * credited);

      // Update claim to reflect partial
      db.prepare(`
        UPDATE claims SET
          quantity_claimed = ?,
          quantity_verified = ?,
          payout_amount = ?,
          status = 'partial',
          completed_at = unixepoch()
        WHERE id = ?
      `).run(credited, credited, partialPayout, claimId);

      // Return unfinished units back to the contract pool
      db.prepare(`
        UPDATE contracts SET
          quantity_remaining = quantity_remaining + ?,
          updated_at = unixepoch()
        WHERE id = ?
      `).run(returned, contract.id);

      // Queue partial payout
      db.prepare(`
        INSERT INTO payouts (claim_id, contract_id, seller_torn_id, seller_torn_name, amount, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(claimId, contract.id, claim.seller_torn_id, sellerName, partialPayout);

      if (global.discordBot) {
        global.discordBot.emit('payout_ready', {
          claim: getClaim(claimId),
          contract,
          seller_torn_id: claim.seller_torn_id
        });
      }

      return res.json({
        success: true,
        partial: true,
        message: `Partial completion: verified ${credited}/${claim.quantity_claimed} units. ${returned} unit(s) returned to the pool.`,
        credited,
        returned,
        payout_amount: partialPayout,
        claim: getClaim(claimId)
      });
    }

    // Full completion
    const result = completeClaim(claimId);

    if (global.discordBot) {
      global.discordBot.emit('payout_ready', {
        claim: result.claim,
        contract: result.contract,
        seller_torn_id: claim.seller_torn_id
      });
    }

    res.json({
      success: true,
      partial: false,
      message: 'Verified! Payout has been queued.',
      payout_amount: claim.payout_amount,
      claim: result.claim
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/claims/payouts/pending
router.get('/payouts/pending', (req, res) => {
  try {
    const payouts = getPendingPayouts();
    res.json({ success: true, payouts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claims/payouts/:id/sent
router.post('/payouts/:id/sent', (req, res) => {
  try {
    const payout = markPayoutSent(parseInt(req.params.id));
    res.json({ success: true, payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
