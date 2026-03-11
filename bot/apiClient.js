const axios = require('axios');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'x-internal-key': process.env.INTERNAL_API_KEY || ''
  }
});

async function verifyUser(apiKey, discordId) {
  const res = await api.post('/api/users/verify', { api_key: apiKey, discord_id: discordId });
  return res.data;
}

async function getActiveClaims(tornId) {
  const res = await api.get(`/api/users/${tornId}/claims`);
  return res.data;
}

async function getActiveContracts(type) {
  const params = type ? { type } : {};
  const res = await api.get('/api/contracts', { params });
  return res.data;
}

async function createClaim(contractId, sellerTornId, sellerDiscordId, quantityClaimed) {
  const res = await api.post('/api/claims', {
    contract_id: contractId,
    seller_torn_id: sellerTornId,
    seller_discord_id: sellerDiscordId,
    quantity_claimed: quantityClaimed
  });
  return res.data;
}

async function completeClaim(claimId) {
  const res = await api.post(`/api/claims/${claimId}/complete`);
  return res.data;
}

async function markPayoutSent(payoutId) {
  const res = await api.post(`/api/payouts/${payoutId}/sent`);
  return res.data;
}

async function getPendingPayouts() {
  const res = await api.get('/api/claims/payouts/pending');
  return res.data;
}

module.exports = {
  verifyUser,
  getActiveClaims,
  getActiveContracts,
  createClaim,
  completeClaim,
  markPayoutSent,
  getPendingPayouts
};
