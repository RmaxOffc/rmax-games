const express = require('express');
const passport = require('passport');
const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: ['profile'] }));
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

router.get('/discord', passport.authenticate('discord'));
router.get('/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

router.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  res.json(req.user);
});

module.exports = router;