const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Settings = require('../models/Settings');
const KnowledgeBase = require('../models/KnowledgeBase');
const { ValidationError, ConflictError, AuthenticationError, AuthorizationError } = require('../utils/errors');
const logger = require('../utils/logger');

const SALT_ROUNDS = 12;

class AuthService {
  static async setupAdmin({ username, name, password }) {
    const userCount = User.count();
    if (userCount > 0) {
      throw new AuthorizationError('Admin already exists. Setup is disabled.');
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = User.create({ username, name, passwordHash, role: 'techadmin' });
    Settings.createDefault(user.id);
    KnowledgeBase.create({ userId: user.id, name: 'Documents', description: 'All uploaded documents' });
    logger.info('Admin account created during setup', { userId: user.id, username });
    return user;
  }

  static async createUser({ username, name, password, role = 'user' }) {
    const existing = User.findByUsername(username);
    if (existing) throw new ConflictError('Username is already taken');

    const validRoles = ['user', 'admin', 'techadmin'];
    if (!validRoles.includes(role)) {
      throw new ValidationError('Role must be "user", "admin", or "techadmin"');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = User.create({ username, name, passwordHash, role });
    Settings.createDefault(user.id);
    KnowledgeBase.create({ userId: user.id, name: 'Documents', description: 'All uploaded documents' });
    logger.info('User created by admin', { userId: user.id, username, role });
    return user;
  }

  static deleteUser(userId, requestingUserId) {
    if (userId === requestingUserId) {
      throw new ValidationError('Cannot delete your own account');
    }
    const user = User.findById(userId);
    if (!user) throw new ValidationError('User not found');
    User.delete(userId);
    logger.info('User deleted by admin', { userId, username: user.username });
  }

  static changeRole(userId, newRole, requestingUserId) {
    if (userId === requestingUserId) {
      throw new ValidationError('Cannot change your own role');
    }
    const validRoles = ['user', 'admin', 'techadmin'];
    if (!validRoles.includes(newRole)) {
      throw new ValidationError('Role must be "user", "admin", or "techadmin"');
    }
    const requestingUser = User.findById(requestingUserId);
    const targetUser = User.findById(userId);
    if (!targetUser) throw new ValidationError('User not found');

    // Only techadmin can promote/demote to techadmin
    if (newRole === 'techadmin' && requestingUser.role !== 'techadmin') {
      throw new AuthorizationError('Only tech admins can assign tech admin role');
    }
    if (targetUser.role === 'techadmin' && requestingUser.role !== 'techadmin') {
      throw new AuthorizationError('Only tech admins can change another tech admin\'s role');
    }

    User.updateRole(userId, newRole);
    logger.info('User role changed', { userId, from: targetUser.role, to: newRole });
  }

  static async login({ username, password }) {
    const user = User.findByUsername(username);
    if (!user) throw new AuthenticationError('Invalid username or password');

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) throw new AuthenticationError('Invalid username or password');

    User.updateLastLogin(user.id);
    logger.info('User logged in', { userId: user.id, username });
    return user;
  }

  static async changePassword(userId, { currentPassword, newPassword }) {
    const user = User.findById(userId);
    if (!user) throw new ValidationError('User not found');

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) throw new AuthenticationError('Current password is incorrect');

    if (!newPassword || newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters');
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const db = require('../database/db');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
    logger.info('Password changed', { userId });
  }

  static getProfile(userId) {
    const user = User.findById(userId);
    if (!user) return null;
    return {
      id: user.id, username: user.username, name: user.name,
      role: user.role, storageUsed: user.storage_used,
      createdAt: user.created_at, lastLogin: user.last_login
    };
  }

  static needsSetup() {
    return User.count() === 0;
  }
}

module.exports = AuthService;
