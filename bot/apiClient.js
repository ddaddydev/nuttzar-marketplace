// bot/apiClient.js
const axios = require('axios');

const api = axios.create({
  baseURL: process.env.BACKEND_URL || 'http://localhost:3001',
  timeout: 10000,
  headers: {
    'Content-Type':  'application/json',
    'x-internal-key': process.env.INTERNAL_API_KEY || '',
  },
});

// Wrap all calls so errors return { success: false } rather than throwing
async function safe(fn) {
  try { return await fn(); }
  catch (e) { return { success: false, error: e.response?.data?.error || e.message }; }
}

const verifyUser        = (apiKey, discordId)                          => safe(() => api.post('/api/users/verify', { api_key: apiKey, discord_id: discordId }).then(r => r.data));
const getActiveClaims   = tornId                                        => safe(() => api.get(`/api/users/${tornId}/claims`).then(r => r.data));
const getBalance        = tornId                                        => safe(() => api.get(`/api/users/${tornId}/balance`).then(r => r.data));
const getActiveContracts = type                                         => safe(() => api.get('/api/contracts', { params: type ? { type } : {} }).then(r => r.data));
const createClaim       = (contractId, sellerTornId, discordId, qty)   => safe(() => api.post('/api/claims', { contract_id: contractId, seller_torn_id: sellerTornId, seller_discord_id: discordId, quantity_claimed: qty }).then(r => r.data));
const completeClaim     = claimId                                       => safe(() => api.post(`/api/claims/${claimId}/complete`).then(r => r.data));
const markPayoutSent    = payoutId                                      => safe(() => api.post(`/api/claims/payouts/${payoutId}/sent`).then(r => r.data));
const getPendingPayouts = ()                                            => safe(() => api.get('/api/claims/payouts/pending').then(r => r.data));

module.exports = { verifyUser, getActiveClaims, getBalance, getActiveContracts, createClaim, completeClaim, markPayoutSent, getPendingPayouts };
