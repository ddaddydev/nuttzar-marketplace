require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const { getDb } = require('./db/schema');
const contractRoutes = require('./routes/contracts');
const claimRoutes = require('./routes/claims');
const userRoutes = require('./routes/users');
const { expirestaleClaims } = require('./services/contracts');

const app = express();
const PORT = process.env.PORT || 3001;

// ── IP Lockout tracker (in-memory) ────────────────────────────────────────────
// Bans an IP for 1 hour after 5 consecutive failed attempts
const failedAttempts = new Map();

function trackFailure(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip) || { count: 0, bannedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.bannedUntil = now + 60 * 60 * 1000; // 1 hour ban
    entry.count = 0;
    console.warn(`[SECURITY] IP ${ip} banned for 1 hour`);
  }
  failedAttempts.set(ip, entry);
}

function isIpBanned(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (entry.bannedUntil > Date.now()) return true;
  failedAttempts.delete(ip);
  return false;
}

app.locals.trackFailure = trackFailure;
app.locals.isIpBanned = isIpBanned;

// ── IP ban check ──────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (isIpBanned(ip)) {
    return res.status(429).json({
      success: false,
      error: 'Temporarily banned due to repeated failures. Try again in 1 hour.'
    });
  }
  next();
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://marketplace.nuttzar.website',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key']
}));

// Limit body size to 10kb — prevents memory exhaustion attacks
app.use(express.json({ limit: '10kb' }));

// ── Rate limiters ─────────────────────────────────────────────────────────────

// General: 60 requests per 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    trackFailure(req.ip);
    res.status(429).json({ success: false, error: 'Too many requests. Slow down.' });
  }
});
app.use('/api/', limiter);

// Checkout: max 5 per hour per IP
const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    trackFailure(req.ip);
    res.status(429).json({ success: false, error: 'Too many checkout attempts. Try again in 1 hour.' });
  }
});
app.use('/api/contracts/checkout', checkoutLimiter);

// Verify: max 10 per hour per IP
const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  handler: (req, res) => {
    trackFailure(req.ip);
    res.status(429).json({ success: false, error: 'Too many verify attempts. Try again in 1 hour.' });
  }
});
app.use('/api/users/verify', verifyLimiter);

// Payment check: max 10 per hour per IP
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  handler: (req, res) => {
    trackFailure(req.ip);
    res.status(429).json({ success: false, error: 'Too many payment check attempts.' });
  }
});
app.use('/api/contracts', paymentLimiter);

// Clean up expired bans every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts.entries()) {
    if (entry.bannedUntil && entry.bannedUntil <= now) failedAttempts.delete(ip);
  }
}, 60 * 60 * 1000);

// ── Initialize DB ─────────────────────────────────────────────────────────────
getDb();

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/contracts', contractRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/users', userRoutes);

// Health check (no rate limit — Railway needs this to monitor the service)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Cron Jobs ─────────────────────────────────────────────────────────────────

// Expire stale claims every 2 minutes
cron.schedule('*/2 * * * *', () => {
  try {
    const expired = expirestaleClaims();
    if (expired.length > 0) {
      console.log(`[CRON] Expired ${expired.length} stale claim(s)`);
      if (global.discordBot) {
        for (const claim of expired) {
          global.discordBot.emit('claim_expired', claim);
        }
      }
    }
  } catch (err) {
    console.error('[CRON] Error expiring claims:', err.message);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] Nuttzar Marketplace backend running on port ${PORT}`);
  console.log(`[SERVER] Frontend allowed from: ${process.env.FRONTEND_URL}`);
});

module.exports = app;
