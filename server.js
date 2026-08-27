require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const { Pool } = require('pg');
const app = express();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set true jika pakai HTTPS
}));
app.use(passport.initialize());
app.use(passport.session());

// serialisasi user
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  done(null, rows[0] || null);
});

// --- Google Strategy ---
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK
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

// --- Discord Strategy ---
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK,
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

// di server.js, tambahkan ini sebelum route
app.use(express.static('public'));   // folder tempat semua HTML
app.use(express.json());            // untuk parsing JSON

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api')(pool));
app.use('/admin', require('./routes/admin')(pool));

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port', process.env.PORT || 3000);
});