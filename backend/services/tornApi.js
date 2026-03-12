const axios = require('axios');

const TORN_API_BASE = 'https://api.torn.com';
const ADMIN_TORN_ID = '4042794';
const FRAUD_ALERT_CHANNEL = '1481475449182748797';

async function sendFraudAlert(message) {
  try {
    if (global.discordBot) {
      const channel = await global.discordBot.channels.fetch(FRAUD_ALERT_CHANNEL).catch(() => null);
      if (channel) await channel.send(message);
    }
  } catch (err) {
    console.error('[FRAUD ALERT ERROR]', err.message);
  }
}

async function verifyApiKey(apiKey) {
  try {
    const res = await axios.get(`${TORN_API_BASE}/user/?selections=basic&key=${apiKey}`, { timeout: 8000 });
    if (res.data.error) return { valid: false, error: res.data.error.error };
    return {
      valid: true,
      torn_id: String(res.data.player_id),
      torn_name: res.data.name,
      level: res.data.level
    };
  } catch (err) {
    return { valid: false, error: 'Failed to reach Torn API' };
  }
}

async function getTornDiscordLink(tornId, apiKey) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/v2/user/${tornId}/discord?comment=NUTTSERVICE&key=${apiKey}`,
      { timeout: 8000 }
    );
    if (res.data.error) return { linked: false, error: res.data.error.error };
    return { linked: true, discord_id: res.data.discord?.discordID || null, torn_id: String(tornId) };
  } catch (err) {
    return { linked: false, error: 'Failed to reach Torn API' };
  }
}

async function verifyPayment(buyerApiKey, expectedAmount) {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 3600;

    try {
      const v2 = await axios.get(
        `${TORN_API_BASE}/v2/user/log?cat=100&limit=100&key=${buyerApiKey}`,
        { timeout: 8000 }
      );
      if (!v2.data.error) {
        for (const entry of Object.values(v2.data.log || {})) {
          const params = entry.params || {};
          if (
            entry.timestamp >= cutoff &&
            String(params.to_id || params.recipient || '') === ADMIN_TORN_ID &&
            (params.amount === expectedAmount || params.money === expectedAmount)
          ) return { verified: true, entry };
        }
      }
    } catch (_) {}

    const v1 = await axios.get(
      `${TORN_API_BASE}/user/?selections=moneyTransfers&key=${buyerApiKey}`,
      { timeout: 8000 }
    );
    if (v1.data.error) return { verified: false, error: v1.data.error.error };

    for (const transfer of Object.values(v1.data.money_transfers || {})) {
      if (
        transfer.type === 'sent' &&
        String(transfer.to_id) === ADMIN_TORN_ID &&
        transfer.amount === expectedAmount &&
        transfer.timestamp >= cutoff
      ) return { verified: true, transfer };
    }

    return { verified: false, error: 'Payment not found — send the exact amount within the last hour.' };
  } catch (err) {
    return { verified: false, error: 'Failed to reach Torn API' };
  }
}

// Verify loss contract — returns count of valid unused losses
// Partial: if seller did fewer than claimed, credit what they did and return the rest
async function verifyAttackLog(sellerApiKey, targetTornId, requiredCount, afterTimestamp, sellerName, contractId, claimId, db) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/user/?selections=attacks&key=${sellerApiKey}`,
      { timeout: 8000 }
    );
    if (res.data.error) return { verified: false, count: 0, error: res.data.error.error };

    const attacks = res.data.attacks || {};
    let count = 0;
    const validAttackIds = [];
    const fraudAttacks = [];

    for (const [attackId, attack] of Object.entries(attacks)) {
      if (
        String(attack.defender_id) === String(targetTornId) &&
        attack.timestamp_started >= afterTimestamp
      ) {
        const result = (attack.result || '').toLowerCase();

        // Check if this attack ID was already used in a previous claim
        const alreadyUsed = db.prepare(
          `SELECT id FROM used_attack_ids WHERE attack_id = ?`
        ).get(String(attackId));

        if (alreadyUsed) continue; // skip — already counted

        if (result === 'lost' || result === 'attacked' || result === 'hospitalized' || result === 'stalemate') {
          validAttackIds.push(String(attackId));
          count++;
        }

        if (result === 'attacked and won' || result === 'won' || result === 'mugged' || result === 'arrested') {
          fraudAttacks.push(attack);
        }
      }
    }

    if (fraudAttacks.length > 0) {
      await sendFraudAlert(
        `🚨 **FRAUD ALERT — Loss Contract #${contractId}**\n` +
        `Seller **${sellerName || 'Unknown'}** defeated the target instead of losing!\n` +
        `Target ID: \`${targetTornId}\`\n` +
        `Suspicious attacks: **${fraudAttacks.length}**\n` +
        `Results: ${fraudAttacks.map(a => a.result).join(', ')}\n` +
        `<@${ADMIN_TORN_ID}> please review manually.`
      );
    }

    // Credit only what they did (up to requiredCount)
    const credited = Math.min(count, requiredCount);
    const usedIds = validAttackIds.slice(0, credited);

    // Mark those attack IDs as used
    for (const attackId of usedIds) {
      db.prepare(`
        INSERT OR IGNORE INTO used_attack_ids (attack_id, claim_id, contract_id, seller_torn_id)
        VALUES (?, ?, ?, ?)
      `).run(attackId, claimId, contractId, sellerName);
    }

    return {
      verified: credited >= requiredCount,
      count: credited,
      needed: requiredCount,
      partial: credited > 0 && credited < requiredCount,
      usedIds
    };
  } catch (err) {
    return { verified: false, count: 0, error: 'Failed to reach Torn API' };
  }
}

// Verify escape contract
async function verifyEscapeLog(sellerApiKey, buyerTornId, requiredCount, afterTimestamp, sellerName, contractId, claimId, db) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/user/?selections=attacks&key=${sellerApiKey}`,
      { timeout: 8000 }
    );
    if (res.data.error) return { verified: false, count: 0, error: res.data.error.error };

    const attacks = res.data.attacks || {};
    let count = 0;
    const validAttackIds = [];
    const fraudAttacks = [];

    for (const [attackId, attack] of Object.entries(attacks)) {
      if (
        String(attack.attacker_id) === String(buyerTornId) &&
        attack.timestamp_started >= afterTimestamp
      ) {
        const result = (attack.result || '').toLowerCase();

        const alreadyUsed = db.prepare(
          `SELECT id FROM used_attack_ids WHERE attack_id = ?`
        ).get(String(attackId));

        if (alreadyUsed) continue;

        if (result === 'escape') {
          validAttackIds.push(String(attackId));
          count++;
        }

        if (result === 'lost' || result === 'attacked' || result === 'hospitalized' || result === 'mugged') {
          fraudAttacks.push(attack);
        }
      }
    }

    if (fraudAttacks.length > 0) {
      await sendFraudAlert(
        `🚨 **FRAUD ALERT — Escape Contract #${contractId}**\n` +
        `Seller **${sellerName || 'Unknown'}** was defeated instead of escaping!\n` +
        `Buyer ID: \`${buyerTornId}\`\n` +
        `Failed escapes: **${fraudAttacks.length}**\n` +
        `Results: ${fraudAttacks.map(a => a.result).join(', ')}\n` +
        `<@${ADMIN_TORN_ID}> please review manually.`
      );
    }

    const credited = Math.min(count, requiredCount);
    const usedIds = validAttackIds.slice(0, credited);

    for (const attackId of usedIds) {
      db.prepare(`
        INSERT OR IGNORE INTO used_attack_ids (attack_id, claim_id, contract_id, seller_torn_id)
        VALUES (?, ?, ?, ?)
      `).run(attackId, claimId, contractId, sellerName);
    }

    return {
      verified: credited >= requiredCount,
      count: credited,
      needed: requiredCount,
      partial: credited > 0 && credited < requiredCount,
      usedIds
    };
  } catch (err) {
    return { verified: false, count: 0, error: 'Failed to reach Torn API' };
  }
}

// Verify bounty contract
async function verifyBountyLog(sellerApiKey, targetTornId, requiredCount, afterTimestamp, sellerName, contractId, claimId, db) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/v2/user/log?cat=26&limit=100&key=${sellerApiKey}`,
      { timeout: 8000 }
    );
    if (res.data.error) return { verified: false, count: 0, error: res.data.error.error };

    const logs = res.data.log || {};
    let count = 0;
    const validIds = [];
    const nshEntries = [];

    for (const [logId, entry] of Object.entries(logs)) {
      if (entry.timestamp < afterTimestamp) continue;

      const params = entry.params || {};
      const logText = JSON.stringify(params).toLowerCase();

      const alreadyUsed = db.prepare(
        `SELECT id FROM used_attack_ids WHERE attack_id = ?`
      ).get(String(logId));

      if (alreadyUsed) continue;

      if (String(params.target_id || params.user_id || params.id || '') === String(targetTornId)) {
        validIds.push(String(logId));
        count += params.quantity || params.amount || 1;
      }

      if (logText.includes('nsh') || logText.includes('no show hospital')) {
        nshEntries.push(entry);
      }
    }

    if (nshEntries.length > 0) {
      await sendFraudAlert(
        `⚠️ **NSH ALERT — Bounty Contract #${contractId}**\n` +
        `Seller **${sellerName || 'Unknown'}** may have used NSH on target \`${targetTornId}\`!\n` +
        `Flagged entries: **${nshEntries.length}**\n` +
        `<@${ADMIN_TORN_ID}> please review manually.`
      );
    }

    const credited = Math.min(count, requiredCount);
    for (const logId of validIds.slice(0, credited)) {
      db.prepare(`
        INSERT OR IGNORE INTO used_attack_ids (attack_id, claim_id, contract_id, seller_torn_id)
        VALUES (?, ?, ?, ?)
      `).run(logId, claimId, contractId, sellerName);
    }

    return {
      verified: credited >= requiredCount,
      count: credited,
      needed: requiredCount,
      partial: credited > 0 && credited < requiredCount,
    };
  } catch (err) {
    return { verified: false, count: 0, error: 'Failed to reach Torn API' };
  }
}

async function getUserInfo(tornId, adminApiKey) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/user/${tornId}?selections=basic&key=${adminApiKey}`,
      { timeout: 8000 }
    );
    if (res.data.error) return null;
    return { torn_id: String(res.data.player_id), torn_name: res.data.name };
  } catch {
    return null;
  }
}

module.exports = {
  verifyApiKey,
  getTornDiscordLink,
  verifyPayment,
  verifyAttackLog,
  verifyEscapeLog,
  verifyBountyLog,
  getUserInfo
};
