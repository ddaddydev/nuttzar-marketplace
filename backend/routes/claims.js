const express      = require('express');
const router       = express.Router();
const internalAuth = require('../middleware/internalAuth');
const {
  claimUnits, completeClaim, completeClaimPartial, getClaim,
  getPendingPayouts, markPayoutSent, getContract,
} = require('../services/contracts');
const { verifyAttackLog, verifyEscapeLog } = require('../services/tornApi');
const { decrypt } = require('../services/encryption');
const { getDb }   = require('../db/schema');

// ── POST /api/claims ──────────────────────────────────────────────────────────
// Seller claims units — called by Discord bot
// Protected: internal key required
router.post('/', internalAuth, async (req, res) => {
  try {
    const { contract_id, seller_torn_id, seller_discord_id, quantity_claimed } = req.body;

    if (!contract_id || !seller_torn_id || !quantity_claimed)
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    if (!Number.isInteger(parseInt(quantity_claimed)) || parseInt(quantity_claimed) < 1)
      return res.status(400).json({ success: false, error: 'Invalid quantity' });

    const claim = claimUnits(parseInt(contract_id), String(seller_torn_id), seller_discord_id, parseInt(quantity_claimed));
    res.json({ success: true, claim });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ── GET /api/claims/active — all active claims (admin) ────────────────────────
// Bug #5: Added this route BEFORE /:id so Express doesn't match "active" as an id
// Protected: internal key required
router.get('/active', internalAuth, (req, res) => {
  try {
    const db = getDb();
    const claims = db.prepare(`
      SELECT cl.id, cl.contract_id, cl.seller_torn_id, cl.seller_discord_id,
             cl.quantity_claimed, cl.payout_amount, cl.claimed_at, cl.expires_at,
             co.type, co.target_torn_name, co.target_torn_id
      FROM claims cl
      JOIN contracts co ON cl.contract_id = co.id
      WHERE cl.status = 'active'
      ORDER BY cl.expires_at ASC
    `).all();
    res.json({ success: true, claims });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/claims/:id ───────────────────────────────────────────────────────
// Protected: internal key required
router.get('/:id', internalAuth, (req, res) => {
  try {
    const claim = getClaim(parseInt(req.params.id));
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    res.json({ success: true, claim });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/claims/:id/complete ─────────────────────────────────────────────
// Seller marks done — triggers Torn API verification
// Protected: internal key required
router.post('/:id/complete', internalAuth, async (req, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const claim   = getClaim(claimId);

    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    if (claim.status !== 'active') return res.status(400).json({ success: false, error: `Claim is ${claim.status}` });
    if (Math.floor(Date.now() / 1000) > claim.expires_at)
      return res.status(400).json({ success: false, error: 'Claim has expired (30 min window passed)' });

    const contract = getContract(claim.contract_id);
    const seller   = getDb().prepare('SELECT * FROM users WHERE torn_id = ?').get(claim.seller_torn_id);

    if (!seller?.encrypted_api_key)
      return res.status(400).json({ success: false, error: 'Seller API key not found. Please re-verify in Discord.' });

    const apiKey = decrypt(seller.encrypted_api_key);

    let verification;
    if (contract.type === 'loss' || contract.type === 'bounty') {
      verification = await verifyAttackLog(apiKey, contract.target_torn_id, claim.quantity_claimed, claim.claimed_at);
    } else if (contract.type === 'escape') {
      verification = await verifyEscapeLog(apiKey, contract.buyer_torn_id, claim.quantity_claimed, claim.claimed_at);
    }

    const { count, needed, wrongOutcomes = 0 } = verification;

    // ── Wrong outcome — seller cheated (won when should lose / didn't escape) ──
    if (wrongOutcomes > 0 && count === 0) {
      if (global.discordBot) {
        global.discordBot.emit('claim_alert', {
          type:     'wrong_outcome',
          claim,
          contract,
          message:  `⚠️ Seller **${claim.seller_torn_id}** completed a **${contract.type}** contract incorrectly. ` +
                    `Found ${wrongOutcomes} attack(s) with the wrong result (e.g. won instead of lost).`,
        });
      }
      return res.status(400).json({
        success: false,
        error: `Verification failed — ${wrongOutcomes} attack(s) found but with wrong outcome. ` +
               `For a ${contract.type} contract you need to ${contract.type === 'escape' ? 'escape' : 'lose'} the fight.`,
      });
    }

    // ── Partial completion — credit what was verified, return rest to pool ────
    if (count > 0 && count < needed) {
      const result = completeClaimPartial(claimId, count);
      if (global.discordBot) {
        // Notify admin of partial — might indicate lazy seller
        global.discordBot.emit('claim_alert', {
          type:     'partial',
          claim,
          contract,
          credited: result.credited,
          returned: result.returned,
          message:  `📦 Partial completion by **${claim.seller_torn_id}** — verified **${result.credited}/${needed}** units. ` +
                    `**${result.returned}** units returned to pool. Payout: $${Number(result.payout_amount).toLocaleString()}.`,
        });
        global.discordBot.emit('payout_ready', {
          claim: result.claim, contract: result.contract, seller_torn_id: claim.seller_torn_id,
        });
      }
      return res.json({
        success: true, partial: true,
        credited: result.credited, returned: result.returned,
        payout_amount: result.payout_amount, claim: result.claim,
        message: `Partial: ${result.credited}/${needed} verified. ${result.returned} units returned to pool.`,
      });
    }

    // ── Zero verified — complete failure ──────────────────────────────────────
    if (count === 0) {
      if (global.discordBot) {
        global.discordBot.emit('claim_alert', {
          type:     'failed',
          claim,
          contract,
          message:  `❌ Seller **${claim.seller_torn_id}** claimed ${needed} ${contract.type}(s) but 0 were verified in their attack log.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: `Verification failed. Found 0/${needed} confirmed actions in your attack log. ` +
               `Make sure you attacked the correct target after claiming.`,
      });
    }

    // ── Full completion ───────────────────────────────────────────────────────
    const result = completeClaim(claimId);
    if (global.discordBot) {
      global.discordBot.emit('payout_ready', {
        claim: result.claim, contract: result.contract, seller_torn_id: claim.seller_torn_id,
      });
    }

    res.json({ success: true, message: 'Verified! Payout queued.', payout_amount: claim.payout_amount, claim: result.claim });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/claims/:id/test-complete ────────────────────────────────────────
// Internal only — admin force-approves a claim via /admin-verify-claim
router.post('/:id/test-complete', internalAuth, (req, res) => {
  try {
    const claimId = parseInt(req.params.id);
    const claim   = getClaim(claimId);
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    if (claim.status !== 'active') return res.status(400).json({ success: false, error: `Claim is ${claim.status}` });

    const result = completeClaim(claimId);
    if (global.discordBot) {
      global.discordBot.emit('payout_ready', {
        claim: result.claim, contract: result.contract, seller_torn_id: claim.seller_torn_id,
      });
    }

    res.json({ success: true, payout_amount: claim.payout_amount, claim: result.claim });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/claims/payouts/pending ──────────────────────────────────────────
// Protected: internal key required
router.get('/payouts/pending', internalAuth, (req, res) => {
  try {
    res.json({ success: true, payouts: getPendingPayouts() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/payouts/:id/sent ────────────────────────────────────────────────
// Protected: internal key required
router.post('/payouts/:id/sent', internalAuth, (req, res) => {
  try {
    const payout = markPayoutSent(parseInt(req.params.id));
    res.json({ success: true, payout });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/claims/:id/cancel ──────────────────────────────────────────────
// Admin force-cancels a claim, returning units to pool
router.post('/:id/cancel', internalAuth, (req, res) => {
  try {
    const db      = getDb();
    const claimId = parseInt(req.params.id);
    const claim   = getClaim(claimId);
    if (!claim)                    return res.status(404).json({ success: false, error: 'Claim not found' });
    if (claim.status !== 'active') return res.status(400).json({ success: false, error: `Claim is already ${claim.status}` });

    db.prepare(`UPDATE claims SET status = 'expired' WHERE id = ?`).run(claimId);
    db.prepare(`UPDATE contracts SET quantity_remaining = quantity_remaining + ?, updated_at = unixepoch() WHERE id = ?`)
      .run(claim.quantity_claimed, claim.contract_id);

    res.json({ success: true, contract_id: claim.contract_id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
