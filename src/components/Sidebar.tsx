import React, { useState, useRef } from 'react';
import { Plus, MessageSquare, Pencil, Trash2, Check, X, KeyRound, Copy, CheckCheck, Loader2, BarChart3, FileJson } from 'lucide-react';
import { chatApi, type ChatSession, type AppMode } from '../services/chatApi';
import { authApi } from '../services/authApi';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isOpen: boolean;
  mode: AppMode;
  onNewChat: () => void;
  onSessionSelect: (id: string) => void;
  onSessionRenamed: (id: string, title: string) => void;
  onSessionDeleted: (id: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByDate(sessions: ChatSession[]): { label: string; items: ChatSession[] }[] {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const buckets: { label: string; items: ChatSession[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Earlier', items: [] },
  ];

  for (const s of sessions) {
    const d = new Date(s.updated_at);
    if (d >= today) buckets[0].items.push(s);
    else if (d >= yesterday) buckets[1].items.push(s);
    else if (d >= weekAgo) buckets[2].items.push(s);
    else buckets[3].items.push(s);
  }

  return buckets.filter(b => b.items.length > 0);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  if (hrs < 48) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── SessionItem ───────────────────────────────────────────────────────────────

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onRenamed: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
}

function SessionItem({ session, isActive, onSelect, onRenamed, onDeleted }: SessionItemProps) {
  const [mode, setMode] = useState<'idle' | 'editing' | 'confirming-delete'>('idle');
  const [editValue, setEditValue] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.title);
    setMode('editing');
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const confirmEdit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = editValue.trim();
    if (!trimmed) return;
    try {
      await chatApi.renameSession(session.id, trimmed);
      onRenamed(session.id, trimmed);
    } catch {
      /* silent */
    } finally {
      setMode('idle');
    }
  };

  const startDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMode('confirming-delete');
  };

  const confirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleted(session.id);
  };

  return (
    <div
      onClick={mode === 'idle' ? onSelect : undefined}
      className={[
        'group relative flex flex-col rounded-xl px-3 py-2.5 mb-0.5 cursor-pointer select-none',
        'transition-colors duration-150',
      ].join(' ')}
      style={
        isActive
          ? { backgroundColor: 'rgba(232, 163, 23, 0.08)', border: '1px solid rgba(232, 163, 23, 0.25)' }
          : { border: '1px solid transparent' }
      }
    >
      {mode === 'editing' ? (
        <form onSubmit={confirmEdit} className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => confirmEdit()}
            onKeyDown={e => e.key === 'Escape' && setMode('idle')}
            className="flex-1 min-w-0 text-sm rounded-lg px-2 py-1 outline-none transition-all"
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e8a317',
              color: '#1a2a3a',
              boxShadow: '0 0 0 3px rgba(232, 163, 23, 0.15)',
            }}
            autoFocus
          />
          <button type="submit" className="p-1 text-green-600 hover:bg-green-50 rounded-md transition-colors">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => setMode('idle')} className="p-1 rounded-md transition-colors" style={{ color: '#9baab8' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      ) : mode === 'confirming-delete' ? (
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <span className="text-xs text-red-600 font-medium flex-1">Delete this chat?</span>
          <button onClick={confirmDelete} className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-medium">
            Delete
          </button>
          <button onClick={e => { e.stopPropagation(); setMode('idle'); }} className="px-2 py-1 text-xs rounded-lg transition-colors" style={{ backgroundColor: '#e8eef4', color: '#1a2a3a' }}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p
              className="text-sm font-medium truncate flex-1 leading-snug"
              style={{ color: isActive ? '#007a87' : '#1a2a3a' }}
            >
              {session.title}
            </p>
            {/* Action buttons — visible on hover or when active */}
            <div className={[
              'flex items-center gap-0.5 shrink-0 -mr-1',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              isActive ? 'opacity-100' : '',
            ].join(' ')}>
              <button
                onClick={startEdit}
                aria-label="Rename chat"
                className="p-1 rounded-md transition-colors"
                style={{ color: '#9baab8' }}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={startDelete}
                aria-label="Delete chat"
                className="p-1 rounded-md hover:text-red-500 transition-colors"
                style={{ color: '#9baab8' }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <p
            className="text-xs mt-0.5"
            style={{ color: isActive ? '#e8a317' : '#9baab8' }}
          >
            {relativeTime(session.updated_at)}
          </p>
        </>
      )}
    </div>
  );
}

// ── Invite Key Modal ─────────────────────────────────────────────────────────

function InviteKeyPanel({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<{ invite_key: string; used_by: string | null; created_at: number }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing invite keys on mount
  React.useEffect(() => {
    (async () => {
      try {
        const existing = await authApi.getInviteKeys();
        setKeys(existing);
      } catch {
        /* silent — user might not have any keys yet */
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const { invite_key: newKey } = await authApi.generateInviteKey();
      // Prepend the new key to the list
      setKeys(prev => [{ invite_key: newKey, used_by: null, created_at: Date.now() }, ...prev]);
    } catch (err: any) {
      setError(err.message || 'Failed to generate key');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      /* fallback: user can manually copy */
    }
  };

  return (
    <div className="p-3 space-y-3" style={{ borderTop: '1px solid #dce4ec', backgroundColor: '#f7f9fb' }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6b7d8e' }}>Invite a User</p>
        <button onClick={onClose} className="transition-colors" style={{ color: '#9baab8' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={isGenerating}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
        style={{ backgroundColor: 'rgba(0, 122, 135, 0.08)', border: '1px solid rgba(0, 122, 135, 0.2)', color: '#007a87' }}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <KeyRound className="w-3.5 h-3.5" />
            Generate Invite Key
          </>
        )}
      </button>

      {/* List of existing keys */}
      {isLoading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#9baab8' }} />
        </div>
      ) : keys.length > 0 ? (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {keys.map(k => (
            <div
              key={k.invite_key}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2"
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #dce4ec',
                opacity: k.used_by ? 0.5 : 1,
              }}
            >
              <code className="text-xs font-mono flex-1 truncate select-all" style={{ color: '#1a2a3a' }}>
                {k.invite_key}
              </code>
              {k.used_by ? (
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ backgroundColor: '#e8eef4', color: '#9baab8' }}>
                  Used
                </span>
              ) : (
                <button
                  onClick={() => copyKey(k.invite_key)}
                  className="shrink-0 p-1 transition-colors"
                  style={{ color: '#9baab8' }}
                  aria-label="Copy invite key"
                >
                  {copiedKey === k.invite_key ? <CheckCheck className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          ))}
          <p style={{ fontSize: '10px', color: '#9baab8' }}>Share an unused key with someone you'd like to invite. Each key can only be used once.</p>
        </div>
      ) : (
        <p className="text-xs text-center py-2" style={{ color: '#9baab8' }}>No invite keys yet. Generate one above.</p>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function SidebarContent({
  sessions,
  activeSessionId,
  mode,
  onNewChat,
  onSessionSelect,
  onSessionRenamed,
  onSessionDeleted,
}: Omit<SidebarProps, 'isOpen'>) {
  const grouped = groupByDate(sessions);
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* New Chat button */}
      <div className="p-3 shrink-0">
        <button
          onClick={onNewChat}
          id="new-chat-btn"
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-sm transition-colors cursor-pointer"
          style={{
            background: mode === 'ga4'
              ? 'linear-gradient(135deg, #e8710a, #f58634)'
              : 'linear-gradient(135deg, #e8a317, #f5b731)',
            color: mode === 'ga4' ? '#ffffff' : '#1a2a3a',
            boxShadow: mode === 'ga4'
              ? '0 2px 8px rgba(232, 113, 10, 0.3)'
              : '0 2px 8px rgba(232, 163, 23, 0.25)',
          }}
        >
          {mode === 'ga4' ? (
            <BarChart3 className="w-4 h-4" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          New Chat
        </button>
        <div className="flex items-center gap-1.5 mt-2 px-1">
          {mode === 'ga4' ? (
            <BarChart3 className="w-3 h-3" style={{ color: '#e8710a' }} />
          ) : (
            <FileJson className="w-3 h-3" style={{ color: '#007a87' }} />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: mode === 'ga4' ? '#e8710a' : '#007a87' }}>
            {mode === 'ga4' ? 'GA4 Chats' : 'GTM Chats'}
          </span>
        </div>
      </div>

      {/* Session list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Chat history">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 mt-8">
            <div className="p-3 rounded-2xl" style={{ backgroundColor: '#e8eef4' }}>
              <MessageSquare className="w-6 h-6" style={{ color: '#9baab8' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: '#6b7d8e' }}>No chats yet</p>
            <p className="text-xs text-center px-4" style={{ color: '#9baab8' }}>
              Click "New Chat" to start a conversation
            </p>
          </div>
        ) : (
          grouped.map(group => (
            <section key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest px-2 pt-4 pb-1.5" style={{ color: '#9baab8' }}>
                {group.label}
              </p>
              {group.items.map(session => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => onSessionSelect(session.id)}
                  onRenamed={onSessionRenamed}
                  onDeleted={onSessionDeleted}
                />
              ))}
            </section>
          ))
        )}
      </nav>

      {/* Invite key section */}
      {showInvite ? (
        <InviteKeyPanel onClose={() => setShowInvite(false)} />
      ) : (
        <div className="p-3 shrink-0" style={{ borderTop: '1px solid #dce4ec' }}>
          <button
            onClick={() => setShowInvite(true)}
            id="invite-user-btn"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors"
            style={{ backgroundColor: '#f7f9fb', border: '1px solid #dce4ec', color: '#6b7d8e' }}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Invite a User
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { isOpen, mode, ...rest } = props;

  return (
    <>
      {/* Desktop sidebar — always visible at md+ */}
      <aside className="hidden md:flex flex-col w-72 shrink-0 overflow-hidden" style={{ backgroundColor: '#ffffff', borderRight: '1px solid #dce4ec' }}>
        <SidebarContent mode={mode} {...rest} />
      </aside>

      {/* Mobile drawer */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 flex flex-col w-72',
          'shadow-2xl',
          'transition-transform duration-300 ease-in-out md:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{ backgroundColor: '#ffffff', borderRight: '1px solid #dce4ec' }}
        aria-label="Chat history sidebar"
      >
        <SidebarContent mode={mode} {...rest} />
      </aside>
    </>
  );
}
