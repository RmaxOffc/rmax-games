const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  // Middleware cek admin (hanya user dengan ID tertentu)
  const isAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).send('Unauthorized');
    if (req.user.id !== parseInt(process.env.ADMIN_USER_ID)) return res.status(403).send('Forbidden');
    next();
  };

  // Halaman admin (HTML)
  router.get('/', isAdmin, (req, res) => {
    res.sendFile(__dirname + '/../views/admin.html');
  });

  // GET semua settings
  router.get('/settings', isAdmin, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM game_settings');
    res.json(rows);
  });

  // UPDATE setting
  router.put('/settings/:game', isAdmin, async (req, res) => {
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

  // GET semua user (untuk admin)
  router.get('/users', isAdmin, async (req, res) => {
    const { rows } = await pool.query('SELECT id, name, avatar, coins, provider FROM users ORDER BY id');
    res.json(rows);
  });

  // UPDATE coins user
  router.post('/user/coins', isAdmin, async (req, res) => {
    const { userId, amount } = req.body;
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [amount, userId]);
    res.json({ success: true });
  });

  return router;
};