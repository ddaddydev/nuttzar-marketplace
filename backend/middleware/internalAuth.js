// backend/middleware/internalAuth.js
// Protects routes that should only be called by the Discord bot, never by users

module.exports = function internalAuth(req, res, next) {
  const key = req.headers['x-internal-key'] || req.body?.internal_key;
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    console.warn(`[SECURITY] Blocked unauthorised internal request from ${req.ip}`);
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
};
