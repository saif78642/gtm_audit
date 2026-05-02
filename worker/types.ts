// ── Shared types & constants for the worker ────────────────────────────────────

export interface Env {
  GEMINI_API_KEY: string;
  GTM_CONTAINER: KVNamespace;
  gtm_chat_history: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  created_at: number;
}

export interface StoredOAuthRow {
  access_token: string;
  refresh_token: string;
  token_expiry: number;
  scope: string;
  connected_email: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const GEMINI_MODEL = 'gemini-3.1-pro-preview';
export const CACHE_TTL_SECONDS = 1800; // 30 minutes
export const KV_CACHE_KEY = 'gemini_cache_name';
