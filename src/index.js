const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const { initDatabase, startAutoSave, closeConnection } = require('./database/connection');
const { migrate } = require('./database/migrate');
const errorHandler = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const knowledgeBaseRoutes = require('./routes/knowledgeBases');
const chatRoutes = require('./routes/chat');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');

async function startServer() {
  const app = express();

  // Ensure required directories exist
  const dirs = [config.paths.data, config.paths.uploads];
  for (const dir of dirs) {
    const fullPath = path.resolve(dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Initialize database and run migrations
  await migrate();
  startAutoSave(15000); // Save to disk every 15 seconds

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    }
  }));

  // CORS
  app.use(cors({
    origin: config.env === 'production' ? false : true,
    credentials: true
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: { message: 'Too many requests, please try again later', code: 'RATE_LIMITED' } }
  });
  app.use('/api/', limiter);

  // Stricter rate limit for auth
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: { message: 'Too many authentication attempts', code: 'RATE_LIMITED' } }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Session management
  app.use(session({
    store: new MemoryStore({
      checkPeriod: 86400000 // Prune expired entries every 24h
    }),
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.env === 'production',
      httpOnly: true,
      maxAge: config.session.maxAge,
      sameSite: 'lax'
    }
  }));

  // Static files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/knowledge-bases', knowledgeBaseRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/admin', adminRoutes);

  // SPA fallback
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Error handler
  app.use(errorHandler);

  // Start server
  app.listen(config.port, () => {
    logger.info(`Document Chatbot server running`, {
      port: config.port,
      env: config.env,
      llmProvider: config.llm.provider,
      embeddingProvider: config.embedding.provider
    });
    console.log(`\n  DocChat AI running at http://localhost:${config.port}\n`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    closeConnection();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
