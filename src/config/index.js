require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',

  session: {
    secret: process.env.SESSION_SECRET || 'fallback-dev-secret',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },

  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.1,
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
    },
    claude: {
      apiKey: process.env.CLAUDE_API_KEY,
      model: process.env.CLAUDE_MODEL || 'claude-3-haiku-20240307'
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
    },
    local: {
      url: process.env.LOCAL_LLM_URL || 'http://localhost:11434',
      model: process.env.LOCAL_LLM_MODEL || 'llama3'
    }
  },

  embedding: {
    provider: process.env.EMBEDDING_PROVIDER || 'openai',
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    local: {
      url: process.env.LOCAL_EMBEDDING_URL || 'http://localhost:11434',
      model: process.env.LOCAL_EMBEDDING_MODEL || 'nomic-embed-text'
    }
  },

  rag: {
    chunkSize: parseInt(process.env.CHUNK_SIZE, 10) || 800,
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP, 10) || 100,
    maxRetrievedChunks: parseInt(process.env.MAX_RETRIEVED_CHUNKS, 10) || 8,
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.7,
    maxContextSize: parseInt(process.env.MAX_CONTEXT_SIZE, 10) || 4000
  },

  upload: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50,
    allowedExtensions: (process.env.ALLOWED_EXTENSIONS || 'pdf,docx,txt,md,xlsx,xls,csv').split(','),
    directory: 'uploads'
  },

  streaming: process.env.ENABLE_STREAMING === 'true',

  paths: {
    data: 'data',
    uploads: 'uploads',
    database: 'data/chatbot.db',
    sessionDb: 'data/sessions.db'
  }
};

module.exports = config;
