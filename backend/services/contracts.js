const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

const FEE = 0.10; // 10%

const CLAIM_LIMITS = {
  loss: 15,
  escape: 15,
  bounty: 10
};

const MIN_PRICES = {
  loss: 250000,
  escape: 350000,
  bounty: 50000 // per slot, before bounty amount added
};

// Calculate pricing
function calculatePricing(type, sellerPricePerUnit, quantity, bountyAmount = 0) {
  const gross = Math.ceil(sellerPricePerUnit / (1 - FEE)); // buyer pays this
  const totalPerUnit = type === 'bounty' ? gross + bountyAmount : gross;
  const total = totalPerUnit * quantity;
  const sellerTotal = sellerPricePerUnit * quantity;

  return {
    seller_price_per_unit: sellerPricePerUnit,
    buyer_price_per_unit: gross,
    bounty_amount: bountyAmount,
    total_buyer_pays: total,
    total_seller_receives: sellerTotal,
    fee_amount: total - sellerTotal - (bountyAmount * quantity),
    quantity
  };
}

// Create a new contract
function createContract(data) {
  const db = getDb();
  const {
    type,
    buyer_torn_id,
    buyer_torn_name,
    target_torn_id,
    target_torn_name,
    seller_price_per_unit,
    quantity,
    bounty_amount = 0
  } = data;

  // Validate min price
  const minPrice = MIN_PRICES[type];
  if (seller_price_per_unit < minPrice) {
    throw new Error(`Minimum price for ${type} is ${minPrice.toLocaleString()}`);
  }

  const pricing = calculatePricing(type, seller_price_per_unit, quantity, bounty_amount);
  const uuid = uuidv4();

  const stmt = db.prepare(`
    INSERT INTO contracts (
      uuid, type, buyer_torn_id, buyer_torn_name,
      target_torn_id, target_torn_name,
      price_per_unit, buyer_price_per_unit, bounty_amount,
      quantity, quantity_remaining, total_amount
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const result = stmt.run(
    uuid, type, buyer_torn_id, buyer_torn_name,
    target_torn_id, target_torn_name,
    pricing.seller_price_per_unit, pricing.buyer_price_per_unit, bounty_amount,
    quantity, quantity, pricing.total_buyer_pays
  );

  logEvent('contract_created', result.lastInsertRowid, null, buyer_torn_id, { type, quantity, pricing });

  return getContract(result.lastInsertRowid);
}

// Activate contract after payment verified
function activateContract(contractId) {
  const db = getDb();
  db.prepare(`
    UPDATE contracts SET
      status = 'active',
      payment_confirmed = 1,
      payment_confirmed_at = unixepoch(),
      updated_at = unixepoch()
    WHERE id = ?
  `).run(contractId);

  logEvent('contract_activated', contractId, null, null, {});
  return getContract(contractId);
}

// Get all active contracts (for Discord embeds)
function getActiveContracts(type = null) {
  const db = getDb();
  let query = `SELECT * FROM contracts WHERE status = 'active'`;
  if (type) query += ` AND type = ?`;
  query += ` ORDER BY created_at DESC`;

  return type ? db.prepare(query).all(type) : db.prepare(query).all();
}

function getContract(id) {
  return getDb().prepare(`SELECT * FROM contracts WHERE id = ?`).get(id);
}

function getContractByUuid(uuid) {
  return getDb().prepare(`SELECT * FROM contracts WHERE uuid = ?`).get(uuid);
}

// Claim units from a contract
function claimUnits(contractId, sellerTornId, sellerDiscordId, quantityClaimed) {
  const db = getDb();
  const contract = getContract(contractId);

  if (!contract) throw new Error('Contract not found');
  if (contract.status !== 'active') throw new Error('Contract is not active');

  const limit = CLAIM_LIMITS[contract.type];
  if (quantityClaimed > limit) {
    throw new Error(`Maximum claim for ${contract.type} is ${limit} units`);
  }
  if (quantityClaimed > contract.quantity_remaining) {
    throw new Error(`Only ${contract.quantity_remaining} units remaining`);
  }

  // Check seller doesn't already have active claims on this contract
  const existingClaim = db.prepare(`
    SELECT * FROM claims
    WHERE contract_id = ? AND seller_torn_id = ? AND status = 'active'
  `).get(contractId, sellerTornId);

  if (existingClaim) {
    throw new Error('You already have an active claim on this contract. Complete it first.');
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 1800; // 30 min

  const claimStmt = db.prepare(`
    INSERT INTO claims (contract_id, seller_torn_id, seller_discord_id, quantity_claimed, expires_at, payout_amount)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const payoutAmount = contract.price_per_unit * quantityClaimed;
  const claimResult = claimStmt.run(
    contractId, sellerTornId, sellerDiscordId, quantityClaimed, expiresAt, payoutAmount
  );

  // Reserve units
  db.prepare(`
    UPDATE contracts SET
      quantity_remaining = quantity_remaining - ?,
      updated_at = unixepoch()
    WHERE id = ?
  `).run(quantityClaimed, contractId);

  logEvent('claim_created', contractId, claimResult.lastInsertRowid, sellerTornId, { quantityClaimed, expiresAt });

  return getClaim(claimResult.lastInsertRowid);
}

// Complete a claim (triggered by seller clicking "Click when completed")
function completeClaim(claimId) {
  const db = getDb();
  const claim = getClaim(claimId);
  if (!claim) throw new Error('Claim not found');
  if (claim.status !== 'active') throw new Error('Claim is not active');

  db.prepare(`
    UPDATE claims SET status = 'completed', completed_at = unixepoch()
    WHERE id = ?
  `).run(claimId);

  // Add to payout queue
  const contract = getContract(claim.contract_id);
  db.prepare(`
    INSERT INTO payouts (claim_id, contract_id, seller_torn_id, amount)
    VALUES (?, ?, ?, ?)
  `).run(claimId, claim.contract_id, claim.seller_torn_id, claim.payout_amount);

  // Update contract completed count
  db.prepare(`
    UPDATE contracts SET
      quantity_completed = quantity_completed + ?,
      updated_at = unixepoch()
    WHERE id = ?
  `).run(claim.quantity_claimed, claim.contract_id);

  // Check if contract is fully completed
  const updatedContract = getContract(claim.contract_id);
  if (updatedContract.quantity_completed >= updatedContract.quantity) {
    db.prepare(`UPDATE contracts SET status = 'completed', updated_at = unixepoch() WHERE id = ?`)
      .run(claim.contract_id);
  }

  logEvent('claim_completed', claim.contract_id, claimId, claim.seller_torn_id, { payout: claim.payout_amount });

  return { claim: getClaim(claimId), contract: getContract(claim.contract_id) };
}

// Expire stale claims (run via cron)
function expirestaleClaims() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const expired = db.prepare(`
    SELECT * FROM claims WHERE status = 'active' AND expires_at < ?
  `).all(now);

  for (const claim of expired) {
    db.prepare(`UPDATE claims SET status = 'expired' WHERE id = ?`).run(claim.id);

    // Release units back to contract
    db.prepare(`
      UPDATE contracts SET
        quantity_remaining = quantity_remaining + ?,
        updated_at = unixepoch()
      WHERE id = ?
    `).run(claim.quantity_claimed, claim.contract_id);

    logEvent('claim_expired', claim.contract_id, claim.id, claim.seller_torn_id, {});
  }

  return expired;
}

// Mark payout as sent (you call this after paying)
function markPayoutSent(payoutId) {
  const db = getDb();
  db.prepare(`
    UPDATE payouts SET status = 'sent', sent_at = unixepoch() WHERE id = ?
  `).run(payoutId);

  const payout = db.prepare(`SELECT * FROM payouts WHERE id = ?`).get(payoutId);
  db.prepare(`
    UPDATE claims SET payout_sent = 1, payout_sent_at = unixepoch() WHERE id = ?
  `).run(payout.claim_id);

  return payout;
}

function getClaim(id) {
  return getDb().prepare(`SELECT * FROM claims WHERE id = ?`).get(id);
}

function getPendingPayouts() {
  return getDb().prepare(`
    SELECT p.*, c.type as contract_type, c.target_torn_id, c.target_torn_name
    FROM payouts p
    JOIN contracts c ON p.contract_id = c.id
    WHERE p.status = 'pending'
    ORDER BY p.created_at ASC
  `).all();
}

function logEvent(eventType, contractId, claimId, tornId, details) {
  try {
    getDb().prepare(`
      INSERT INTO transaction_log (event_type, contract_id, claim_id, torn_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventType, contractId, claimId, tornId, JSON.stringify(details));
  } catch (e) {
    console.error('[LOG ERROR]', e.message);
  }
}

module.exports = {
  calculatePricing,
  createContract,
  activateContract,
  getActiveContracts,
  getContract,
  getContractByUuid,
  claimUnits,
  completeClaim,
  expirestaleClaims,
  markPayoutSent,
  getClaim,
  getPendingPayouts,
  CLAIM_LIMITS,
  MIN_PRICES,
  FEE
};
