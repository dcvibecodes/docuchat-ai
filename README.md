# DocuChat AI v2.4.0

Self-hosted document AI chatbot using RAG (Retrieval-Augmented Generation). Upload documents, add website URLs, import entire sites via sitemap, ask questions, get answers grounded only in your sources with citations.

## Features

### Chat & UX
- **RAG-powered chat** — answers only from uploaded document content, never from outside knowledge
- **Streaming responses** — word-by-word display (toggleable)
- **Inline citations** — document name, page number, and dates for chronological updates
- **Personalized greeting** — "Good morning/afternoon/evening, [Name]!" with "How can I help you today?"
- **Suggested prompts** — up to 10 admin-configured prompts shown as cards on empty chat (drag-to-reorder, editable)
- **Conversation management** — pin, delete, clear all, 20-chat auto-limit, no duplicate blank chats
- **Regenerate & copy** — hover actions on AI responses
- **Dark theme** — 3-way toggle (Auto/Light/Dark) with system preference detection and localStorage persistence
- **Keyboard shortcuts** — Ctrl+Shift+O / ⌘⇧O (new chat), Ctrl+Shift+Backspace / ⌘⇧⌫ (clear all), Escape (close dialogs)
- **Help tab visible to all users** — user-friendly content for regular users, admin-specific sections for admins
- **Mobile responsive** — hamburger menu with theme toggle, all features accessible on mobile
- **Password change** — available to all users from header or mobile menu

### Knowledge Base
- **Multi-file drag-and-drop upload** with progress indicator
- **Web URL scraping** — paste a URL to scrape and index content as a document source
- **Sitemap import (Tech Admin)** — two-phase architecture: scrape first, then embed one-by-one to prevent server overload
- **Source groups** — sitemap imports appear as a single group block, not individual entries
- **Sync** — re-scan a sitemap to find and import only new pages since last import
- **Live progress** — real-time progress indicator for sitemap import (scraping phase → processing phase) with count
- **Per-document progress bar** — visual indicator on each "processing" document showing extraction → chunking → embedding stages
- **Enable/disable toggle** — turn any document or source group on/off instantly without re-processing; disabled sources are excluded from chat
- **Supported formats** — PDF, DOCX, TXT, Markdown, Excel (.xlsx/.xls), CSV, Web URLs
- **Format guidance** — hints in UI: PDF/Word/Markdown best for SOPs; Excel/CSV best for reference data
- **Re-embed All** — regenerate embeddings without re-uploading after changing embedding model
- **Re-upload same filename** replaces old version automatically
- **Retry failed documents** without re-uploading
- **Auto-polling status** — processing → ready (refreshes every 3 seconds)
- **Accurate page citations** — PDF pages, DOCX sections, Excel sheet names

### Admin & Configuration
- **3-tier roles: user, admin, techadmin**
  - User: Chat + Help only
  - Admin: Chat + Knowledge + Chat Logs + Admin (except AI config/prompt) + Help
  - Tech Admin: Everything including AI configuration, system prompt, and sitemap import
- **AI Configuration** — LLM provider (OpenAI, Gemini, Claude, OpenRouter, Local/Ollama), embedding model, temperature, max chunks, similarity threshold, streaming toggle
- **Sitemap URL cap** — configurable max URLs per import (0 = no limit), tech admin only
- **System prompt** — configurable from Admin UI, controls grounding, citations, conflict resolution
- **User Management** — create users (username + display name + password + role), promote/demote, remove
- **Chat usage bar chart** with date range selector (today, 7/30/90/180/365 days)
- **Chat Logs** — view all user conversations (persists even after user deletion), search, expand, export as CSV, clear all
- **API keys configured in UI** — not in environment variables

### Infrastructure
- **Username/password auth** — no email required, first user auto-becomes tech admin, no self-registration
- **Reverse proxy ready** — `trust proxy` support for HTTPS/Nginx deployments
- **Sessions** — in-memory with memorystore
- **Conflict resolution** — latest document/update wins, conflicts reported in responses
- **No build step** — vanilla JS single-page app frontend
- **Safe migrations** — new schema changes applied non-destructively on startup; existing data preserved
- **Server stability** — all network calls have hard timeouts, import lock prevents concurrent overload, periodic DB saves during long operations

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: sql.js (SQLite via WebAssembly — no native compilation needed)
- **Frontend**: Vanilla JS single-page app (no framework, no build step)
- **Embeddings**: OpenAI `text-embedding-3-small` or `text-embedding-3-large` (configurable)
- **LLM**: Configurable — OpenAI, Gemini, Claude, OpenRouter, or local Ollama
- **Web scraping**: Cheerio for URL source extraction and sitemap parsing

## Quick Start

```bash
cd document-chatbot
npm install
npm start
```

Open `http://localhost:3000`. First visit shows a one-time setup screen to create the tech admin account.

1. Log in → **Admin** tab → set LLM provider and API key
2. **Knowledge** tab → upload knowledge documents or add URLs
3. Wait for "ready" status
4. **Chat** tab → ask questions

## Upgrading from v2.2.0 / v2.3.0

No manual steps required. The migration runs automatically on startup and:
- Creates the `source_groups` table
- Adds `group_id`, `enabled`, and `processing_progress` columns to existing documents (defaults to enabled, 0% progress)
- Removes dependency on the `email` column in user creation (fixes first-login error on fresh databases)
- All existing data, documents, embeddings, and conversations are preserved
- No re-indexing or re-embedding needed
- Previously imported sitemap URLs (e.g., 671 already imported) remain as-is and continue to work; they won't have a source group assigned but will function normally as individual URL documents

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | `fallback-dev-secret` | Session signing secret (change in production) |

All other configuration (API keys, models, temperature, prompt) is managed through the Admin UI.

## Keyboard Shortcuts

| Action | Windows / Linux | Mac |
|--------|----------------|-----|
| New chat | Ctrl+Shift+O | ⌘⇧O |
| Clear all chats | Ctrl+Shift+Backspace | ⌘⇧⌫ |
| Send message | Enter | Enter |
| New line | Shift+Enter | Shift+Enter |
| Close dialog | Escape | Escape |

## Project Structure

```
document-chatbot/
├── public/                  # Frontend
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── favicon.svg
├── src/
│   ├── index.js             # Express server
│   ├── config/index.js
│   ├── controllers/         # Route handlers
│   ├── database/            # sql.js connection, migrations, query layer
│   ├── middleware/           # Auth, validation, upload, error handling
│   ├── models/              # Data access (User, Document, SourceGroup, Chunk, Embedding, ChatLog, etc.)
│   ├── routes/              # Express route definitions
│   ├── services/            # Business logic
│   │   ├── extractors/      # PDF, DOCX, TXT, MD, Excel, CSV extractors
│   │   ├── webScraper.js    # URL content extraction (45s timeout)
│   │   ├── sitemapService.js # Sitemap discovery, parsing, and auto-detection
│   │   ├── chunker.js       # Semantic text chunking with page tracking
│   │   ├── embeddingService.js  # OpenAI/local embeddings (60s timeout per batch)
│   │   ├── documentProcessor.js # Two-phase: extract+chunk+embed with progress reporting
│   │   ├── vectorSearch.js  # Cosine similarity search (filters disabled sources)
│   │   ├── llmService.js    # Multi-provider LLM client
│   │   └── ragService.js    # RAG pipeline orchestration
│   └── utils/
├── data/                    # SQLite database (auto-created)
├── uploads/                 # Uploaded files (auto-created)
└── package.json
```

## API Endpoints

### Auth
- `GET /api/auth/needs-setup` — Check if first-time setup needed
- `POST /api/auth/setup` — Create initial tech admin
- `POST /api/auth/login` — Log in (username + password)
- `POST /api/auth/logout` — Log out
- `GET /api/auth/profile` — Current user
- `POST /api/auth/change-password` — Change password

### Documents / Knowledge
- `GET /api/documents` — List all
- `POST /api/documents/upload` — Upload file (multipart)
- `POST /api/documents/import-url` — Add URL source
- `POST /api/documents/reprocess-all` — Re-embed all documents
- `POST /api/documents/:id/reindex` — Retry single document
- `PATCH /api/documents/:id/toggle` — Enable/disable a document
- `DELETE /api/documents/:id` — Delete document

### Source Groups
- `GET /api/documents/groups` — List all source groups
- `POST /api/documents/groups/:id/sync` — Sync: import new pages from sitemap
- `PATCH /api/documents/groups/:id/toggle` — Enable/disable entire group
- `DELETE /api/documents/groups/:id` — Delete group and all its pages

### Sitemap Import (Tech Admin)
- `POST /api/documents/sitemap/discover` — Discover URLs from sitemap or domain
- `POST /api/documents/sitemap/import` — Start two-phase background import
- `GET /api/documents/sitemap/progress` — Poll import progress (phase, completed, total, failed)

### Chat
- `GET /api/chat/conversations` — List conversations
- `POST /api/chat/conversations` — Create conversation
- `PATCH /api/chat/conversations/:id` — Update (rename, pin)
- `DELETE /api/chat/conversations/:id` — Delete
- `GET /api/chat/conversations/:id/messages` — Get messages
- `POST /api/chat/conversations/:id/messages?stream=true` — Send message
- `POST /api/chat/conversations/:id/regenerate` — Regenerate last response

### Admin
- `GET /api/admin/stats` — System statistics
- `GET /api/admin/users` — List users
- `POST /api/admin/users` — Create user
- `PATCH /api/admin/users/:id/role` — Change role
- `DELETE /api/admin/users/:id` — Delete user
- `GET /api/admin/config` — Get configuration
- `PATCH /api/admin/config` — Update configuration
- `GET /api/admin/config/prompt` — Get system prompt
- `PUT /api/admin/config/prompt` — Update system prompt
- `GET /api/admin/config/suggested-prompts` — Get suggested prompts
- `PUT /api/admin/config/suggested-prompts` — Update suggested prompts
- `GET /api/admin/chat-logs/conversations` — Chat log summaries
- `GET /api/admin/chat-logs/conversations/:id` — Conversation detail
- `GET /api/admin/chat-logs/export` — Export CSV
- `GET /api/admin/chat-logs/stats` — Chat usage stats (for chart)
- `DELETE /api/admin/chat-logs` — Clear all logs

### Settings (all users)
- `GET /api/settings/suggested-prompts` — Get suggested prompts for chat UI

## How It Works

1. **Upload** — Text extracted from files (page-by-page for PDFs) or scraped from URLs
2. **Chunk** — Split into overlapping semantic chunks (~800 tokens) with page/section tracking
3. **Embed** — Each chunk converted to a vector (1536 or 3072 dimensions) — done serially, one document at a time
4. **Store** — Vectors saved with metadata (document, page, heading)
5. **Query** — User question converted to vector → cosine similarity search (only enabled sources)
6. **Generate** — Top matching chunks sent to LLM with system prompt → grounded answer with citations

## Sitemap Import Architecture

The sitemap import uses a two-phase approach designed for low-memory servers:

**Phase 1 (Scraping):** Each URL is fetched and saved as a text file. Documents are created with `status: 'processing'`. No AI API calls. One URL at a time, sequentially.

**Phase 2 (Processing):** Each saved document is processed one at a time — extract text, chunk, call embedding API, store vectors. Only one document's embeddings are in memory at any point.

This prevents the memory spikes and hanging promises that occur when scraping + embedding happen concurrently.

## Deployment

```bash
# Copy project to VPS (exclude node_modules)
scp -r document-chatbot/ user@vps:/home/user/

# On VPS
cd document-chatbot
npm install
npm install -g pm2
pm2 start src/index.js --name docuchat
pm2 save && pm2 startup
```

For HTTPS, put Nginx in front with SSL termination. The app includes `trust proxy` support for reverse proxy deployments.

**Minimum server requirements:** 512MB RAM (1GB recommended for sitemap imports of 1000+ URLs).

## Backup

Copy these two items to back up everything:
- `data/chatbot.db` — all data (users, embeddings, config, logs)
- `uploads/` — original uploaded documents

## License

MIT
