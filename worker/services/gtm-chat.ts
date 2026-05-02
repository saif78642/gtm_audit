// ── GTM Chat service: Gemini context caching & SSE streaming ──────────────────

import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, CACHE_TTL_SECONDS, KV_CACHE_KEY } from '../types';

export const GTM_SYSTEM_INSTRUCTION = `You are an expert Google Tag Manager (GTM) Architect and Analyst.
You are assisting a user with their GTM container.
You have access to the raw GTM container JSON.
Answer the user's questions accurately based on the provided container data.
Be concise, professional, and provide specific examples from their container when relevant.`;

// ── Gemini Context Cache Management ───────────────────────────────────────────

/**
 * Get or create a Gemini context cache for the GTM container.
 * The cache name is stored in KV for cross-isolate reuse.
 */
export async function getOrCreateCache(
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
        systemInstruction: GTM_SYSTEM_INSTRUCTION,
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

// ── SSE Streaming Pipeline ────────────────────────────────────────────────────

/**
 * Streams a GTM chat response via SSE. Persists both user + model messages to D1.
 */
export async function streamGtmChat(
  geminiAi: GoogleGenAI,
  conversationHistory: { role: string; parts: { text: string }[] }[],
  question: string,
  containerJsonString: string,
  kv: KVNamespace,
  db: D1Database,
  sessionId: string | undefined,
): Promise<Response> {
  // Add the current question
  conversationHistory.push({ role: 'user', parts: [{ text: question }] });

  // Try to use Gemini context cache
  const cacheName = await getOrCreateCache(geminiAi, containerJsonString, kv);

  // Build the request config
  const requestConfig: Record<string, unknown> = {
    temperature: 0.3,
  };

  if (cacheName) {
    // Use cached context — no need to send container inline
    requestConfig.cachedContent = cacheName;
  } else {
    // Fallback: inject container as system instruction inline
    requestConfig.systemInstruction = GTM_SYSTEM_INSTRUCTION +
      `\n\nHere is the GTM Container JSON:\n${containerJsonString}`;
  }

  // Stream the response via SSE
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
  streamPromise.catch(console.error);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
