require('dotenv').config();

// ── Startup env check ─────────────────────────────────────────────────────────
const REQUIRED_ENVS = ['INTERNAL_API_KEY', 'ENCRYPTION_KEY', 'ADMIN_API_KEY'];
for (const key of REQUIRED_ENVS) {
  if (!process.env[key]) {
    console.error(`[STARTUP] ❌ Missing required env var: ${key}`);
    process.exit(1);
  }
}

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const cron     = require('node-cron');

const { getDb }               = require('./db/schema');
const contractRoutes          = require('./routes/contracts');
const claimRoutes             = require('./routes/claims');
const userRoutes              = require('./routes/users');
const flightPrefsRoutes       = require('./routes/flightPrefs');
// services/contracts loaded lazily in cron to avoid circular dependency

const app  = express();
app.set('trust proxy', 1); // Railway sits behind a proxy
const PORT = process.env.PORT || 3001;

// ── IP lockout (in-memory) ────────────────────────────────────────────────────
// Bans IP for 1 hour after 5 consecutive failures
const failedAttempts = new Map();

function trackFailure(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, bannedUntil: 0 };
  entry.count++;
  if (entry.count >= 5) {
    entry.bannedUntil = Date.now() + 3600000;
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
app.locals.isIpBanned   = isIpBanned;

// ── IP ban check ──────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (isIpBanned(req.ip)) {
    return res.status(429).json({ success: false, error: 'Temporarily banned due to repeated failures. Try again in 1 hour.' });
  }
  next();
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://marketplace.nuttzar.website',
  process.env.FRONTEND_URL,
  process.env.NETLIFY_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow server-to-server / curl
    if (allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key'],
}));

// ── Body parser — 10kb limit prevents memory exhaustion ───────────────────────
app.use(express.json({ limit: '10kb' }));

// ── Redact sensitive fields from logs (api_key is handled securely in routes) ─
app.use((req, _res, next) => {
  if (req.body?.buyer_api_key)  req.body.buyer_api_key  = '[REDACTED]';
  if (req.body?.internal_key)   req.body.internal_key   = '[REDACTED]';
  next();
});

// ── Rate limiters ─────────────────────────────────────────────────────────────
const mkLimiter = (windowMs, max, msg) => rateLimit({
  windowMs, max,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => {
    trackFailure(req.ip);
    res.status(429).json({ success: false, error: msg });
  },
});

app.use('/api/',                    mkLimiter(15 * 60000, 60,  'Too many requests. Slow down.'));
app.use('/api/contracts/checkout',  mkLimiter(60 * 60000, 5,   'Too many checkout attempts. Try again in 1 hour.'));
app.use('/api/users/verify',        mkLimiter(60 * 60000, 10,  'Too many verify attempts. Try again in 1 hour.'));
app.use('/api/contracts',           mkLimiter(60 * 60000, 10,  'Too many payment check attempts.'));

// ── Clean up expired bans hourly ──────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of failedAttempts.entries()) {
    if (e.bannedUntil && e.bannedUntil <= now) failedAttempts.delete(ip);
  }
}, 3600000);

// ── Init DB ───────────────────────────────────────────────────────────────────
getDb();

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/contracts',    contractRoutes);
app.use('/api/claims',       claimRoutes);
app.use('/api/users',        userRoutes);
app.use('/api/flight-prefs', flightPrefsRoutes);

// Health check — no rate limit, Railway needs this
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Cron: expire stale claims every 2 minutes ─────────────────────────────────
cron.schedule('*/2 * * * *', () => {
  try {
    const { expirestaleClaims } = require('./services/contracts');
    const expired = expirestaleClaims();
    if (expired.length) {
      console.log(`[CRON] Expired ${expired.length} stale claim(s)`);
      if (global.discordBot) {
        for (const claim of expired) global.discordBot.emit('claim_expired', claim);
      }
    }
  } catch (e) { console.error('[CRON] expire claims:', e.message); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] Nuttzar backend running on port ${PORT}`);
  console.log(`[SERVER] Allowed origins: ${allowedOrigins.join(', ')}`);
});

module.exports = app;
