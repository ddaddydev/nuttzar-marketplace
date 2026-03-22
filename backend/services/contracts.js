// backend/services/contracts.js
const { getDb } = require('../db/schema');
const { v4: uuid } = require('uuid');

const FEE = 0.10;

const CLAIM_LIMITS = { loss: 15, escape: 15, bounty: 10 };
const MIN_PRICES   = { loss: 250000, escape: 350000, bounty: 50000 };

// ── Pricing ───────────────────────────────────────────────────────────────────
function calculatePricing(type, sellerPricePerUnit, quantity, bountyAmount = 0) {
  const gross        = Math.ceil(sellerPricePerUnit / (1 - FEE));
  const totalPerUnit = type === 'bounty' ? gross + bountyAmount : gross;
  const total        = totalPerUnit * quantity;
  const sellerTotal  = sellerPricePerUnit * quantity;
  return {
    seller_price_per_unit:  sellerPricePerUnit,
    buyer_price_per_unit:   gross,
    bounty_amount:          bountyAmount,
    total_buyer_pays:       total,
    total_seller_receives:  sellerTotal,
    fee_amount:             total - sellerTotal - (bountyAmount * quantity),
    quantity,
  };
}

// ── Create ────────────────────────────────────────────────────────────────────
function createContract(data) {
  const {
    type, buyer_torn_id, buyer_torn_name, target_torn_id, target_torn_name,
    seller_price_per_unit, quantity, bounty_amount = 0,
  } = data;

  if (seller_price_per_unit < MIN_PRICES[type])
    throw new Error(`Minimum price for ${type} is ${MIN_PRICES[type].toLocaleString()}`);

  const pricing = calculatePricing(type, seller_price_per_unit, quantity, bounty_amount);
  const id      = uuid();

  const result = getDb().prepare(`
    INSERT INTO contracts (uuid, type, buyer_torn_id, buyer_torn_name, target_torn_id, target_torn_name,
      price_per_unit, buyer_price_per_unit, bounty_amount, quantity, quantity_remaining, total_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, type, buyer_torn_id, buyer_torn_name, target_torn_id, target_torn_name,
    pricing.seller_price_per_unit, pricing.buyer_price_per_unit, bounty_amount,
    quantity, quantity, pricing.total_buyer_pays,
  );

  logEvent('contract_created', result.lastInsertRowid, null, buyer_torn_id, { type, quantity, pricing });
  return getContract(result.lastInsertRowid);
}

// ── Activate ──────────────────────────────────────────────────────────────────
function activateContract(contractId) {
  getDb().prepare(`
    UPDATE contracts SET status='active', payment_confirmed=1,
      payment_confirmed_at=unixepoch(), updated_at=unixepoch()
    WHERE id = ?
  `).run(contractId);
  logEvent('contract_activated', contractId, null, null, {});
  return getContract(contractId);
}

// ── Read ──────────────────────────────────────────────────────────────────────
function getActiveContracts(type = null) {
  const db    = getDb();
  const query = `SELECT * FROM contracts WHERE status='active'${type ? ' AND type=?' : ''} ORDER BY created_at DESC`;
  return type ? db.prepare(query).all(type) : db.prepare(query).all();
}

function getContract(id)      { return getDb().prepare('SELECT * FROM contracts WHERE id = ?').get(id); }
function getContractByUuid(u) { return getDb().prepare('SELECT * FROM contracts WHERE uuid = ?').get(u); }

// ── Claim ─────────────────────────────────────────────────────────────────────
function claimUnits(contractId, sellerTornId, sellerDiscordId, quantityClaimed) {
  const db       = getDb();
  const contract = getContract(contractId);

  if (!contract)                    throw new Error('Contract not found');
  if (contract.status !== 'active') throw new Error('Contract is not active');

  const limit = CLAIM_LIMITS[contract.type];
  if (quantityClaimed > limit)                       throw new Error(`Max claim for ${contract.type} is ${limit}`);
  if (quantityClaimed > contract.quantity_remaining) throw new Error(`Only ${contract.quantity_remaining} units remaining`);

  const existing = db.prepare(`
    SELECT * FROM claims WHERE contract_id=? AND seller_torn_id=? AND status='active'
  `).get(contractId, sellerTornId);
  if (existing) throw new Error('You already have an active claim on this contract. Complete it first.');

  const expiresAt    = Math.floor(Date.now() / 1000) + 1800;
  const payoutAmount = contract.price_per_unit * quantityClaimed;

  const result = db.prepare(`
    INSERT INTO claims (contract_id, seller_torn_id, seller_discord_id, quantity_claimed, expires_at, payout_amount)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(contractId, sellerTornId, sellerDiscordId, quantityClaimed, expiresAt, payoutAmount);

  db.prepare(`UPDATE contracts SET quantity_remaining=quantity_remaining-?, updated_at=unixepoch() WHERE id=?`)
    .run(quantityClaimed, contractId);

  logEvent('claim_created', contractId, result.lastInsertRowid, sellerTornId, { quantityClaimed, expiresAt });
  return getClaim(result.lastInsertRowid);
}

// ── Complete (full) ───────────────────────────────────────────────────────────
function completeClaim(claimId) {
  return completeClaimPartial(claimId, null);
}

// ── Complete (partial) ────────────────────────────────────────────────────────
function completeClaimPartial(claimId, verifiedCount) {
  const db    = getDb();
  const claim = getClaim(claimId);
  if (!claim)                    throw new Error('Claim not found');
  if (claim.status !== 'active') throw new Error('Claim is not active');

  const credited     = verifiedCount === null ? claim.quantity_claimed : Math.min(verifiedCount, claim.quantity_claimed);
  const returned     = claim.quantity_claimed - credited;
  const payoutAmount = Math.round((claim.payout_amount / claim.quantity_claimed) * credited);

  db.prepare(`UPDATE claims SET status='completed', completed_at=unixepoch(), quantity_verified=?, payout_amount=? WHERE id=?`)
    .run(credited, payoutAmount, claimId);

  if (credited > 0) {
    db.prepare(`INSERT INTO payouts (claim_id, contract_id, seller_torn_id, amount) VALUES (?, ?, ?, ?)`)
      .run(claimId, claim.contract_id, claim.seller_torn_id, payoutAmount);
  }

  db.prepare(`UPDATE contracts SET quantity_completed=quantity_completed+?, updated_at=unixepoch() WHERE id=?`)
    .run(credited, claim.contract_id);

  if (returned > 0) {
    db.prepare(`UPDATE contracts SET quantity_remaining=quantity_remaining+?, updated_at=unixepoch() WHERE id=?`)
      .run(returned, claim.contract_id);
  }

  const updated = getContract(claim.contract_id);
  if (updated.quantity_completed >= updated.quantity) {
    db.prepare(`UPDATE contracts SET status='completed', updated_at=unixepoch() WHERE id=?`).run(claim.contract_id);
  }

  logEvent('claim_completed', claim.contract_id, claimId, claim.seller_torn_id, { credited, returned, payout: payoutAmount });
  return {
    claim:         getClaim(claimId),
    contract:      getContract(claim.contract_id),
    credited,
    returned,
    payout_amount: payoutAmount,
    partial:       returned > 0,
  };
}

// ── Expire stale claims (cron) ────────────────────────────────────────────────
function expireStaleClaims() {
  const db      = getDb();
  const now     = Math.floor(Date.now() / 1000);
  const expired = db.prepare(`SELECT * FROM claims WHERE status='active' AND expires_at<?`).all(now);

  for (const claim of expired) {
    db.prepare(`UPDATE claims SET status='expired' WHERE id=?`).run(claim.id);
    db.prepare(`UPDATE contracts SET quantity_remaining=quantity_remaining+?, updated_at=unixepoch() WHERE id=?`)
      .run(claim.quantity_claimed, claim.contract_id);
    logEvent('claim_expired', claim.contract_id, claim.id, claim.seller_torn_id, {});
  }

  return expired;
}

// ── Payouts ───────────────────────────────────────────────────────────────────
function markPayoutSent(payoutId) {
  const db = getDb();
  db.prepare(`UPDATE payouts SET status='sent', sent_at=unixepoch() WHERE id=?`).run(payoutId);
  const payout = db.prepare('SELECT * FROM payouts WHERE id=?').get(payoutId);
  db.prepare(`UPDATE claims SET payout_sent=1, payout_sent_at=unixepoch() WHERE id=?`).run(payout.claim_id);
  return payout;
}

function getPendingPayouts() {
  return getDb().prepare(`
    SELECT p.*, c.type as contract_type, c.target_torn_id, c.target_torn_name
    FROM payouts p JOIN contracts c ON p.contract_id=c.id
    WHERE p.status='pending' ORDER BY p.created_at ASC
  `).all();
}

function getClaim(id) { return getDb().prepare('SELECT * FROM claims WHERE id=?').get(id); }

// ── Event log ─────────────────────────────────────────────────────────────────
function logEvent(eventType, contractId, claimId, tornId, details) {
  try {
    getDb().prepare(`INSERT INTO transaction_log (event_type,contract_id,claim_id,torn_id,details) VALUES (?,?,?,?,?)`)
      .run(eventType, contractId, claimId, tornId, JSON.stringify(details));
  } catch (e) { console.error('[LOG]', e.message); }
}

module.exports = {
  calculatePricing, createContract, activateContract, getActiveContracts,
  getContract, getContractByUuid, claimUnits, completeClaim, completeClaimPartial,
  expireStaleClaims, markPayoutSent, getClaim, getPendingPayouts,
  CLAIM_LIMITS, MIN_PRICES, FEE,
};
