require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session (gunakan PostgreSQL store untuk production)
app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(passport.initialize());
app.use(passport.session());

// Serialisasi
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  done(null, rows[0] || null);
});

// Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK || 'https://rmaxoffc.vercel.app/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  const provider_id = profile.id;
  const name = profile.displayName;
  const avatar = profile.photos?.[0]?.value || '';
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE provider = $1 AND provider_id = $2',
    ['google', provider_id]
  );
  let user = rows[0];
  if (!user) {
    const { rows: newRows } = await pool.query(
      'INSERT INTO users (provider, provider_id, name, avatar) VALUES ($1,$2,$3,$4) RETURNING *',
      ['google', provider_id, name, avatar]
    );
    user = newRows[0];
  }
  return done(null, user);
}));

// Discord Strategy
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK || 'https://rmaxoffc.vercel.app/auth/discord/callback',
  scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
  const provider_id = profile.id;
  const name = profile.username;
  const avatar = profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : '';
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE provider = $1 AND provider_id = $2',
    ['discord', provider_id]
  );
  let user = rows[0];
  if (!user) {
    const { rows: newRows } = await pool.query(
      'INSERT INTO users (provider, provider_id, name, avatar) VALUES ($1,$2,$3,$4) RETURNING *',
      ['discord', provider_id, name, avatar]
    );
    user = newRows[0];
  }
  return done(null, user);
}));

// ===== ROUTES =====
// Auth
app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);
app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});
app.get('/api/user', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  res.json(req.user);
});

// API
app.post('/api/bet', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { game, amount } = req.body;
  if (amount < 1) return res.status(400).json({ error: 'Amount must be > 0' });
  const user = await pool.query('SELECT coins FROM users WHERE id = $1', [req.user.id]);
  if (user.rows[0].coins < amount) return res.status(400).json({ error: 'Insufficient balance' });
  await pool.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [amount, req.user.id]);
  await pool.query('INSERT INTO transactions (user_id, game, amount, type) VALUES ($1,$2,$3,$4)',
    [req.user.id, game, amount, 'bet']);
  const { rows } = await pool.query('SELECT coins FROM users WHERE id = $1', [req.user.id]);
  res.json({ success: true, newBalance: rows[0].coins });
});

app.post('/api/win', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { game, amount, multiplier } = req.body;
  await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [amount, req.user.id]);
  await pool.query('INSERT INTO transactions (user_id, game, amount, type) VALUES ($1,$2,$3,$4)',
    [req.user.id, game, amount, 'win']);
  await pool.query('INSERT INTO game_history (user_id, game, bet_amount, multiplier, result) VALUES ($1,$2,$3,$4,$5)',
    [req.user.id, game, amount / (multiplier || 1), multiplier || 1, 'win']);
  const { rows } = await pool.query('SELECT coins FROM users WHERE id = $1', [req.user.id]);
  res.json({ success: true, newBalance: rows[0].coins });
});

app.post('/api/lose', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { game, betAmount } = req.body;
  await pool.query('INSERT INTO game_history (user_id, game, bet_amount, result) VALUES ($1,$2,$3,$4)',
    [req.user.id, game, betAmount, 'lose']);
  res.json({ success: true });
});

app.get('/api/settings/:game', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM game_settings WHERE game_name = $1', [req.params.game]);
  res.json(rows[0] || {});
});

app.get('/api/history', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { rows } = await pool.query(
    'SELECT * FROM game_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json(rows);
});

// Admin
const isAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).send('Unauthorized');
  if (req.user.id !== parseInt(process.env.ADMIN_USER_ID)) return res.status(403).send('Forbidden');
  next();
};

app.get('/admin', isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/admin/settings', isAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM game_settings');
  res.json(rows);
});

app.put('/admin/settings/:game', isAdmin, async (req, res) => {
  const { win_chance, multiplier_min, multiplier_max, house_edge, is_active } = req.body;
  await pool.query(
    `UPDATE game_settings SET
      win_chance = $1, multiplier_min = $2, multiplier_max = $3,
      house_edge = $4, is_active = $5, updated_at = NOW()
     WHERE game_name = $6`,
    [win_chance, multiplier_min, multiplier_max, house_edge, is_active, req.params.game]
  );
  res.json({ success: true });
});

app.get('/admin/users', isAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, avatar, coins, provider FROM users ORDER BY id');
  res.json(rows);
});

app.post('/admin/user/coins', isAdmin, async (req, res) => {
  const { userId, amount } = req.body;
  await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [amount, userId]);
  res.json({ success: true });
});

// ===== Export untuk Vercel =====
module.exports = app;

// Jalankan local jika bukan di Vercel
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}