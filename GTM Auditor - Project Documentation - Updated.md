GTM Auditor - Complete Project Documentation
Version: 2.0 - Last Updated: April 21, 2026
An AI-powered chat application for analyzing Google Tag Manager containers, built on Cloudflare's serverless stack.

Table of Contents
1. Executive Summary
2. Technology Stack
3. System Architecture
4. Project File Map
5. Frontend - Source Code Walkthrough
6. Backend - Cloudflare Worker
7. API Reference
8. Database Schema (Cloudflare D1)
9. Cloudflare KV Storage
10. AI Integration - Google Gemini
11. Real-Time Streaming Pipeline
12. Build & Development
13. Deployment (Detailed)
14. Environment Variables & Secrets
15. Utility Modules
16. Security Considerations
17. Known Limitations & Future Work

---

1. Executive Summary

GTM Auditor is a full-stack, AI-powered web application that lets users ask natural-language questions about their Google Tag Manager (GTM) container configuration. The application ingests a raw GTM container JSON export, feeds it to Google's Gemini LLM as persistent context, and provides an interactive chat interface where users receive streamed, real-time AI analysis of their tags, triggers, variables, consent settings, and overall container health.

Core Value Proposition

Problem: GTM containers can have 100+ tags with thousands of lines of JSON - auditing them manually is slow and error-prone
Solution: The AI has the full container pre-loaded as context and can instantly answer questions about any tag, trigger, or variable

Problem: Container exports are difficult for non-technical stakeholders to understand
Solution: The LLM translates raw JSON into plain-English explanations

Problem: Typically, auditing requires exporting, reading, cross-referencing trigger IDs, checking consent settings one by one
Solution: Users simply ask "Are there any missing consent settings?" and get a structured Markdown answer

How It Works (30-Second Version)
1. A GTM container JSON is pre-loaded into Cloudflare KV storage.
2. When a user asks a question, the Cloudflare Worker fetches the container from KV, creates (or reuses) a Gemini Context Cache containing that JSON, and streams the AI response back via Server-Sent Events (SSE).
3. The React frontend renders the streamed Markdown response in real-time with a typing indicator.
4. Both the question and answer are persisted to Cloudflare D1 (SQLite) for cross-session history.

---

2. Technology Stack

Frontend:
- React 19.0.0 - UI component library
- Vite 6.2.0 - Build tool & dev server
- TypeScript 5.8.2 - Type-safe JavaScript
- Tailwind CSS 4.1.14 - Utility-first CSS framework
- @tailwindcss/typography 0.5.19 - Prose styling for rendered Markdown
- react-markdown 10.1.0 - Renders AI responses as rich Markdown
- lucide-react 0.546.0 - Icon library (FileJson, Send, Menu, etc.)
- clsx 2.1.1 + tailwind-merge 3.5.0 - Conditional className composition
- motion 12.23.24 - Animation library

Backend:
- Cloudflare Workers - Serverless edge compute (runs worker.ts)
- Cloudflare D1 - Serverless SQLite database (stores chat sessions & messages)
- Cloudflare KV - Key-Value storage (caches GTM container JSON + Gemini cache name)
- @google/genai 1.29.0 - Official Google Generative AI SDK for Gemini API calls
- Wrangler 4.82.2 - Cloudflare CLI for local dev & deployment

Tooling:
- pnpm - Package manager (primary)
- tsx 4.21.0 - TypeScript execution for Node.js scripts
- autoprefixer 10.4.21 - CSS vendor prefixing

---

3. System Architecture

High-Level Data Flow:
User -> React SPA -> fetch() -> Cloudflare Worker -> {KV, D1, Gemini} -> SSE Stream -> React -> rendered Markdown

Component Relationships:
main.tsx (Entry Point) -> App.tsx (State Manager) -> Sidebar.tsx (Session List) + Dashboard.tsx (Chat UI)
Both Sidebar.tsx and Dashboard.tsx -> chatApi.ts (API Service Layer) -> HTTP -> worker.ts (Cloudflare Worker)

---

4. Project File Map

gtm-auditor_L/
+-- .env                          # Environment variables (API keys + worker URL)
+-- .gitignore                    # Git exclusions (incl. Cloudflare-specific)
+-- .wrangler/                    # Wrangler local state (auto-generated)
+-- dist/                         # Vite build output (production frontend)
+-- src/                          # Frontend source code
|   +-- App.tsx                   # Root component - session state manager
|   +-- main.tsx                  # React DOM entry point
|   +-- index.css                 # Tailwind CSS import + typography plugin
|   +-- vite-env.d.ts             # Vite/TypeScript ambient declarations
|   +-- components/
|   |   +-- Dashboard.tsx         # Chat interface - messages, input, streaming
|   |   +-- Sidebar.tsx           # Session list - create, rename, delete, group by date
|   +-- services/
|   |   +-- chatApi.ts            # API client - all HTTP calls + SSE stream parser
|   +-- utils/
|   |   +-- clean-json.ts         # Strips control characters from raw JSON strings
|   |   +-- gtm-minifier.ts       # Minifies GTM container JSON (320 lines, standalone)
|   +-- Container/
|       +-- GTM-T5MTQWP_workspace580 (11 Apr 2026).json  # Raw GTM export (~1.6MB)
|       +-- container-minified.json                       # Minified version (~771KB)
+-- worker.ts                     # Cloudflare Worker - backend API + Gemini integration
+-- schema.sql                    # D1 database schema (sessions + messages tables)
+-- wrangler.toml                 # Cloudflare Worker configuration & bindings
+-- vite.config.ts                # Vite build configuration
+-- tsconfig.json                 # TypeScript compiler options
+-- package.json                  # Dependencies, scripts, project metadata
+-- index.html                    # Vite HTML template (dev entry point)
+-- get-minified.ts               # TypeScript minification script (run via tsx)
+-- get-minified.js               # Compiled JS version of the minification script
+-- metadata.json                 # App metadata (name, description)
+-- README.md                     # Setup instructions & project overview

File Size Reference:
- Raw GTM Container JSON: ~1.6 MB (Original export from GTM)
- Minified Container JSON: ~771 KB (After minification, ~52% reduction)
- worker.ts: ~13 KB (Entire backend in one file)
- Dashboard.tsx: ~11 KB (Largest frontend component)
- Sidebar.tsx: ~10 KB (Second largest component)
- gtm-minifier.ts: ~11 KB (320 lines of GTM-specific minification logic)
- chatApi.ts: ~4 KB (Complete API service layer)
- App.tsx: ~7 KB (Root state management)

---

5. Frontend - Source Code Walkthrough

5.1 Entry Point: main.tsx
Standard React 19 entry point. Renders <App /> inside <StrictMode> into the #root DOM element. Imports index.css which initializes Tailwind CSS and the typography plugin.

5.2 Root Component: App.tsx (176 lines)
Purpose: Top-level orchestrator. Owns all session state and renders the layout shell (Header -> Sidebar + Main Panel).

State Variables:
- sessions (ChatSession[]) - All chat sessions from the database
- activeSessionId (string | null) - Currently viewed session
- isSidebarOpen (boolean) - Mobile sidebar drawer toggle
- isLoadingSessions (boolean) - Loading spinner during initial fetch

Key Behaviors:
1. On mount: Calls chatApi.getSessions(), populates the session list, and restores the last-active session ID from localStorage('gtm_active_session').
2. New Chat: Generates a UUID via crypto.randomUUID(), calls chatApi.createSession(), prepends the new session to state, and sets it as active.
3. Session Selection: Updates activeSessionId and persists to localStorage.
4. Session Rename: Updates the title in local state. Called both from inline edit (Sidebar) and auto-title (Dashboard).
5. Session Delete: Calls chatApi.deleteSession(), removes from state, and auto-switches to the next session if the deleted one was active.
6. Auto-Title: After the first AI response in a new session, Dashboard calls this to update the sidebar title.

5.3 Chat Interface: Dashboard.tsx (260 lines)
Purpose: Renders the chat conversation for a single session - message history, input field, streaming AI responses, and contextual prompts.

Message Send Flow:
1. Validate input is non-empty and not already sending.
2. Clear the input field.
3. Optimistic UI update: Append the user's message + an empty model placeholder.
4. Set isSendingChat = true, isStreaming = true.
5. Call chatApi.sendMessageStream(sessionId, question, onChunk).
6. Each onChunk callback appends text to the last model message in state.
7. On success: If this is the first message in a new session, auto-title it.
8. On error: Replace the model placeholder with an error message.
9. Finally: Set isSendingChat = false, isStreaming = false.

5.4 Session Sidebar: Sidebar.tsx (270 lines)
Purpose: Displays the list of chat sessions grouped by date (Today, Yesterday, This Week, Earlier), with inline rename and delete capabilities.

Responsive Behavior: Renders two <aside> elements - Desktop (always visible, w-72) and Mobile (slide-in drawer with backdrop overlay).

5.5 API Service Layer: chatApi.ts (135 lines)
Purpose: Centralizes all HTTP communication with the Cloudflare Worker backend.

[UPDATED] Base URL - Now uses environment variable:
  const BASE = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? '';

This is resolved at build time from the VITE_WORKER_URL environment variable.
- For local development: Set VITE_WORKER_URL=http://localhost:8787 in .env
- For production: Set VITE_WORKER_URL in Cloudflare Pages dashboard -> Settings -> Environment Variables

Methods:
- getSessions() - GET /api/sessions - List all sessions
- createSession(id, title) - POST /api/sessions - Create a new session
- renameSession(id, title) - PATCH /api/sessions/:id - Update session title
- deleteSession(id) - DELETE /api/sessions/:id - Delete session + messages
- getMessages(sessionId) - GET /api/sessions/:id/messages - Fetch all messages
- sendMessageStream(sessionId, question, onChunk) - POST /api/chat - Streamed SSE response

---

6. Backend - Cloudflare Worker

worker.ts (309 lines)
The entire backend is a single Cloudflare Worker file. It handles routing, database access, KV storage, Gemini API communication, and SSE streaming.

6.1 Environment Bindings:
- GEMINI_API_KEY (string) - Secret, set via wrangler secret put
- GTM_CONTAINER (KVNamespace) - Cloudflare KV namespace
- gtm_chat_history (D1Database) - Cloudflare D1 SQLite database

6.2 Constants:
- GEMINI_MODEL: 'gemini-3.1-pro-preview'
- CACHE_TTL_SECONDS: 1800 (30 min)
- KV_CACHE_KEY: 'gemini_cache_name'
- SYSTEM_INSTRUCTION: "You are an expert Google Tag Manager (GTM) Architect and Analyst..."

6.3 Request Routing (manual URL parsing, no framework):
- OPTIONS * -> 204 with CORS headers (preflight)
- GET /api/sessions -> List all sessions
- POST /api/sessions -> Create session
- PATCH /api/sessions/:id -> Rename session
- DELETE /api/sessions/:id -> Delete session + messages
- GET /api/sessions/:id/messages -> List messages for session
- POST /api/chat -> Send question, stream AI response
- * -> 404 Not Found

6.4 Context Cache Management - getOrCreateCache():
1. Check KV for existing cache name
2. If found, verify with Gemini API (caches.get)
3. If valid, return existing cache name
4. If expired/invalid or not found, create new cache via caches.create()
5. Store new cache name in KV with matching TTL
6. If creation fails, return null (fallback to inline context)

6.5 Chat Endpoint - POST /api/chat (Detailed Walkthrough):
1. Parse body: Extract { question, sessionId }
2. Validate: Ensure question is non-empty, GEMINI_API_KEY exists
3. Fetch container from KV with 1-hour edge cache
4. Initialize Gemini SDK
5. Build conversation history from D1
6. Get or create context cache
7. Build request config (with cache or inline fallback)
8. Create TransformStream for SSE output
9. Return readable side immediately as HTTP response
10. Async streaming pipeline: generateContentStream -> write SSE chunks -> persist to D1 -> close writer

---

7. API Reference

GET /api/sessions - List all chat sessions, ordered by most recently updated.
POST /api/sessions - Create a new chat session. Body: { id, title }
PATCH /api/sessions/:id - Rename a session. Body: { title }
DELETE /api/sessions/:id - Delete a session and all its messages.
GET /api/sessions/:id/messages - Fetch all messages for a session.
POST /api/chat - Send a question and receive a streaming SSE response. Body: { sessionId, question }

SSE Stream Format:
  data: {"text":"Based on your container"}
  data: {"text":", the following tags are"}
  data: [DONE]

Error within stream:
  data: {"error":"error message here"}

---

8. Database Schema (Cloudflare D1)

Database name: gtm-chat-history
Database ID: dedc40ee-7534-4114-a48d-d6c737276a24
Schema file: schema.sql

Tables:

sessions:
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    title      TEXT    NOT NULL DEFAULT 'New Chat',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

messages:
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    role       TEXT    NOT NULL CHECK(role IN ('user', 'model')),
    text       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

Index:
  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, created_at);

A composite index on (session_id, created_at) optimizes the most common query: fetching all messages for a session in chronological order.

Initialization Command:
  npx wrangler d1 execute gtm-chat-history --file=./schema.sql --remote

---

9. Cloudflare KV Storage

Namespace Binding: GTM_CONTAINER
Namespace ID: 34c70e0d7e454cd5b7f96bbfc42b4954

Stored Keys:
- "container" -> The full GTM container JSON string (Persistent, no TTL) - Primary data source for AI analysis
- "gemini_cache_name" -> Gemini API cache identifier e.g. cachedContents/abc123 (TTL: 1800s / 30 min) - Cross-request reuse of Gemini context cache

Read Optimization:
  const containerJsonString = await env.GTM_CONTAINER.get('container', { cacheTtl: 3600 });

The cacheTtl: 3600 option tells Cloudflare to cache this KV read at the edge for up to 1 hour, avoiding round-trips to KV central storage.

---

10. AI Integration - Google Gemini

Model: gemini-3.1-pro-preview

Configuration:
- temperature: 0.3 (Low temperature for factual, deterministic GTM analysis)
- cachedContent: (dynamic) Points to the context cache containing the container JSON

Context Caching Benefits:
- Without Caching: ~200K+ input tokens per request -> With Caching: ~1K-5K tokens
- Without Caching: Slower (Gemini must process container each time) -> With Caching: Faster
- Without Caching: High API cost -> With Caching: Significantly lower cost

Fallback: If cache creation fails, the worker inlines the container JSON in the systemInstruction parameter.

---

11. Real-Time Streaming Pipeline

The streaming pipeline uses Server-Sent Events (SSE) over a Cloudflare Worker TransformStream.

End-to-end flow:
1. Frontend adds user message + empty model placeholder (optimistic UI)
2. chatApi.ts sends POST /api/chat { sessionId, question }
3. Worker creates TransformStream and returns readable side immediately
4. Worker calls Gemini generateContentStream()
5. For each chunk from Gemini: Worker writes SSE data, chatApi parses it, calls onChunk
6. Frontend appends each chunk to the model message and re-renders Markdown
7. On stream complete: Worker writes data: [DONE], persists both messages to D1
8. Frontend removes streaming cursor, resolves promise

---

12. Build & Development

NPM Scripts:
- dev (vite) - Start Vite dev server (frontend only, with HMR)
- dev:worker (wrangler dev) - Start Cloudflare Worker locally (backend with D1/KV)
- build (vite build) - Production build -> dist/ directory
- preview (vite preview) - Preview the production build locally
- get-minified (tsx get-minified.ts) - [UPDATED] Run GTM container minification via TypeScript
- lint (tsc --noEmit) - TypeScript type-checking without emitting files

Local Development Workflow:
  # Terminal 1 - Frontend
  pnpm run dev          # http://localhost:5173

  # Terminal 2 - Backend
  pnpm run dev:worker   # http://localhost:8787

[UPDATED] The frontend now reads VITE_WORKER_URL from the .env file at build time. For local development, set VITE_WORKER_URL=http://localhost:8787 in your .env file. This means you no longer need to manually edit chatApi.ts to switch between local and production backends.

---

13. Deployment (Detailed Guide)

This section provides a comprehensive, step-by-step guide for deploying the GTM Auditor application. The app consists of two independently deployed pieces:
  1. The BACKEND (Cloudflare Worker) - handles API requests and AI processing
  2. The FRONTEND (Cloudflare Pages) - serves the React single-page application

Both are hosted on Cloudflare's global edge network for low-latency access worldwide.

=== UNDERSTANDING THE ARCHITECTURE ===

The deployment architecture works like this:

  [User's Browser]
      |
      | (loads static HTML/JS/CSS)
      v
  [Cloudflare Pages]  ----- serves ----->  dist/ folder (React build output)
      |
      | (API calls via VITE_WORKER_URL)
      v
  [Cloudflare Worker]  ----- gtm-auditor-server.iammsk.workers.dev
      |         |
      |         +--- reads/writes ---> [Cloudflare D1] (chat history database)
      |         +--- reads/writes ---> [Cloudflare KV]  (GTM container JSON + cache)
      |
      +--- calls ---> [Google Gemini API] (AI responses)

The frontend is a static site (HTML + JS + CSS) that makes API calls to the Worker.
The Worker is the backend that handles all the logic, database access, and AI communication.
They are deployed separately but connected via the VITE_WORKER_URL environment variable.

=== PREREQUISITES ===

Before you begin, make sure you have:
  1. Node.js v18 or higher installed (https://nodejs.org/)
  2. pnpm package manager installed (https://pnpm.io/)
     Install it with: npm install -g pnpm
  3. A Cloudflare account (free tier works) at https://dash.cloudflare.com/
  4. A Google Gemini API key from https://ai.google.dev/
  5. Wrangler CLI installed globally:
     npm install -g wrangler
  6. Logged into Cloudflare via Wrangler:
     wrangler login
     (This opens a browser window for authentication)

=== FIRST-TIME SETUP (One-time only) ===

These steps only need to be done once when setting up the project for the first time.

Step 1: Install project dependencies
  pnpm install

Step 2: Create the KV Namespace
  KV (Key-Value) storage holds the GTM container JSON that the AI analyzes.

  Run this command:
    wrangler kv namespace create GTM_CONTAINER

  This will output something like:
    { binding = "GTM_CONTAINER", id = "abc123..." }

  Copy the "id" value and update it in wrangler.toml:
    [[kv_namespaces]]
    binding = "GTM_CONTAINER"
    id = "YOUR_KV_NAMESPACE_ID_HERE"

  Current ID in this project: 34c70e0d7e454cd5b7f96bbfc42b4954

Step 3: Upload the GTM Container JSON to KV
  The minified container JSON needs to be uploaded to KV so the Worker can access it.

  First, generate the minified container (if not already done):
    pnpm run get-minified

  Then upload it:
    npx wrangler kv:key put --namespace-id=34c70e0d7e454cd5b7f96bbfc42b4954 "container" --path=./src/Container/container-minified.json

  To verify the upload worked:
    npx wrangler kv:key get --namespace-id=34c70e0d7e454cd5b7f96bbfc42b4954 "container" | head -c 200

Step 4: Create the D1 Database
  D1 is Cloudflare's serverless SQLite database. It stores chat sessions and messages.

  Create the database:
    wrangler d1 create gtm-chat-history

  This will output something like:
    database_id = "xyz789..."

  Copy the database_id and update wrangler.toml:
    [[d1_databases]]
    binding = "gtm_chat_history"
    database_name = "gtm-chat-history"
    database_id = "YOUR_DATABASE_ID_HERE"

  Current ID in this project: dedc40ee-7534-4114-a48d-d6c737276a24

Step 5: Run the Database Schema Migration
  This creates the sessions and messages tables in D1:
    npx wrangler d1 execute gtm-chat-history --file=./schema.sql --remote

  To verify the tables were created:
    npx wrangler d1 execute gtm-chat-history --command="SELECT name FROM sqlite_master WHERE type='table'" --remote

  Expected output should show: sessions, messages

Step 6: Set the Gemini API Key as a Worker Secret
  Secrets are encrypted environment variables that are never exposed in code or logs.

    wrangler secret put GEMINI_API_KEY

  You will be prompted to paste your API key. Press Enter after pasting.

  IMPORTANT: This is NOT the same as the GEMINI_API_KEY in the .env file.
  - The .env file key is for LOCAL development only (used by wrangler dev).
  - The Worker Secret is for PRODUCTION (used by the deployed Worker).
  - Both should contain the same API key value.

  To update the secret later (e.g., if you rotate keys):
    wrangler secret put GEMINI_API_KEY
    (Just run the same command again and paste the new key)

=== DEPLOYING THE BACKEND (Cloudflare Worker) ===

The backend is deployed with a single command:
  npx wrangler deploy

What this does:
  1. Reads wrangler.toml for configuration
  2. Compiles worker.ts using esbuild (built into Wrangler)
  3. Uploads the compiled code to Cloudflare's edge network
  4. Binds the KV namespace and D1 database
  5. Makes the Worker available at: https://gtm-auditor-server.iammsk.workers.dev

Current wrangler.toml configuration:
  name = "gtm-auditor-server"
  main = "worker.ts"
  compatibility_date = "2024-01-01"
  compatibility_flags = ["nodejs_compat"]

  [[kv_namespaces]]
  binding = "GTM_CONTAINER"
  id = "34c70e0d7e454cd5b7f96bbfc42b4954"

  [[d1_databases]]
  binding = "gtm_chat_history"
  database_name = "gtm-chat-history"
  database_id = "dedc40ee-7534-4114-a48d-d6c737276a24"

After deployment, test the Worker by visiting:
  https://gtm-auditor-server.iammsk.workers.dev/api/sessions
  (Should return a JSON array, possibly empty: [])

=== DEPLOYING THE FRONTEND (Cloudflare Pages) ===

Step 1: Set the Worker URL environment variable in Cloudflare Pages
  Before deploying the frontend, you need to tell it where the backend Worker lives.

  Go to: Cloudflare Dashboard -> Pages -> gtm-auditor -> Settings -> Environment Variables
  Add this variable for BOTH Production and Preview:
    Variable name:  VITE_WORKER_URL
    Value:          https://gtm-auditor-server.iammsk.workers.dev

  WHY THIS MATTERS: The frontend's chatApi.ts reads this at build time:
    const BASE = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? '';
  Without it, API calls will go to the same origin (which won't work since Pages doesn't run the Worker).

Step 2: Build the frontend
  pnpm run build

  This creates a dist/ folder containing:
  - index.html (the HTML shell)
  - assets/ folder with hashed JS and CSS bundles

Step 3: Deploy to Cloudflare Pages
  npx wrangler pages deploy dist --project-name gtm-auditor

  This uploads the dist/ folder to Cloudflare Pages.
  Live URL: https://gtm-auditor-5ks.pages.dev/

=== UPDATING / REDEPLOYING ===

After making code changes, here's how to redeploy:

If you changed ONLY the backend (worker.ts):
  npx wrangler deploy

If you changed ONLY the frontend (src/ files):
  pnpm run build
  npx wrangler pages deploy dist --project-name gtm-auditor

If you changed BOTH:
  npx wrangler deploy
  pnpm run build
  npx wrangler pages deploy dist --project-name gtm-auditor

If you updated the GTM container JSON:
  pnpm run get-minified
  npx wrangler kv:key put --namespace-id=34c70e0d7e454cd5b7f96bbfc42b4954 "container" --path=./src/Container/container-minified.json

If you changed the database schema (schema.sql):
  npx wrangler d1 execute gtm-chat-history --file=./schema.sql --remote

If you need to rotate the Gemini API key:
  wrangler secret put GEMINI_API_KEY
  (Also update the .env file for local development)

=== TROUBLESHOOTING DEPLOYMENT ===

Problem: "Error: Authentication required"
Solution: Run "wrangler login" to re-authenticate with Cloudflare.

Problem: Frontend loads but API calls fail (CORS errors or 404s)
Solution: Check that VITE_WORKER_URL is correctly set in Cloudflare Pages environment variables. Make sure you rebuild and redeploy the frontend after changing it.

Problem: Worker deploys but returns "Container data not found"
Solution: The GTM container JSON hasn't been uploaded to KV. Run the kv:key put command from Step 3 of First-Time Setup.

Problem: Worker returns "GEMINI_API_KEY is missing"
Solution: The secret hasn't been set. Run: wrangler secret put GEMINI_API_KEY

Problem: Database errors (table not found)
Solution: Run the schema migration: npx wrangler d1 execute gtm-chat-history --file=./schema.sql --remote

Problem: "wrangler: command not found"
Solution: Install Wrangler globally: npm install -g wrangler

---

14. Environment Variables & Secrets

.env File (Local Development):
  GEMINI_API_KEY="your-gemini-api-key"    # Google Gemini API key (for local Worker dev)
  APP_URL="MY_APP_URL"                     # Not currently used in the codebase
  VITE_WORKER_URL=http://localhost:8787    # [NEW] Points frontend to local Worker

IMPORTANT: The .env file contains a live API key. While .env* is in .gitignore, this key should be rotated if the project was ever shared. For production, use "wrangler secret put GEMINI_API_KEY" to securely inject it.

[NEW] The VITE_WORKER_URL variable is read at build time by Vite and injected into chatApi.ts. This eliminates the need to hardcode the Worker URL in source code.

Cloudflare Worker Secrets:
- GEMINI_API_KEY - Set via: wrangler secret put GEMINI_API_KEY - Used by worker.ts for GoogleGenAI initialization

Cloudflare Bindings (via wrangler.toml):
- KV Namespace (KVNamespace) -> GTM_CONTAINER
- D1 Database (D1Database) -> gtm_chat_history

.gitignore (Updated):
  node_modules/
  build/
  dist/
  coverage/
  .DS_Store
  *.log
  .env*
  !.env.example
  # Cloudflare
  .wrangler/
  .dev.vars

---

15. Utility Modules

15.1 GTM Minifier - gtm-minifier.ts (320 lines)
Status: Not imported by the active codebase. Used only by the standalone minification script.
Purpose: Reduces GTM container JSON size by ~50% through structural transformations including stripping metadata, resolving variable references, normalizing parameters, resolving trigger IDs, humanizing trigger conditions, and collapsing whitespace.

15.2 JSON Cleaner - clean-json.ts (10 lines)
Purpose: Strips control characters (bytes 0x00-0x1F and 0x7F-0x9F) from JSON strings, while preserving newlines, carriage returns, and tabs.

15.3 Minification Script - get-minified.ts [UPDATED]
[CHANGED] Previously get-minified.js. Now a TypeScript file (get-minified.ts) that is executed via tsx:
  pnpm run get-minified

This runs: tsx get-minified.ts
It reads the raw GTM container JSON, cleans it, minifies it, and writes the output to src/Container/container-minified.json.

---

16. Security Considerations

WARNING: The following are known security considerations for this project.

- Wildcard CORS (HIGH): Access-Control-Allow-Origin: * allows any domain to call the API. Restrict to your domain for production.
- No Authentication (HIGH): All API endpoints are publicly accessible. Add auth if exposing publicly.
- No Rate Limiting (MEDIUM): No protection against abuse of the Gemini API via uncontrolled requests.
- No Input Validation (MEDIUM): No length limits on question, title, or id fields.
- API Key in .env (LOW): The .env file contains a live Gemini API key (mitigated by .gitignore).

---

17. Known Limitations & Future Work

Current Limitations:
- Single-line input (input type="text" instead of textarea)
- No copy button for AI responses
- No export (Markdown/PDF)
- No retry button on failed requests
- No dark mode
- No error boundary (React errors crash the app)
- Single-user (no authentication)
- No routing (no deep-linkable URLs)
- Context window limits on very long conversations
- Generic HTML title ("My Google AI Studio App" instead of "GTM Auditor")

---

Changes Made Since v1.0 (April 15, 2026):

1. [FIXED] chatApi.ts Base URL - No longer hardcoded. Now uses VITE_WORKER_URL environment variable resolved at build time via import.meta.env.VITE_WORKER_URL.

2. [NEW] VITE_WORKER_URL environment variable added to .env for local development and to Cloudflare Pages environment variables for production.

3. [UPDATED] get-minified script - Converted from plain JavaScript (get-minified.js) to TypeScript (get-minified.ts). Now runs via tsx instead of node. Package.json script updated accordingly.

4. [UPDATED] KV Namespace ID changed from 81ed8a0de33f447cb05f71a5f2a04d54 to 34c70e0d7e454cd5b7f96bbfc42b4954.

5. [UPDATED] D1 Database ID changed from 1d6bcf83-d898-49b3-87af-772bf803cac8 to dedc40ee-7534-4114-a48d-d6c737276a24.

6. [UPDATED] .gitignore - Added Cloudflare-specific entries (.wrangler/, .dev.vars).

7. [REMOVED] Files no longer in the project: improvements_analysis.md, pipeline_documentation.md, Update Command.txt.

8. [EXPANDED] Deployment section rewritten with step-by-step instructions, architecture explanation, troubleshooting guide, and redeployment procedures.

---

This document was generated from a complete source code analysis of all files in the GTM Auditor project.
Last updated: April 21, 2026 (v2.0)
