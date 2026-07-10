const { ValidationError } = require('../utils/errors');
const sanitizeHtml = require('sanitize-html');

function sanitizeInput(value) {
  if (typeof value === 'string') {
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
  }
  return value;
}

function validateRegistration(req, res, next) {
  const { email, username, password, confirmPassword } = req.body;

  if (!email || !username || !password) {
    return next(new ValidationError('All fields are required'));
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return next(new ValidationError('Invalid email format'));
  }

  if (username.length < 3 || username.length > 30) {
    return next(new ValidationError('Username must be 3-30 characters'));
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return next(new ValidationError('Username can only contain letters, numbers, hyphens, and underscores'));
  }

  if (password.length < 8) {
    return next(new ValidationError('Password must be at least 8 characters'));
  }

  if (password !== confirmPassword) {
    return next(new ValidationError('Passwords do not match'));
  }

  // Sanitize inputs
  req.body.email = sanitizeInput(email);
  req.body.username = sanitizeInput(username);

  next();
}

function validateLogin(req, res, next) {
  const { username, password } = req.body;

  if (!username || !password) {
    return next(new ValidationError('Username and password are required'));
  }

  req.body.username = sanitizeInput(username);
  next();
}

function validateKnowledgeBase(req, res, next) {
  const { name } = req.body;

  if (!name || name.trim().length === 0) {
    return next(new ValidationError('Knowledge base name is required'));
  }

  if (name.length > 100) {
    return next(new ValidationError('Knowledge base name must be under 100 characters'));
  }

  req.body.name = sanitizeInput(name);
  if (req.body.description) {
    req.body.description = sanitizeInput(req.body.description);
  }

  next();
}

function validateMessage(req, res, next) {
  const { message } = req.body;

  if (!message || message.trim().length === 0) {
    return next(new ValidationError('Message is required'));
  }

  if (message.length > 10000) {
    return next(new ValidationError('Message is too long (max 10000 characters)'));
  }

  req.body.message = sanitizeInput(message);
  next();
}

module.exports = {
  sanitizeInput,
  validateRegistration,
  validateLogin,
  validateKnowledgeBase,
  validateMessage
};
