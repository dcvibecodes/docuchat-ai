const { initDatabase, getConnection, saveDatabase } = require('./connection');
const logger = require('../utils/logger');

async function migrate() {
  await initDatabase();
  const conn = getConnection();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      storage_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      document_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      page_count INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'processing',
      error_message TEXT,
      uploaded_at TEXT DEFAULT (datetime('now')),
      indexed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      page_number INTEGER,
      heading TEXT,
      token_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL UNIQUE,
      document_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      knowledge_base_id TEXT,
      title TEXT DEFAULT 'New Conversation',
      pinned INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      conversation_title TEXT,
      user_id TEXT NOT NULL,
      username TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      theme TEXT DEFAULT 'light',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      error_type TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'sitemap',
      url TEXT,
      doc_count INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Create indexes
  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_kb ON documents(knowledge_base_id);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(knowledge_base_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON embeddings(chunk_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_kb ON embeddings(knowledge_base_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_user ON embeddings(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chat_logs_user ON chat_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_logs_created ON chat_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_logs_conversation ON chat_logs(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user ON knowledge_bases(user_id);
    CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_source_groups_user ON source_groups(user_id);
  `);

  // Add columns to documents table (safe to re-run — ignores if exists)
  try { conn.exec('ALTER TABLE documents ADD COLUMN group_id TEXT'); } catch (e) { /* already exists */ }
  try { conn.exec('ALTER TABLE documents ADD COLUMN enabled INTEGER DEFAULT 1'); } catch (e) { /* already exists */ }

  // Index on new column (must be after ALTER TABLE)
  try { conn.exec('CREATE INDEX IF NOT EXISTS idx_documents_group ON documents(group_id)'); } catch (e) { /* ignore */ }

  saveDatabase();
  logger.info('Database migration completed successfully');
}

if (require.main === module) {
  migrate().then(() => {
    console.log('Migration complete.');
    process.exit(0);
  }).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
