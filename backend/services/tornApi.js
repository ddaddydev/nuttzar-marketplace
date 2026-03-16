// backend/services/tornApi.js
const axios = require('axios');

const BASE          = 'https://api.torn.com';
const ADMIN_TORN_ID = '4042794';

async function verifyApiKey(apiKey) {
  try {
    apiKey = (apiKey || '').trim().replace(/[\r\n\t]/g, '');
    if (!apiKey) return { valid: false, error: 'API key cannot be empty' };

    // Step 1 — confirm key works and get user info (same pattern as every other call in this file)
    const basicRes = await axios.get(`${BASE}/user/?selections=basic&key=${apiKey}`, { timeout: 8000 });
    if (basicRes.data.error) {
      const code = basicRes.data.error.code;
      const msg  = basicRes.data.error.error || 'Invalid API key';
      console.log(`[VERIFY] Step 1 failed — code: ${code}, msg: ${msg}`);
      return { valid: false, error: msg };
    }

    // Step 2 — confirm Full Access by hitting /v2/user/log (requires full access, returns error code 16 if too low)
    const logRes = await axios.get(`${BASE}/v2/user/log?limit=1&key=${apiKey}`, { timeout: 8000 });
    const logErr = logRes.data?.error;
    console.log(`[VERIFY] Step 2 log check — error: ${JSON.stringify(logErr)}`);
    if (logErr && logErr.code === 16) {
      return {
        valid: false,
        error: 'NuttHub requires a **Full Access** API key to verify attack logs.\n\n[Click here to create a Full Access key](https://www.torn.com/preferences.php#tab=api?&step=addNewKey&title=NuttHub&type=4)',
      };
    }

    return {
      valid: true,
      torn_id:   String(basicRes.data.player_id),
      torn_name: basicRes.data.name,
      level:     basicRes.data.level,
    };
  } catch { return { valid: false, error: 'Failed to reach Torn API. Try again in a moment.' }; }
}

async function verifyPayment(buyerApiKey, expectedAmount) {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 3600;

    // Try v2 log first (category 100 = money sent)
    try {
      const v2 = await axios.get(`${BASE}/v2/user/log?cat=100&limit=100&key=${buyerApiKey}`, { timeout: 8000 });
      if (!v2.data.error) {
        for (const entry of Object.values(v2.data.log || {})) {
          const p = entry.params || {};
          if (
            entry.timestamp >= cutoff &&
            String(p.to_id || p.recipient || '') === ADMIN_TORN_ID &&
            (p.amount === expectedAmount || p.money === expectedAmount)
          ) return { verified: true, entry };
        }
      }
    } catch { /* fall through */ }

    // Fallback: v1 moneyTransfers
    const v1 = await axios.get(`${BASE}/user/?selections=moneyTransfers&key=${buyerApiKey}`, { timeout: 8000 });
    if (v1.data.error) return { verified: false, error: v1.data.error.error };

    for (const t of Object.values(v1.data.money_transfers || {})) {
      if (t.type === 'sent' && String(t.to_id) === ADMIN_TORN_ID && t.amount === expectedAmount && t.timestamp >= cutoff) {
        return { verified: true, transfer: t };
      }
    }

    return { verified: false, error: 'Payment not found — send the exact amount within the last hour.' };
  } catch { return { verified: false, error: 'Failed to reach Torn API' }; }
}

// Results that mean the seller WON (bad for loss contracts)
const WIN_RESULTS = new Set(['Attacked', 'Mugged', 'Hospitalized']);

async function verifyAttackLog(sellerApiKey, targetTornId, requiredCount, afterTimestamp) {
  try {
    const res = await axios.get(`${BASE}/user/?selections=attacks&key=${sellerApiKey}`, { timeout: 8000 });
    if (res.data.error) return { verified: false, count: 0, error: res.data.error.error };

    let count = 0;        // valid losses
    let wrongOutcomes = 0; // seller won instead of losing

    for (const a of Object.values(res.data.attacks || {})) {
      if (String(a.defender_id) !== String(targetTornId)) continue;
      if (a.timestamp_started < afterTimestamp) continue;
      if (WIN_RESULTS.has(a.result)) {
        wrongOutcomes++; // seller attacked and WON — not a valid loss
      } else {
        count++; // seller lost, stalemate, etc — valid
      }
    }

    return {
      verified:      count >= requiredCount,
      count,
      needed:        requiredCount,
      wrongOutcomes, // seller won when they should have lost
    };
  } catch { return { verified: false, count: 0, needed: requiredCount, wrongOutcomes: 0, error: 'Failed to reach Torn API' }; }
}

async function verifyEscapeLog(sellerApiKey, buyerTornId, requiredCount, afterTimestamp) {
  try {
    const res = await axios.get(`${BASE}/user/?selections=attacks&key=${sellerApiKey}`, { timeout: 8000 });
    if (res.data.error) return { verified: false, count: 0, error: res.data.error.error };

    let count = 0;         // valid escapes
    let wrongOutcomes = 0; // buyer attacked but seller lost instead of escaping

    for (const a of Object.values(res.data.attacks || {})) {
      if (String(a.attacker_id) !== String(buyerTornId)) continue;
      if (a.timestamp_started < afterTimestamp) continue;
      if (a.result === 'Escape') {
        count++;
      } else {
        wrongOutcomes++; // attack happened but seller didn't escape
      }
    }

    return {
      verified:      count >= requiredCount,
      count,
      needed:        requiredCount,
      wrongOutcomes, // attacks where seller failed to escape
    };
  } catch { return { verified: false, count: 0, needed: requiredCount, wrongOutcomes: 0, error: 'Failed to reach Torn API' }; }
}

async function getUserInfo(tornId, adminApiKey) {
  try {
    const res = await axios.get(`${BASE}/user/${tornId}?selections=basic&key=${adminApiKey}`, { timeout: 8000 });
    if (res.data.error) return null;
    return { torn_id: String(res.data.player_id), torn_name: res.data.name };
  } catch { return null; }
}

module.exports = { verifyApiKey, verifyPayment, verifyAttackLog, verifyEscapeLog, getUserInfo };
