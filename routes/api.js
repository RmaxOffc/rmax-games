const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  // Middleware auth
  const isAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };

  // GET user info
  router.get('/user', isAuth, async (req, res) => {
    const { rows } = await pool.query('SELECT id, name, avatar, coins FROM users WHERE id = $1', [req.user.id]);
    res.json(rows[0]);
  });

  // GET game settings
  router.get('/settings/:game', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM game_settings WHERE game_name = $1', [req.params.game]);
    res.json(rows[0] || {});
  });

  // POST bet (kurangi saldo)
  router.post('/bet', isAuth, async (req, res) => {
    const { game, amount } = req.body;
    if (amount < 1) return res.status(400).json({ error: 'Amount must be > 0' });
    const user = await pool.query('SELECT coins FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].coins < amount) return res.status(400).json({ error: 'Insufficient balance' });
    await pool.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [amount, req.user.id]);
    await pool.query('INSERT INTO transactions (user_id, game, amount, type) VALUES ($1,$2,$3,$4)',
      [req.user.id, game, amount, 'bet']);
    res.json({ success: true, newBalance: user.rows[0].coins - amount });
  });

  // POST win (tambah saldo)
  router.post('/win', isAuth, async (req, res) => {
    const { game, amount, multiplier } = req.body;
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [amount, req.user.id]);
    await pool.query('INSERT INTO transactions (user_id, game, amount, type) VALUES ($1,$2,$3,$4)',
      [req.user.id, game, amount, 'win']);
    await pool.query('INSERT INTO game_history (user_id, game, bet_amount, multiplier, result) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, game, amount / (multiplier || 1), multiplier || 1, 'win']);
    res.json({ success: true });
  });

  // POST lose (catat history)
  router.post('/lose', isAuth, async (req, res) => {
    const { game, betAmount } = req.body;
    await pool.query('INSERT INTO game_history (user_id, game, bet_amount, result) VALUES ($1,$2,$3,$4)',
      [req.user.id, game, betAmount, 'lose']);
    res.json({ success: true });
  });

  // GET history
  router.get('/history', isAuth, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM game_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json(rows);
  });

  return router;
};