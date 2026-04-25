import { GoogleGenAI } from '@google/genai';

interface Env {
  GEMINI_API_KEY: string;
  GTM_CONTAINER: KVNamespace;
  gtm_chat_history: D1Database;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Password hashing (Web Crypto PBKDF2) ──────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  const hashArray = new Uint8Array(derivedBits);
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...hashArray].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, expectedHashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  const hashHex = [...new Uint8Array(derivedBits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === expectedHashHex;
}

// ── Token generation ──────────────────────────────────────────────────────────

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateInviteKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return 'INV-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function generateUserId(): string {
  return crypto.randomUUID();
}

// ── Auth middleware ───────────────────────────────────────────────────────────

interface AuthUser {
  id: string;
  username: string;
  email: string;
  created_at: number;
}

const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function authenticate(request: Request, db: D1Database): Promise<AuthUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.email, u.created_at
       FROM auth_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token = ? AND t.expires_at > ?`
    )
    .bind(token, Date.now())
    .first<AuthUser>();

  return row ?? null;
}

async function createAuthToken(db: D1Database, userId: string): Promise<string> {
  const token = generateToken();
  const now = Date.now();
  await db
    .prepare('INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, userId, now, now + TOKEN_EXPIRY_MS)
    .run();
  return token;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-3.1-pro-preview';
const CACHE_TTL_SECONDS = 1800; // 30 minutes
const KV_CACHE_KEY = 'gemini_cache_name';

const SYSTEM_INSTRUCTION = `You are an expert Google Tag Manager (GTM) Architect and Analyst.
You are assisting a user with their GTM container.
You have access to the raw GTM container JSON.
Answer the user's questions accurately based on the provided container data.
Be concise, professional, and provide specific examples from their container when relevant.`;

// ── Gemini Context Cache Management ───────────────────────────────────────────

/**
 * Get or create a Gemini context cache for the GTM container.
 * The cache name is stored in KV for cross-isolate reuse.
 */
async function getOrCreateCache(
  ai: GoogleGenAI,
  containerJson: string,
  kv: KVNamespace,
): Promise<string | null> {
  // 1. Check KV for an existing cache name
  const existingCacheName = await kv.get(KV_CACHE_KEY);
  if (existingCacheName) {
    try {
      // Verify the cache is still valid
      const cache = await ai.caches.get({ name: existingCacheName });
      if (cache && cache.name) {
        return cache.name;
      }
    } catch {
      // Cache expired or invalid — fall through to create a new one
    }
  }

  // 2. Create a new cache
  try {
    const cache = await ai.caches.create({
      model: GEMINI_MODEL,
      config: {
        contents: [
          {
            role: 'user',
            parts: [{ text: `Here is the GTM Container JSON for analysis:\n\n${containerJson}` }],
          },
          {
            role: 'model',
            parts: [{ text: 'I have received and analyzed the GTM container JSON. I\'m ready to answer your questions about the tags, triggers, variables, and overall configuration.' }],
          },
        ],
        systemInstruction: SYSTEM_INSTRUCTION,
        ttl: `${CACHE_TTL_SECONDS}s`,
      },
    });

    if (cache.name) {
      // Store in KV with matching TTL so it auto-expires
      await kv.put(KV_CACHE_KEY, cache.name, { expirationTtl: CACHE_TTL_SECONDS });
      return cache.name;
    }
  } catch (err) {
    console.error('Failed to create Gemini context cache:', err);
  }

  return null; // Fallback: no caching available
}

// ── Worker ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
    const url = new URL(request.url);
    const method = request.method;
    const parts = url.pathname.split('/').filter(Boolean);
    const db = env.gtm_chat_history;

    // /api/<resource>/...
    if (parts[0] !== 'api') {
      return new Response('Not Found', { status: 404, headers: CORS });
    }

    const resource = parts[1]; // 'sessions' | 'chat' | 'auth'

    // ──────────────────────────────────────────────────────────────────────────
    // /api/auth/...  (Authentication routes — no auth required)
    // ──────────────────────────────────────────────────────────────────────────
    if (resource === 'auth') {
      const action = parts[2]; // 'bootstrap' | 'signup' | 'login' | 'logout' | 'me' | 'invite' | 'invite-keys'

      // POST /api/auth/bootstrap — create the very first user (no invite key)
      if (action === 'bootstrap' && method === 'POST') {
        try {
          // Check if any users already exist
          const countRow = await db.prepare('SELECT COUNT(*) as cnt FROM users').first<{ cnt: number }>();
          if (countRow && countRow.cnt > 0) {
            return json({ error: 'A user already exists. Use an invite key to sign up.' }, 403);
          }

          const { username, email, password } = await request.json() as {
            username: string; email: string; password: string;
          };

          if (!username?.trim() || !email?.trim() || !password) {
            return json({ error: 'Username, email, and password are required' }, 400);
          }
          if (password.length < 6) {
            return json({ error: 'Password must be at least 6 characters' }, 400);
          }

          const userId = generateUserId();
          const hashedPw = await hashPassword(password);
          const now = Date.now();

          await db
            .prepare('INSERT INTO users (id, username, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(userId, username.trim(), email.trim().toLowerCase(), hashedPw, now, now)
            .run();

          const token = await createAuthToken(db, userId);

          return json({
            token,
            user: { id: userId, username: username.trim(), email: email.trim().toLowerCase(), created_at: now },
          }, 201);
        } catch (err: any) {
          if (err.message?.includes('UNIQUE')) {
            return json({ error: 'Username or email already taken' }, 409);
          }
          console.error('Bootstrap error:', err);
          return json({ error: err.message || 'Failed to create account' }, 500);
        }
      }

      // POST /api/auth/signup — register with an invite key
      if (action === 'signup' && method === 'POST') {
        try {
          const { username, email, password, inviteKey } = await request.json() as {
            username: string; email: string; password: string; inviteKey: string;
          };

          if (!username?.trim() || !email?.trim() || !password || !inviteKey?.trim()) {
            return json({ error: 'All fields including invite key are required' }, 400);
          }
          if (password.length < 6) {
            return json({ error: 'Password must be at least 6 characters' }, 400);
          }

          // Validate invite key
          const invite = await db
            .prepare('SELECT invite_key, used_by FROM invite_keys WHERE invite_key = ?')
            .bind(inviteKey.trim())
            .first<{ invite_key: string; used_by: string | null }>();

          if (!invite) {
            return json({ error: 'Invalid invite key' }, 400);
          }
          if (invite.used_by) {
            return json({ error: 'This invite key has already been used' }, 400);
          }

          const userId = generateUserId();
          const hashedPw = await hashPassword(password);
          const now = Date.now();

          await db.batch([
            db.prepare('INSERT INTO users (id, username, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(userId, username.trim(), email.trim().toLowerCase(), hashedPw, now, now),
            db.prepare('UPDATE invite_keys SET used_by = ?, used_at = ? WHERE invite_key = ?')
              .bind(userId, now, inviteKey.trim()),
          ]);

          const token = await createAuthToken(db, userId);

          return json({
            token,
            user: { id: userId, username: username.trim(), email: email.trim().toLowerCase(), created_at: now },
          }, 201);
        } catch (err: any) {
          if (err.message?.includes('UNIQUE')) {
            return json({ error: 'Username or email already taken' }, 409);
          }
          console.error('Signup error:', err);
          return json({ error: err.message || 'Failed to create account' }, 500);
        }
      }

      // POST /api/auth/login — authenticate with email + password
      if (action === 'login' && method === 'POST') {
        try {
          const { email, password } = await request.json() as { email: string; password: string };

          if (!email?.trim() || !password) {
            return json({ error: 'Email and password are required' }, 400);
          }

          const user = await db
            .prepare('SELECT id, username, email, password, created_at FROM users WHERE email = ?')
            .bind(email.trim().toLowerCase())
            .first<{ id: string; username: string; email: string; password: string; created_at: number }>();

          if (!user) {
            return json({ error: 'Invalid email or password' }, 401);
          }

          const valid = await verifyPassword(password, user.password);
          if (!valid) {
            return json({ error: 'Invalid email or password' }, 401);
          }

          const token = await createAuthToken(db, user.id);

          return json({
            token,
            user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at },
          });
        } catch (err: any) {
          console.error('Login error:', err);
          return json({ error: err.message || 'Login failed' }, 500);
        }
      }

      // POST /api/auth/logout — invalidate the current token
      if (action === 'logout' && method === 'POST') {
        const authHeader = request.headers.get('Authorization');
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          await db.prepare('DELETE FROM auth_tokens WHERE token = ?').bind(token).run();
        }
        return json({ success: true });
      }

      // GET /api/auth/me — get current user info
      if (action === 'me' && method === 'GET') {
        const user = await authenticate(request, db);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        return json({ user });
      }

      // POST /api/auth/invite — generate a new invite key
      if (action === 'invite' && method === 'POST') {
        const user = await authenticate(request, db);
        if (!user) return json({ error: 'Unauthorized' }, 401);

        const key = generateInviteKey();
        const now = Date.now();
        await db
          .prepare('INSERT INTO invite_keys (invite_key, created_by, created_at) VALUES (?, ?, ?)')
          .bind(key, user.id, now)
          .run();

        return json({ invite_key: key }, 201);
      }

      // GET /api/auth/invite-keys — list invite keys for current user
      if (action === 'invite-keys' && method === 'GET') {
        const user = await authenticate(request, db);
        if (!user) return json({ error: 'Unauthorized' }, 401);

        const { results } = await db
          .prepare('SELECT invite_key, created_by, used_by, used_at, created_at FROM invite_keys WHERE created_by = ? ORDER BY created_at DESC')
          .bind(user.id)
          .all();

        return json(results);
      }

      return json({ error: 'Not Found' }, 404);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // All routes below require authentication
    // ──────────────────────────────────────────────────────────────────────────
    const currentUser = await authenticate(request, db);
    if (!currentUser) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // ────────────────────────────────────────────────────────────────────────
    // /api/sessions  (collection)
    // ────────────────────────────────────────────────────────────────────────
    if (resource === 'sessions' && parts.length === 2) {

      // GET /api/sessions — list all sessions for current user
      if (method === 'GET') {
        const { results } = await db
          .prepare('SELECT id, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC')
          .bind(currentUser.id)
          .all();
        return json(results);
      }

      // POST /api/sessions — create a session
      if (method === 'POST') {
        const { id, title } = await request.json() as { id: string; title?: string };
        const now = Date.now();
        await db
          .prepare('INSERT INTO sessions (id, title, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .bind(id, title ?? 'New Chat', currentUser.id, now, now)
          .run();
        return json({ id, title: title ?? 'New Chat', created_at: now, updated_at: now }, 201);
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // /api/sessions/:id  (single session)
    // ────────────────────────────────────────────────────────────────────────
    if (resource === 'sessions' && parts.length === 3) {
      const sessionId = parts[2];

      // Verify session belongs to current user
      const session = await db
        .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
        .bind(sessionId, currentUser.id)
        .first();
      if (!session) return json({ error: 'Session not found' }, 404);

      // PATCH /api/sessions/:id — rename
      if (method === 'PATCH') {
        const { title } = await request.json() as { title: string };
        await db
          .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
          .bind(title, Date.now(), sessionId)
          .run();
        return json({ success: true });
      }

      // DELETE /api/sessions/:id — remove session + its messages
      if (method === 'DELETE') {
        // Messages are automatically removed via ON DELETE CASCADE
        await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
        return json({ success: true });
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // GET /api/sessions/:id/messages
    // ────────────────────────────────────────────────────────────────────────
    if (resource === 'sessions' && parts.length === 4 && parts[3] === 'messages') {
      const sessionId = parts[2];

      // Verify session belongs to current user
      const session = await db
        .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
        .bind(sessionId, currentUser.id)
        .first();
      if (!session) return json({ error: 'Session not found' }, 404);

      if (method === 'GET') {
        const { results } = await db
          .prepare('SELECT role, text FROM messages WHERE session_id = ? ORDER BY created_at ASC')
          .bind(sessionId)
          .all();
        return json(results);
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // POST /api/chat  (streaming SSE)
    // ────────────────────────────────────────────────────────────────────────
    if (resource === 'chat' && method === 'POST') {
      try {
        const { question, sessionId } = await request.json() as {
          question: string;
          sessionId?: string;
        };

        if (!question) return json({ error: 'Question is required' }, 400);

        // If sessionId is given, verify it belongs to the current user
        if (sessionId) {
          const session = await db
            .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
            .bind(sessionId, currentUser.id)
            .first();
          if (!session) return json({ error: 'Session not found' }, 404);
        }

        const geminiApiKey = env.GEMINI_API_KEY;
        if (!geminiApiKey) return json({ error: 'GEMINI_API_KEY is missing' }, 500);

        const containerJsonString = await env.GTM_CONTAINER.get('container', { cacheTtl: 3600 });
        if (!containerJsonString) return json({ error: 'Container data not found' }, 500);

        const geminiAi = new GoogleGenAI({ apiKey: geminiApiKey });

        // ── Build conversation history from D1 ───────────────────────────
        const conversationHistory: { role: string; parts: { text: string }[] }[] = [];

        if (sessionId) {
          const { results: dbMessages } = await db
            .prepare('SELECT role, text FROM messages WHERE session_id = ? ORDER BY created_at ASC')
            .bind(sessionId)
            .all<{ role: string; text: string }>();

          for (const msg of dbMessages) {
            conversationHistory.push({ role: msg.role, parts: [{ text: msg.text }] });
          }
        }

        // Add the current question
        conversationHistory.push({ role: 'user', parts: [{ text: question }] });

        // ── Try to use Gemini context cache ───────────────────────────────
        const cacheName = await getOrCreateCache(geminiAi, containerJsonString, env.GTM_CONTAINER);

        // Build the request config
        const requestConfig: Record<string, unknown> = {
          temperature: 0.3,
        };

        if (cacheName) {
          // Use cached context — no need to send container inline
          requestConfig.cachedContent = cacheName;
        } else {
          // Fallback: inject container as system instruction inline
          requestConfig.systemInstruction = SYSTEM_INSTRUCTION +
            `\n\nHere is the GTM Container JSON:\n${containerJsonString}`;
        }

        // ── Stream the response via SSE ──────────────────────────────────
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Start the streaming async pipeline
        const streamPromise = (async () => {
          let fullAnswer = '';
          try {
            const resultStream = await geminiAi.models.generateContentStream({
              model: GEMINI_MODEL,
              contents: conversationHistory,
              config: requestConfig,
            });

            for await (const chunk of resultStream) {
              const text = chunk.text ?? '';
              if (text) {
                fullAnswer += text;
                const sseData = `data: ${JSON.stringify({ text })}\n\n`;
                await writer.write(encoder.encode(sseData));
              }
            }

            // Signal stream completion
            await writer.write(encoder.encode('data: [DONE]\n\n'));
          } catch (err: any) {
            const errorMsg = err.message || 'Stream failed';
            console.error('Gemini stream error:', err);
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`)
            );
          } finally {
            // Persist both turns to D1 if we have a session and a response
            if (sessionId && fullAnswer) {
              try {
                const now = Date.now();
                await db.batch([
                  db.prepare(
                    'INSERT INTO messages (session_id, role, text, created_at) VALUES (?, ?, ?, ?)'
                  ).bind(sessionId, 'user', question, now),
                  db.prepare(
                    'INSERT INTO messages (session_id, role, text, created_at) VALUES (?, ?, ?, ?)'
                  ).bind(sessionId, 'model', fullAnswer, now + 1),
                  db.prepare(
                    'UPDATE sessions SET updated_at = ? WHERE id = ?'
                  ).bind(now, sessionId),
                ]);
              } catch (dbErr) {
                console.error('Failed to persist chat to D1:', dbErr);
              }
            }
            await writer.close();
          }
        })();

        // Don't await — let the stream flow to the client immediately
        // The writer.close() in the finally block signals the end
        streamPromise.catch(console.error);

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...CORS,
          },
        });
      } catch (error: any) {
        console.error('Chat API Error:', error);
        return json({ error: error.message || 'Error processing request' }, 500);
      }
    }

    return new Response('Not Found', { status: 404, headers: CORS });

    } catch (err: any) {
      // Global catch — ensures CORS headers are always present, even on unexpected crashes
      console.error('Unhandled worker error:', err);
      return json({ error: err.message || 'Internal Server Error' }, 500);
    }
  },
};