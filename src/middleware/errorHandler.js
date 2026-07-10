const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

function errorHandler(err, req, res, next) {
  if (err.isOperational) {
    logger.warn(`Operational error: ${err.message}`, {
      code: err.code,
      statusCode: err.statusCode,
      path: req.path
    });
  } else {
    logger.error('Unexpected error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method
    });
  }

  // Store error in database
  try {
    const db = require('../database/db');
    db.run(
      'INSERT INTO error_logs (user_id, error_type, message, stack, metadata) VALUES (?, ?, ?, ?, ?)',
      [
        req.session?.userId || null,
        err.code || 'UNKNOWN',
        err.message,
        err.stack || null,
        JSON.stringify({ path: req.path, method: req.method })
      ]
    );
  } catch (logErr) {
    // Database might not be ready yet
    logger.error('Failed to log error to database', { error: logErr.message });
  }

  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'An unexpected error occurred';

  if (req.xhr || req.headers.accept === 'application/json' || req.path.startsWith('/api/')) {
    return res.status(statusCode).json({
      error: {
        message,
        code: err.code || 'INTERNAL_ERROR'
      }
    });
  }

  res.status(statusCode).send(`
    <html>
      <head><title>Error ${statusCode}</title></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>${statusCode}</h1>
        <p>${message}</p>
        <a href="/">Go Home</a>
      </body>
    </html>
  `);
}

module.exports = errorHandler;
