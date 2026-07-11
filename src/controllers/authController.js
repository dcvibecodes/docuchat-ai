const AuthService = require('../services/authService');
const logger = require('../utils/logger');

class AuthController {
  static async setup(req, res, next) {
    try {
      const { username, name, password } = req.body;
      const user = await AuthService.setupAdmin({ username, name, password });
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      res.status(201).json({ success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
    } catch (err) { next(err); }
  }

  static async login(req, res, next) {
    try {
      const { username, password } = req.body;
      const user = await AuthService.login({ username, password });
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
    } catch (err) { next(err); }
  }

  static logout(req, res) {
    req.session.destroy((err) => {
      if (err) logger.error('Session destruction error', { error: err.message });
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  }

  static getProfile(req, res, next) {
    try {
      const profile = AuthService.getProfile(req.session.userId);
      if (!profile) return res.status(404).json({ error: { message: 'User not found' } });
      res.json(profile);
    } catch (err) { next(err); }
  }

  static checkSetup(req, res) {
    res.json({ needsSetup: AuthService.needsSetup() });
  }

  static async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      await AuthService.changePassword(req.session.userId, { currentPassword, newPassword });
      res.json({ success: true });
    } catch (err) { next(err); }
  }
}

module.exports = AuthController;
