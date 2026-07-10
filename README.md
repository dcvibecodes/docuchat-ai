# DocChat AI

Self-hosted document AI chatbot using RAG (Retrieval-Augmented Generation). Upload documents, ask questions, get answers grounded only in your documents with citations.

## Features

- **Username/password authentication** (no email required)
- **First user auto-becomes admin** — no self-registration
- **Admin creates users** with username, display name, password, and role
- **Role-based access**: Admin (all tabs), User (chat only)
- **Document upload**: PDF, DOCX, TXT, Markdown, Excel (.xlsx)
- **Multi-file drag-and-drop upload**
- **Re-upload same filename** replaces old version automatically
- **Document processing**: text extraction, semantic chunking, OpenAI embeddings
- **Auto-polling document status** (processing → ready)
- **Retry failed documents** without re-uploading
- **RAG chat**: vector search + LLM with streaming responses
- **Citations** with document name and page number
- **Conflict resolution**: latest document/update wins
- **Configurable LLM**: OpenAI, Gemini, Claude, OpenRouter, Local (Ollama)
- **Configurable system prompt** from Admin UI
- **API keys configured in UI** (not env vars)
- **Conversation management**: pin, delete, clear all, 20-chat auto-limit
- **Chat Logs tab**: admin sees all chats ever, export as CSV
- **Mobile-friendly** with hamburger menu drawer
- **Light theme**, monochrome design

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: sql.js (SQLite in-memory with periodic disk persistence)
- **Frontend**: Vanilla JS single-page app (no framework, no build step)
- **Embeddings**: OpenAI `text-embedding-3-small` (or local via Ollama)
- **LLM**: Configurable — OpenAI, Gemini, Claude, OpenRouter, or local Ollama

## Quick Start

```bash
# Clone and install
git clone <repo-url> document-chatbot
cd document-chatbot
npm install

# Create .env (only PORT and SESSION_SECRET are required)
cp .env.example .env
# Edit .env and set SESSION_SECRET to a random string

# Start
npm start
```

Open `http://localhost:3000`. On first visit you'll see a one-time setup screen to create the admin account. After that:

1. Log in → go to **Admin** tab → set your LLM provider and API key
2. Go to **Documents** tab → upload knowledge documents
3. Wait for status to show "ready"
4. Go to **Chat** tab → ask questions

## Environment Variables

Only two are needed to run:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | `fallback-dev-secret` | Session signing secret (change in production) |

All other configuration (API keys, models, temperature, chunking settings) is managed through the **Admin UI** at runtime — no restart required.

The `.env.example` file documents additional env vars that can optionally override defaults at startup, but the Admin UI takes precedence once configured.

## Project Structure

```
document-chatbot/
├── public/                  # Frontend (served as static files)
│   ├── index.html           # Single-page app shell
│   ├── app.js               # All frontend logic
│   ├── styles.css           # Styles (light monochrome theme)
│   └── favicon.svg
├── src/
│   ├── index.js             # Express server entry point
│   ├── config/index.js      # Environment config
│   ├── controllers/         # Route handlers
│   │   ├── adminController.js
│   │   ├── authController.js
│   │   ├── chatController.js
│   │   ├── documentController.js
│   │   ├── knowledgeBaseController.js
│   │   └── settingsController.js
│   ├── database/
│   │   ├── connection.js    # sql.js init + auto-save
│   │   ├── db.js            # Query abstraction layer
│   │   └── migrate.js       # Schema migrations
│   ├── middleware/
│   │   ├── auth.js          # Session auth + role checks
│   │   ├── errorHandler.js  # Global error handler
│   │   ├── upload.js        # Multer file upload config
│   │   └── validate.js      # Input validation/sanitization
│   ├── models/              # Data access layer
│   │   ├── ChatLog.js
│   │   ├── Chunk.js
│   │   ├── Conversation.js
│   │   ├── Document.js
│   │   ├── Embedding.js
│   │   ├── KnowledgeBase.js
│   │   ├── Message.js
│   │   ├── Settings.js
│   │   ├── SystemConfig.js
│   │   └── User.js
│   ├── routes/              # Express route definitions
│   │   ├── admin.js
│   │   ├── auth.js
│   │   ├── chat.js
│   │   ├── documents.js
│   │   ├── knowledgeBases.js
│   │   └── settings.js
│   ├── services/            # Business logic
│   │   ├── authService.js
│   │   ├── chunker.js       # Semantic text chunking
│   │   ├── documentProcessor.js
│   │   ├── embeddingService.js
│   │   ├── extractors/index.js  # PDF/DOCX/TXT/MD/Excel extractors
│   │   ├── llmService.js    # Multi-provider LLM client
│   │   ├── ragService.js    # Orchestrates RAG pipeline
│   │   └── vectorSearch.js  # Cosine similarity search
│   └── utils/
│       ├── errors.js        # Custom error classes
│       └── logger.js        # Winston logger
├── data/                    # SQLite database (auto-created)
├── uploads/                 # Uploaded files (auto-created)
├── package.json
└── .env.example
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/needs-setup` | Check if first-time setup is needed |
| POST | `/api/auth/setup` | Create initial admin account |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/profile` | Get current user profile |

### Documents (requires auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/documents` | List documents |
| POST | `/api/documents/upload` | Upload a document (multipart) |
| GET | `/api/documents/:id` | Get document details |
| PATCH | `/api/documents/:id/rename` | Rename document |
| POST | `/api/documents/:id/reindex` | Re-process/retry document |
| DELETE | `/api/documents/:id` | Delete document |

### Chat (requires auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat/conversations` | List conversations |
| POST | `/api/chat/conversations` | Create conversation |
| GET | `/api/chat/conversations/:id` | Get conversation |
| PATCH | `/api/chat/conversations/:id` | Update (rename, pin/unpin) |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |
| GET | `/api/chat/conversations/:id/messages` | Get messages |
| POST | `/api/chat/conversations/:id/messages` | Send message (supports `?stream=true`) |
| POST | `/api/chat/conversations/:id/regenerate` | Regenerate last AI response |

### Admin (requires admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | System statistics |
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/users` | Create user |
| PATCH | `/api/admin/users/:id/role` | Change user role |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/config` | Get system configuration |
| PATCH | `/api/admin/config` | Update configuration (API keys, models, etc.) |
| GET | `/api/admin/config/prompt` | Get system prompt |
| PUT | `/api/admin/config/prompt` | Update system prompt |
| GET | `/api/admin/chat-logs` | Get all chat logs |
| GET | `/api/admin/chat-logs/conversations` | Get conversations summary |
| GET | `/api/admin/chat-logs/conversations/:id` | Get conversation log |
| GET | `/api/admin/chat-logs/export` | Export logs as CSV |
| DELETE | `/api/admin/chat-logs` | Clear all logs |
| GET | `/api/admin/health` | Health check |
| GET | `/api/admin/errors` | Error logs |

### Settings (requires auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get user settings |
| PATCH | `/api/settings` | Update user settings |

## How It Works

DocChat AI uses **Retrieval-Augmented Generation (RAG)** to answer questions from your documents:

1. **Upload** — Text is extracted from uploaded files (PDF, DOCX, TXT, Markdown, Excel)
2. **Chunk** — Text is split into overlapping semantic chunks (~512 tokens) preserving paragraph and heading boundaries
3. **Embed** — Each chunk is converted into a numerical vector using the embedding model
4. **Store** — Vectors are saved in the database alongside metadata (document name, page, heading)
5. **Query** — When a user asks a question, it's converted to a vector
6. **Search** — Cosine similarity finds the most relevant chunks above the threshold
7. **Generate** — The top chunks are sent to the LLM with the system prompt; the LLM answers grounded in that context
8. **Cite** — Response includes document name and page number for each source

If no chunks match well enough, the bot reports it couldn't find the information and suggests rephrasing or uploading the relevant document.

## Default Credentials

There are no default credentials. On first launch, the system shows a one-time setup screen where you create the admin account (username + password of your choice). After that, the setup screen is permanently disabled — all additional users must be created by an admin.

## Backup

To back up the entire system, copy:
- `data/chatbot.db` — contains all data (users, documents metadata, embeddings, chat history, configuration)
- `uploads/` — contains the original uploaded files

## License

MIT
