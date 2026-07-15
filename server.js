require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change_this_to_a_long_random_string') {
  console.error('\n❌ JWT_SECRET is not set (or still the placeholder value) in your .env file.');
  console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('   Then put it in .env as JWT_SECRET=<the generated value>\n');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true
}));

// General API rate limit to protect against abuse/scraping
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 300 }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/products', require('./routes/products'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/shops', require('./routes/shops'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/superadmin', require('./routes/superadmin'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/purchase-orders', require('./routes/purchase-orders'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/coupons', require('./routes/coupons'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler — never leak stack traces to clients
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MSync API running on http://localhost:${PORT}`);
});
