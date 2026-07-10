# DocuChat AI v2.0.0

Self-hosted document AI chatbot using RAG (Retrieval-Augmented Generation). Upload documents, ask questions, get answers grounded only in your documents with page-accurate citations.

## Features

### Authentication & Users
- Username + password authentication (no email required)
- First user automatically becomes admin — no self-registration
- Admin creates all user accounts (username, display name, password, role)
- Role-based access: **Admin** (all tabs) / **User** (chat only)
- Secure session management with proxy support for reverse-proxy deployments

### Documents
- Upload: PDF, DOCX, TXT, Markdown, Excel (.xlsx/.xls)
- Multi-file drag-and-drop upload
- Re-upload same filename automatically replaces old version (no duplicates)
- Page-accurate extraction: PDF pages tracked individually, DOCX sections by heading, Excel by sheet
- Auto-polling status (processing → ready) with real-time updates
- Retry failed documents without re-uploading
- **Re-embed All** button: regenerate embeddings when switching embedding models — no re-upload needed
- Semantic chunking with configurable chunk size and overlap

### Chat
- RAG pipeline: vector search → relevant chunks → LLM generates grounded answer
- Streaming responses (word-by-word)
- Citations with document name, page number, and section heading
- Conflict resolution: latest document/latest update wins, conflicts explicitly mentioned
- Conversation management: pin, delete, clear all
- 20-chat auto-limit (oldest unpinned auto-pruned)
- Copy and Regenerate on any AI response

### AI Configuration (Admin UI)
- Configurable LLM: OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Local (Ollama)
- Configurable embedding model (text-embedding-3-small, text-embedding-3-large, etc.)
- API keys managed in UI (not env vars) — masked display, stored securely
- Editable system prompt controlling AI behavior, citation format, conflict rules
- Temperature, max chunks, similarity threshold — all adjustable at runtime

### Chat Logs (Admin)
- Permanent log of every message from every user
- Persists even after users clear their conversations
- Search across all messages
- Expand conversations to view full threads
- Export as CSV for FAQ analysis and training needs identification
- Admin can clear logs when needed

### Mobile
- Fully responsive design
- Hamburger menu (slides from right) with navigation + conversation list
- iOS Safari compatible (dynamic viewport, touch scrolling, no zoom on input)
- Works on phones and tablets

### Design
- Light theme, monochrome design language (matching dictation app style)
- Inter font, compact typography
- Clean, minimal UI with no unnecessary elements

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express |
| Database | sql.js (SQLite, pure JS, no native compilation) |
| Frontend | Vanilla HTML/CSS/JS (no framework, no build step) |
| Embeddings | OpenAI text-embedding-3-small/large (configurable) |
| LLM | OpenAI, Gemini, Claude, OpenRouter, Ollama (configurable) |
| Vector Search | In-memory cosine similarity |

## Quick Start

```bash
cd document-chatbot
npm install
npm start
```

Open `http://localhost:3000`. First visit shows a one-time admin setup screen.

1. Create admin account (username + password)
2. Admin tab → set LLM provider + API key
3. Documents tab → upload knowledge documents
4. Wait for "ready" status
5. Chat tab → ask questions

## Environment Variables

Only two needed in `.env`:

| Variable | Default | Required |
|----------|---------|----------|
| `PORT` | `3000` | No |
| `SESSION_SECRET` | `fallback-dev-secret` | Yes (change in production) |

Generate a secure secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

All other configuration (API keys, models, prompt, thresholds) is managed through the Admin UI at runtime.

## Project Structure

```
document-chatbot/
├── public/                      # Frontend SPA
│   ├── index.html              # Single-page app
│   ├── app.js                  # All frontend logic
│   ├── styles.css              # Light monochrome theme
│   └── favicon.svg             # Bot face icon
├── src/
│   ├── index.js                # Express server + middleware
│   ├── config/index.js         # Environment config
│   ├── controllers/            # Route handlers (auth, chat, documents, admin)
│   ├── database/               # sql.js connection, query helper, migrations
│   ├── middleware/             # Auth, validation, upload, error handling
│   ├── models/                 # Data access (User, Document, Chunk, Embedding, ChatLog, etc.)
│   ├── routes/                 # Express route definitions
│   ├── services/               # Business logic
│   │   ├── extractors/         # PDF, DOCX, TXT, MD, Excel text extraction
│   │   ├── chunker.js          # Semantic chunking with page/section tracking
│   │   ├── embeddingService.js # OpenAI/local embedding generation
│   │   ├── vectorSearch.js     # Cosine similarity search
│   │   ├── llmService.js       # Multi-provider LLM (OpenAI, Gemini, Claude, etc.)
│   │   ├── ragService.js       # RAG orchestration + streaming
│   │   └── documentProcessor.js # Upload pipeline orchestration
│   └── utils/                  # Logger, error classes
├── data/chatbot.db             # SQLite database (all data)
├── uploads/                    # Original uploaded files
├── DEPLOYMENT.md               # VPS deployment guide
├── .env.example                # Environment template
└── package.json
```

## API Endpoints

### Auth
- `GET /api/auth/needs-setup` — Check if first-time setup needed
- `POST /api/auth/setup` — Create initial admin (one-time)
- `POST /api/auth/login` — Login (username + password)
- `POST /api/auth/logout` — Logout
- `GET /api/auth/profile` — Current user profile

### Documents
- `GET /api/documents` — List all documents
- `POST /api/documents/upload` — Upload file (multipart)
- `POST /api/documents/reprocess-all` — Re-embed all documents
- `POST /api/documents/:id/reindex` — Retry single document
- `DELETE /api/documents/:id` — Delete document

### Chat
- `GET /api/chat/conversations` — List conversations
- `POST /api/chat/conversations` — Create conversation
- `PATCH /api/chat/conversations/:id` — Update (rename, pin/unpin)
- `DELETE /api/chat/conversations/:id` — Delete conversation
- `GET /api/chat/conversations/:id/messages` — Get messages
- `POST /api/chat/conversations/:id/messages?stream=true` — Send message (SSE streaming)
- `POST /api/chat/conversations/:id/regenerate` — Regenerate last response

### Admin
- `GET /api/admin/stats` — System statistics
- `GET /api/admin/config` — Get configuration
- `PATCH /api/admin/config` — Update configuration
- `GET /api/admin/config/prompt` — Get system prompt
- `PUT /api/admin/config/prompt` — Update system prompt
- `GET /api/admin/users` — List users
- `POST /api/admin/users` — Create user
- `PATCH /api/admin/users/:id/role` — Change role
- `DELETE /api/admin/users/:id` — Delete user
- `GET /api/admin/chat-logs/conversations` — Chat log summaries
- `GET /api/admin/chat-logs/conversations/:id` — Full conversation log
- `GET /api/admin/chat-logs/export` — Download CSV
- `DELETE /api/admin/chat-logs` — Clear all logs

## How It Works

1. **Upload** → Text extracted page-by-page (PDF), by section (DOCX), by sheet (Excel)
2. **Chunk** → Split into ~800-token overlapping segments preserving structure
3. **Embed** → Each chunk converted to 1536/3072-dimension vector via embedding API
4. **Store** → Vectors saved with metadata (page number, section heading, document name)
5. **Query** → User question embedded → cosine similarity finds top matching chunks
6. **Generate** → Top chunks sent to LLM with system prompt → grounded answer with citations

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete VPS deployment instructions including:
- File transfer
- PM2 / systemd setup
- Nginx reverse proxy with SSL
- Backup strategy
- Troubleshooting

Key note: When running behind a reverse proxy (Nginx), `trust proxy` is enabled for proper session handling over HTTPS.

## Backup

Copy these two items to preserve everything:
- `data/chatbot.db` — all data (users, embeddings, config, chat history, API keys)
- `uploads/` — original uploaded files (needed for re-embedding)

## License

MIT
