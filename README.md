# DocuChat AI

Self-hosted document AI chatbot using RAG (Retrieval-Augmented Generation). Upload documents, add website URLs, ask questions, get answers grounded only in your sources with citations.

## Features

- **Username/password authentication** (no email required)
- **First user auto-becomes admin** — no self-registration
- **Admin creates users** with username, display name, password, and role
- **Role-based access**: Admin (all tabs), User (chat only)
- **Document upload**: PDF, DOCX, TXT, Markdown, Excel (.xlsx)
- **Web URL sources**: Paste a URL → content is scraped and indexed
- **Multi-file drag-and-drop upload** with progress indicator
- **Batch select & delete** documents with checkboxes
- **Re-upload same filename** replaces old version automatically
- **Re-embed All** button: regenerate embeddings without re-uploading after changing embedding model
- **Document processing**: text extraction (page-by-page for PDFs), semantic chunking, embeddings
- **Accurate page citations**: PDF pages, DOCX sections, Excel sheet names
- **Auto-polling document status** (processing → ready)
- **Retry failed documents** without re-uploading
- **RAG chat**: vector search + LLM with streaming responses
- **Inline citations** with document name, page number, and dates for chronological updates
- **Conflict resolution**: latest document/update wins, conflicts are reported
- **Configurable LLM**: OpenAI, Gemini, Claude, OpenRouter, Local (Ollama)
- **Configurable embedding model**: switch models and re-embed from UI
- **Configurable system prompt** from Admin UI
- **API keys configured in UI** (not env vars)
- **Conversation management**: pin, delete, clear all, 20-chat auto-limit
- **Chat Logs tab**: admin sees all chats ever, export as CSV
- **Help tab**: complete documentation for admins
- **Mobile-friendly** with hamburger menu drawer
- **Light theme**, monochrome design
- **Reverse proxy ready** with `trust proxy` support for HTTPS deployments

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: sql.js (SQLite via WebAssembly — no native compilation needed)
- **Frontend**: Vanilla JS single-page app (no framework, no build step)
- **Embeddings**: OpenAI `text-embedding-3-small` or `text-embedding-3-large` (configurable)
- **LLM**: Configurable — OpenAI, Gemini, Claude, OpenRouter, or local Ollama
- **Web scraping**: Cheerio for URL source extraction

## Quick Start

```bash
cd document-chatbot
npm install
npm start
```

Open `http://localhost:3000`. First visit shows a one-time setup screen to create the admin account.

1. Log in → **Admin** tab → set LLM provider and API key
2. **Documents** tab → upload knowledge documents or add URLs
3. Wait for "ready" status
4. **Chat** tab → ask questions

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | `fallback-dev-secret` | Session signing secret (change in production) |

All other configuration (API keys, models, temperature, prompt) is managed through the Admin UI.

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
│   ├── models/              # Data access (User, Document, Chunk, Embedding, ChatLog, etc.)
│   ├── routes/              # Express route definitions
│   ├── services/            # Business logic
│   │   ├── extractors/      # PDF, DOCX, TXT, MD, Excel extractors
│   │   ├── webScraper.js    # URL content extraction
│   │   ├── chunker.js       # Semantic text chunking with page tracking
│   │   ├── embeddingService.js
│   │   ├── vectorSearch.js  # Cosine similarity search
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
- `POST /api/auth/setup` — Create initial admin
- `POST /api/auth/login` — Log in (username + password)
- `POST /api/auth/logout` — Log out
- `GET /api/auth/profile` — Current user

### Documents
- `GET /api/documents` — List all
- `POST /api/documents/upload` — Upload file (multipart)
- `POST /api/documents/import-url` — Add URL source
- `POST /api/documents/reprocess-all` — Re-embed all documents
- `POST /api/documents/:id/reindex` — Retry single document
- `DELETE /api/documents/:id` — Delete document

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
- `GET /api/admin/chat-logs/conversations` — Chat log summaries
- `GET /api/admin/chat-logs/conversations/:id` — Conversation detail
- `GET /api/admin/chat-logs/export` — Export CSV
- `DELETE /api/admin/chat-logs` — Clear all logs

## How It Works

1. **Upload** — Text extracted from files (page-by-page for PDFs) or scraped from URLs
2. **Chunk** — Split into overlapping semantic chunks (~800 tokens) with page/section tracking
3. **Embed** — Each chunk converted to a vector (1536 or 3072 dimensions)
4. **Store** — Vectors saved with metadata (document, page, heading)
5. **Query** — User question converted to vector → cosine similarity search
6. **Generate** — Top matching chunks sent to LLM with system prompt → grounded answer with citations

## Deployment

See the Help tab in the app for complete documentation, or copy the project to your VPS:

```bash
# Copy project (exclude node_modules)
scp -r document-chatbot/ user@vps:/home/user/

# On VPS
cd document-chatbot
npm install
npm install -g pm2
pm2 start src/index.js --name docuchat
pm2 save && pm2 startup
```

For HTTPS, put Nginx in front with SSL termination. The app includes `trust proxy` support for reverse proxy deployments.

## Backup

Copy these two items to back up everything:
- `data/chatbot.db` — all data
- `uploads/` — original files

## License

MIT
