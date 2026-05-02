const BASE = import.meta.env.DEV
  ? ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? 'http://localhost:8787')
  : ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '');

import { getToken } from './authApi';

export type AppMode = 'gtm' | 'ga4';

export interface ChatSession {
  id: string;
  title: string;
  mode: AppMode;
  ga4_property_id?: string | null;
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
  getSessions(mode: AppMode = 'gtm'): Promise<ChatSession[]> {
    return apiFetch(`/api/sessions?mode=${mode}`);
  },

  createSession(id: string, title = 'New Chat', mode: AppMode = 'gtm', ga4_property_id?: string | null): Promise<ChatSession> {
    return apiFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ id, title, mode, ga4_property_id }),
    });
  },

  renameSession(id: string, title: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  deleteSession(id: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
  },

  getMessages(sessionId: string): Promise<ChatMessage[]> {
    return apiFetch(`/api/sessions/${sessionId}/messages`);
  },

  setSessionGa4Property(sessionId: string, propertyId: string | null): Promise<{ success: boolean; ga4_property_id: string | null }> {
    return apiFetch(`/api/sessions/${sessionId}/property`, {
      method: 'PUT',
      body: JSON.stringify({ ga4_property_id: propertyId }),
    });
  },

  getGa4OAuthStatus(): Promise<{ connected: boolean; email?: string | null }> {
    return apiFetch('/api/ga4/oauth/status');
  },

  disconnectGa4OAuth(): Promise<{ success: boolean }> {
    return apiFetch('/api/ga4/oauth/disconnect', { method: 'POST' });
  },

  getGa4Properties(): Promise<{ properties: { account: string; accountName: string; propertyId: string; propertyName: string }[] }> {
    return apiFetch('/api/ga4/properties');
  },

  async sendMessageStream(
    sessionId: string,
    question: string,
    onChunk: (text: string) => void,
    opts?: { mode?: AppMode },
  ): Promise<{ fullAnswer: string }> {
    const mode = opts?.mode || 'gtm';
    const body: Record<string, unknown> = { sessionId, question, chatMode: mode };
    // The backend now resolves ga4_property_id directly from the session.

    // GA4 mode: non-streaming endpoint returns full JSON response
    if (mode === 'ga4') {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }

      const data = await res.json() as { answer: string };
      const fullAnswer = data.answer || '';

      // Simulate streaming by chunking the response for a smooth UX
      const chunkSize = 20;
      for (let i = 0; i < fullAnswer.length; i += chunkSize) {
        const chunk = fullAnswer.slice(i, i + chunkSize);
        onChunk(chunk);
        await new Promise(r => setTimeout(r, 10));
      }

      return { fullAnswer };
    }

    // GTM mode: SSE streaming
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
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

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const payload = trimmed.slice(6);

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
            throw e;
          }
        }
      }
    }

    return { fullAnswer };
  },
};