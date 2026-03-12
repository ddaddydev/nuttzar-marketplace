const axios = require('axios');

const TORN_API_BASE = 'https://api.torn.com';
const ADMIN_TORN_ID = '4042794';

// Verify a Torn API key and return user info
async function verifyApiKey(apiKey) {
  try {
    const res = await axios.get(`${TORN_API_BASE}/user/?selections=basic&comment=NSH&key=${apiKey}`, {
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

// Verify buyer sent exact payment amount to admin within last hour
// Uses v2 /user/log with category for sent money, falls back to v1
async function verifyPayment(buyerApiKey, expectedAmount) {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 3600;

    // v2 log — category 100 = money/cash sent
    const res = await axios.get(
      `${TORN_API_BASE}/v2/user/log?cat=100&limit=200&comment=NSH&key=${buyerApiKey}`,
      { timeout: 8000 }
    );

    if (!res.data.error) {
      const logs = res.data.log || [];
      const entries = Array.isArray(logs) ? logs : Object.values(logs);

      for (const entry of entries) {
        if (entry.timestamp < cutoff) continue;

        const d = entry.data || entry.params || {};
        const toId = String(d.to_id || d.recipient_id || d.target || '');
        const amount = d.amount || d.money || d.value || 0;

        if (toId === ADMIN_TORN_ID && amount === expectedAmount) {
          return { verified: true };
        }
      }

      // No match found — give specific feedback
      return {
        verified: false,
        error: `Payment of $${expectedAmount.toLocaleString()} to admin not found in last hour. Make sure your Torn API key has **Log** access at torn.com/preferences.php#tab=api`
      };
    }

    return {
      verified: false,
      error: `API error: ${res.data.error.error}. Your key may need Log access enabled.`
    };
  } catch (err) {
    return { verified: false, error: 'Failed to reach Torn API' };
  }
}

// Check seller's attack log for losses against a target (v2 attacksfull)
async function verifyAttackLog(sellerApiKey, targetTornId, requiredCount, afterTimestamp) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/v2/user/attacksfull?limit=1000&sort=DESC&comment=NSH&key=${sellerApiKey}`,
      { timeout: 8000 }
    );

    if (res.data.error) {
      return { verified: false, count: 0, error: res.data.error.error };
    }

    const attacks = res.data.attacks || [];
    let count = 0;

    for (const attack of attacks) {
      if (
        attack.started >= afterTimestamp &&
        attack.defender?.id === parseInt(targetTornId) &&
        (attack.result === 'Hospitalized' || attack.result === 'Mugged')
      ) {
        count++;
      }
      // Stop scanning once we're past the claim window (attacks are DESC)
      if (attack.started < afterTimestamp - 300) break;
    }

    return { verified: count >= requiredCount, count, needed: requiredCount };
  } catch (err) {
    return { verified: false, count: 0, error: 'Failed to reach Torn API' };
  }
}

// Check seller's attack log for escapes (v2 attacksfull)
// Escape = attacker.id is the buyer (they attacked seller) and result is 'Escape'
async function verifyEscapeLog(sellerApiKey, buyerTornId, requiredCount, afterTimestamp) {
  try {
    const res = await axios.get(
      `${TORN_API_BASE}/v2/user/attacksfull?limit=1000&sort=DESC&comment=NSH&key=${sellerApiKey}`,
      { timeout: 8000 }
    );

    if (res.data.error) {
      return { verified: false, count: 0, error: res.data.error.error };
    }

    const attacks = res.data.attacks || [];
    let count = 0;

    for (const attack of attacks) {
      if (
        attack.started >= afterTimestamp &&
        attack.attacker?.id === parseInt(buyerTornId) &&
        attack.result === 'Escape'
      ) {
        count++;
      }
      if (attack.started < afterTimestamp - 300) break;
    }

    return { verified: count >= requiredCount, count, needed: requiredCount };
  } catch (err) {
    return { verified: false, count: 0, error: 'Failed to reach Torn API' };
  }
}

// Verify bounty contract: check target has NSH bounties, and seller hospitalized them via attack log
// Uses SELLER's API key to check their attack log against the target
async function verifyBountyNSH(sellerApiKey, targetTornId, requiredCount, afterTimestamp) {
  try {
    // Step 1: Check that the target actually has NSH bounties active (using seller's key)
    const bountyRes = await axios.get(
      `${TORN_API_BASE}/v2/user/${targetTornId}/bounties?comment=NUTTSERVICE&key=${sellerApiKey}`,
      { timeout: 8000 }
    );

    if (bountyRes.data.error) {
      return { verified: false, count: 0, error: `Bounty API error: ${bountyRes.data.error.error}` };
    }

    const bounties = bountyRes.data.bounties || [];
    const nshBounties = bounties.filter(b =>
      b.reason && b.reason.toUpperCase().includes('NSH')
    );

    if (nshBounties.length === 0) {
      return {
        verified: false,
        count: 0,
        needed: requiredCount,
        error: `Target [${targetTornId}] has no active NSH bounties. Cannot verify.`
      };
    }

    // Step 2: Verify seller actually hospitalized the target via attack log
    const attackRes = await axios.get(
      `${TORN_API_BASE}/v2/user/attacksfull?limit=1000&sort=DESC&comment=NSH&key=${sellerApiKey}`,
      { timeout: 8000 }
    );

    if (attackRes.data.error) {
      return { verified: false, count: 0, error: attackRes.data.error.error };
    }

    const attacks = res.data.attacks || [];
    let count = 0;

    for (const attack of attacks) {
      if (
        attack.started >= afterTimestamp &&
        attack.defender?.id === parseInt(targetTornId) &&
        (attack.result === 'Hospitalized' || attack.result === 'Mugged')
      ) {
        count++;
      }
      if (attack.started < afterTimestamp - 300) break;
    }

    return {
      verified: count >= requiredCount,
      count,
      needed: requiredCount,
      nsh_bounties: nshBounties.length
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
  verifyBountyNSH,
  getUserInfo
};
