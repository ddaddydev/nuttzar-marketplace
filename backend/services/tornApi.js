const axios = require('axios');

const TORN_API_BASE = 'https://api.torn.com';
const ADMIN_TORN_ID = '4042794';

// Verify a Torn API key and return user info
async function verifyApiKey(apiKey) {
  try {
    const res = await axios.get(`${TORN_API_BASE}/user/?selections=basic&key=${apiKey}`, {
      timeout: 8000
    });

    if (res.data.error) {
      return { valid: false, error: res.data.error.error };
    }

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

// Get user's Discord link via Torn API
async function getTornDiscordLink(tornId, apiKey) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/v2/user/${tornId}/discord?comment=NUTTSERVICE&key=${apiKey}`,
      { timeout: 8000 }
    );

    if (res.data.error) return { linked: false, error: res.data.error.error };

    return {
      linked: true,
      discord_id: res.data.discord?.discordID || null,
      torn_id: String(tornId)
    };
  } catch (err) {
    return { linked: false, error: 'Failed to reach Torn API' };
  }
}

// Check buyer's sent money log for payment to admin
// Returns true if exact amount was sent to Nuttzar (4042794) recently
async function verifyPayment(buyerApiKey, expectedAmount) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/user/?selections=moneyTransfers&key=${buyerApiKey}`,
      { timeout: 8000 }
    );

    if (res.data.error) {
      return { verified: false, error: res.data.error.error };
    }

    const transfers = res.data.money_transfers || {};
    const cutoff = Math.floor(Date.now() / 1000) - 3600; // last 1 hour

    for (const transfer of Object.values(transfers)) {
      if (
        transfer.type === 'sent' &&
        String(transfer.to_id) === ADMIN_TORN_ID &&
        transfer.amount === expectedAmount &&
        transfer.timestamp >= cutoff
      ) {
        return { verified: true, transfer };
      }
    }

    return { verified: false, error: 'Payment not found — make sure you sent the exact amount within the last hour' };
  } catch (err) {
    return { verified: false, error: 'Failed to reach Torn API' };
  }
}

// Check seller's attack log for losses/escapes against a target
async function verifyAttackLog(sellerApiKey, targetTornId, requiredCount, afterTimestamp) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/user/?selections=attacks&key=${sellerApiKey}`,
      { timeout: 8000 }
    );

    if (res.data.error) {
      return { verified: false, count: 0, error: res.data.error.error };
    }

    const attacks = res.data.attacks || {};
    let count = 0;

    for (const attack of Object.values(attacks)) {
      if (
        String(attack.defender_id) === String(targetTornId) &&
        attack.timestamp_started >= afterTimestamp
      ) {
        count++;
      }
    }

    return {
      verified: count >= requiredCount,
      count,
      needed: requiredCount
    };
  } catch (err) {
    return { verified: false, count: 0, error: 'Failed to reach Torn API' };
  }
}

// Check seller's attack log for escapes specifically
// Escape = defender escaped (result: 'Escape')
async function verifyEscapeLog(sellerApiKey, buyerTornId, requiredCount, afterTimestamp) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/user/?selections=attacks&key=${sellerApiKey}`,
      { timeout: 8000 }
    );

    if (res.data.error) {
      return { verified: false, count: 0, error: res.data.error.error };
    }

    const attacks = res.data.attacks || {};
    let count = 0;

    for (const attack of Object.values(attacks)) {
      // For escapes: seller is DEFENDER, buyer is ATTACKER, result = 'Escape'
      if (
        String(attack.attacker_id) === String(buyerTornId) &&
        attack.timestamp_started >= afterTimestamp &&
        attack.result === 'Escape'
      ) {
        count++;
      }
    }

    return {
      verified: count >= requiredCount,
      count,
      needed: requiredCount
    };
  } catch (err) {
    return { verified: false, count: 0, error: 'Failed to reach Torn API' };
  }
}

// Get basic user info (name, id) from torn id - uses admin key
async function getUserInfo(tornId, adminApiKey) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/user/${tornId}?selections=basic&key=${adminApiKey}`,
      { timeout: 8000 }
    );

    if (res.data.error) return null;

    return {
      torn_id: String(res.data.player_id),
      torn_name: res.data.name
    };
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
  getUserInfo
};
