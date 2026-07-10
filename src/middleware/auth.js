const { AuthenticationError, AuthorizationError } = require('../utils/errors');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept === 'application/json' || req.path.startsWith('/api/')) {
      return next(new AuthenticationError());
    }
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return next(new AuthenticationError());
  }
  if (req.session.role !== 'admin') {
    return next(new AuthorizationError());
  }
  next();
}

function guestOnly(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, guestOnly };
