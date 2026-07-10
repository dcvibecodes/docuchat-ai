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
    const user = User.create({ username, name, passwordHash, role: 'admin' });
    Settings.createDefault(user.id);
    KnowledgeBase.create({ userId: user.id, name: 'Documents', description: 'All uploaded documents' });
    logger.info('Admin account created during setup', { userId: user.id, username });
    return user;
  }

  static async createUser({ username, name, password, role = 'user' }) {
    const existing = User.findByUsername(username);
    if (existing) throw new ConflictError('Username is already taken');

    if (role !== 'user' && role !== 'admin') {
      throw new ValidationError('Role must be "user" or "admin"');
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
    if (newRole !== 'user' && newRole !== 'admin') {
      throw new ValidationError('Role must be "user" or "admin"');
    }
    const user = User.findById(userId);
    if (!user) throw new ValidationError('User not found');
    User.updateRole(userId, newRole);
    logger.info('User role changed', { userId, from: user.role, to: newRole });
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
