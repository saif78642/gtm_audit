// Resolved at build time from VITE_WORKER_URL env var.
// Set this in Cloudflare Pages → Settings → Environment Variables (Production & Preview).
// For local dev, it automatically defaults to http://localhost:8787.
const BASE = import.meta.env.DEV 
  ? ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? 'http://localhost:8787')
  : ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '');

import { getToken } from './authApi';

export interface ChatSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts?.headers as Record<string, string> ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any).error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const chatApi = {
  /** List all sessions, sorted by most recently updated. */
  getSessions(): Promise<ChatSession[]> {
    return apiFetch('/api/sessions');
  },

  /** Create a new session. ID should be a client-generated UUID. */
  createSession(id: string, title = 'New Chat'): Promise<ChatSession> {
    return apiFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ id, title }),
    });
  },

  /** Rename an existing session. */
  renameSession(id: string, title: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  /** Delete a session and all its messages. */
  deleteSession(id: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
  },

  /** Load all messages for a session, ordered oldest-first. */
  getMessages(sessionId: string): Promise<ChatMessage[]> {
    return apiFetch(`/api/sessions/${sessionId}/messages`);
  },

  /**
   * Send a chat message and return a streaming reader.
   * The worker streams SSE chunks: `data: {"text":"..."}\n\n`
   * Final chunk:                   `data: [DONE]\n\n`
   *
   * History is now loaded server-side from D1 — no need to send it.
   */
  async sendMessageStream(
    sessionId: string,
    question: string,
    onChunk: (text: string) => void,
  ): Promise<{ fullAnswer: string }> {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sessionId, question }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as any).error || `HTTP ${res.status}`);
    }

    if (!res.body) {
      throw new Error('No response body — streaming not supported');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullAnswer = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines from the buffer
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const payload = trimmed.slice(6); // strip "data: "

        if (payload === '[DONE]') {
          return { fullAnswer };
        }

        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.text) {
            fullAnswer += parsed.text;
            onChunk(parsed.text);
          }
        } catch (e: any) {
          if (e.message && !e.message.includes('JSON')) {
            throw e; // Re-throw non-parse errors (like server errors)
          }
          // Ignore JSON parse failures on partial lines
        }
      }
    }

    return { fullAnswer };
  },
};
