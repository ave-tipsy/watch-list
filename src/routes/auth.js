const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { LIMITS } = require('../limits');
const { CONFIG } = require('../config');

const router = express.Router();

// Only events, not an access log on every request — otherwise a single
// workday turns it into noise nobody reads. Just console.log: one stdout
// line, nothing buffered in process memory, and the app never opens a file
// on disk itself — storage/rotation is fully left to the Docker logger
// (`docker logs`, journald, etc), that's its job, not ours.
function logAuthEvent(event, req, extra = '') {
  console.log(`[${new Date().toISOString()}] [auth] ${event} ip=${req.ip}${extra}`);
}

// Simple brute-force protection — counts failed attempts per IP in memory.
// No external store (Redis, etc.), so the counter resets on container
// restart — good enough for a single instance with no external load
// balancer, and nothing more is needed here.
const LOGIN_MAX_ATTEMPTS = CONFIG.LOGIN_MAX_ATTEMPTS;
const LOGIN_WINDOW_MS = CONFIG.LOGIN_WINDOW_MINUTES * 60 * 1000;
const loginAttempts = new Map();

function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && now - entry.since < LOGIN_WINDOW_MS && entry.count >= LOGIN_MAX_ATTEMPTS) {
    logAuthEvent('rate-limited', req);
    return res.status(429).render('login', { error: res.locals.t('auth.errRateLimited') });
  }
  next();
}

function registerFailedLogin(req) {
  const key = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.since >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { since: now, count: 1 });
  } else {
    entry.count += 1;
  }
}

function clearFailedLogins(req) {
  loginAttempts.delete(req.ip);
}

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    registerFailedLogin(req);
    logAuthEvent('login failed', req, ` username=${JSON.stringify(username || '')}`);
    return res.status(401).render('login', { error: res.locals.t('auth.errBadCredentials') });
  }
  clearFailedLogins(req);
  req.session.userId = user.id;
  req.session.username = user.username;
  logAuthEvent('login', req, ` username=${JSON.stringify(user.username)}`);
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
});

router.post('/register', (req, res) => {
  const { username, password, password2 } = req.body;
  if (!username || username.trim().length < 3) {
    return res.status(400).render('register', { error: res.locals.t('auth.errUsernameMin') });
  }
  if (username.trim().length > LIMITS.USERNAME) {
    return res.status(400).render('register', { error: res.locals.t('auth.errUsernameMax', { max: LIMITS.USERNAME }) });
  }
  if (!password || password.length < 4) {
    return res.status(400).render('register', { error: res.locals.t('auth.errPasswordMin') });
  }
  if (password.length > LIMITS.PASSWORD) {
    return res.status(400).render('register', { error: res.locals.t('auth.errPasswordMax', { max: LIMITS.PASSWORD }) });
  }
  if (password !== password2) {
    return res.status(400).render('register', { error: res.locals.t('auth.errPasswordMismatch') });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    return res.status(400).render('register', { error: res.locals.t('auth.errUserExists') });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username.trim(), hash);

  req.session.userId = info.lastInsertRowid;
  req.session.username = username.trim();
  logAuthEvent('register', req, ` username=${JSON.stringify(username.trim())}`);
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  const username = req.session.username;
  logAuthEvent('logout', req, ` username=${JSON.stringify(username || null)}`);
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
