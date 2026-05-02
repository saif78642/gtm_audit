import React, { useState, useEffect, useCallback } from 'react';
import { FileJson, Menu, LogOut, User, BarChart3 } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AuthPage } from './components/AuthPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { chatApi, type ChatSession, type AppMode } from './services/chatApi';

function getStoredMode(): AppMode {
  const stored = localStorage.getItem('gtm_app_mode');
  return stored === 'ga4' ? 'ga4' : 'gtm';
}

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mode, setMode] = useState<AppMode>(getStoredMode);

  const loadSessions = useCallback(async (currentMode: AppMode) => {
    setIsLoadingSessions(true);
    try {
      const data = await chatApi.getSessions(currentMode);
      setSessions(data);

      const stored = localStorage.getItem('gtm_active_session');
      if (stored && data.find(s => s.id === stored)) {
        setActiveSessionId(stored);
      } else if (data.length > 0) {
        setActiveSessionId(data[0].id);
        localStorage.setItem('gtm_active_session', data[0].id);
      } else {
        setActiveSessionId(null);
        localStorage.removeItem('gtm_active_session');
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions(mode);
  }, [mode, loadSessions]);

  const switchMode = useCallback((newMode: AppMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    localStorage.setItem('gtm_app_mode', newMode);
    setActiveSessionId(null);
    localStorage.removeItem('gtm_active_session');
    setSessions([]);
  }, [mode]);

  const handleNewChat = useCallback(async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      let inheritedProperty = null;
      if (mode === 'ga4' && activeSessionId) {
         const current = sessions.find(s => s.id === activeSessionId);
         if (current) inheritedProperty = current.ga4_property_id || null;
      }
      await chatApi.createSession(id, 'New Chat', mode, inheritedProperty);
      const newSession: ChatSession = { id, title: 'New Chat', mode, ga4_property_id: inheritedProperty, created_at: now, updated_at: now };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(id);
      localStorage.setItem('gtm_active_session', id);
      setIsSidebarOpen(false);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [mode, activeSessionId, sessions]);

  const handleSessionSelect = useCallback((id: string) => {
    setActiveSessionId(id);
    localStorage.setItem('gtm_active_session', id);
    setIsSidebarOpen(false);
  }, []);

  // ── Rename (called after inline edit OR auto-title from Dashboard) ───────
  const handleSessionRenamed = useCallback((id: string, title: string) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title, updated_at: Date.now() } : s));
  }, []);

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleSessionDeleted = useCallback(async (id: string) => {
    try {
      await chatApi.deleteSession(id);
      setSessions(prev => {
        const remaining = prev.filter(s => s.id !== id);

        // If the deleted session was active, switch to the next one
        if (id === activeSessionId) {
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].id);
            localStorage.setItem('gtm_active_session', remaining[0].id);
          } else {
            setActiveSessionId(null);
            localStorage.removeItem('gtm_active_session');
          }
        }

        return remaining;
      });
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [activeSessionId]);

  // ── Auto-title callback (from Dashboard after first AI reply) ───────────
  const handleFirstReply = useCallback((sessionId: string, title: string) => {
    setSessions(prev =>
      prev.map(s => s.id === sessionId ? { ...s, title, updated_at: Date.now() } : s)
    );
  }, []);

  const handleGa4PropertySaved = useCallback((pid: string) => {
    if (activeSessionId) {
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, ga4_property_id: pid } : s));
    }
  }, [activeSessionId]);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: '#f0f4f8' }}>
      {/* Header */}
      <header className="h-14 flex items-center px-4 gap-3 shrink-0 z-20" style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #dce4ec' }}>
        <button
          onClick={() => setIsSidebarOpen(o => !o)}
          className="p-2 rounded-xl transition-colors md:hidden"
          aria-label="Toggle sidebar"
          id="sidebar-toggle-btn"
        >
          <Menu className="w-5 h-5" style={{ color: '#6b7d8e' }} />
        </button>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: mode === 'ga4' ? 'linear-gradient(135deg, #e8710a, #f58634)' : 'linear-gradient(135deg, #1a3a5c, #1e4d7b)' }}>
            {mode === 'ga4' ? (
              <BarChart3 className="w-4 h-4 text-white" />
            ) : (
              <FileJson className="w-4 h-4 text-white" />
            )}
          </div>
          <h1 className="text-base font-semibold" style={{ color: '#1a2a3a' }}>
            {mode === 'ga4' ? 'GA4 Auditor – AI Chat' : 'GTM Auditor – AI Chat'}
          </h1>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center rounded-xl p-0.5" style={{ backgroundColor: '#f0f4f8', border: '1px solid #dce4ec' }}>
          <button
            onClick={() => switchMode('gtm')}
            className="px-3 py-1 rounded-xl text-xs font-medium transition-all"
            style={mode === 'gtm' ? {
              backgroundColor: '#ffffff',
              color: '#1a3a5c',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            } : { color: '#9baab8' }}
          >
            GTM
          </button>
          <button
            onClick={() => switchMode('ga4')}
            className="px-3 py-1 rounded-xl text-xs font-medium transition-all"
            style={mode === 'ga4' ? {
              backgroundColor: '#ffffff',
              color: '#e8710a',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            } : { color: '#9baab8' }}
          >
            GA4
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(v => !v)}
            id="user-menu-btn"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-colors"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #e8a317, #f5b731)' }}>
              <User className="w-3.5 h-3.5" style={{ color: '#1a2a3a' }} />
            </div>
            <span className="text-sm font-medium hidden sm:inline" style={{ color: '#1a2a3a' }}>{user?.username}</span>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 rounded-xl shadow-lg z-40 overflow-hidden" style={{ backgroundColor: '#ffffff', border: '1px solid #dce4ec' }}>
                <div className="px-4 py-3" style={{ borderBottom: '1px solid #e8eef4' }}>
                  <p className="text-sm font-medium" style={{ color: '#1a2a3a' }}>{user?.username}</p>
                  <p className="text-xs truncate" style={{ color: '#9baab8' }}>{user?.email}</p>
                </div>
                <button
                  onClick={async () => {
                    setShowUserMenu(false);
                    await logout();
                  }}
                  id="logout-btn"
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay backdrop */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-20 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isOpen={isSidebarOpen}
          mode={mode}
          onNewChat={handleNewChat}
          onSessionSelect={handleSessionSelect}
          onSessionRenamed={handleSessionRenamed}
          onSessionDeleted={handleSessionDeleted}
        />

        {/* Main panel */}
        <main className="flex-1 overflow-hidden flex flex-col" id="main-chat-panel">
          {isLoadingSessions ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#e8a317', borderTopColor: 'transparent' }} />
                <p className="text-sm" style={{ color: '#6b7d8e' }}>Loading chats…</p>
              </div>
            </div>
          ) : activeSession ? (
            <Dashboard
              key={activeSession.id}
              sessionId={activeSession.id}
              mode={mode}
              ga4PropertyId={activeSession.ga4_property_id || ''}
              onFirstReply={handleFirstReply}
              onGa4PropertySaved={handleGa4PropertySaved}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-5">
              <div className="p-5 rounded-3xl" style={{ backgroundColor: '#e8eef4', border: '1px solid #dce4ec' }}>
                {mode === 'ga4' ? (
                  <BarChart3 className="w-12 h-12" style={{ color: '#e8710a' }} />
                ) : (
                  <FileJson className="w-12 h-12" style={{ color: '#007a87' }} />
                )}
              </div>
              <div className="text-center">
                <p className="font-semibold text-lg" style={{ color: '#1a2a3a' }}>
                  {mode === 'ga4' ? 'Welcome to GA4 Auditor' : 'Welcome to GTM Auditor'}
                </p>
                <p className="text-sm mt-1" style={{ color: '#9baab8' }}>
                  {mode === 'ga4'
                    ? 'Start a new chat to analyze your Google Analytics data'
                    : 'Start a new chat to ask questions about your GTM container'}
                </p>
              </div>
              <button
                onClick={handleNewChat}
                id="welcome-new-chat-btn"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-colors cursor-pointer"
                style={{
                  background: mode === 'ga4'
                    ? 'linear-gradient(135deg, #e8710a, #f58634)'
                    : 'linear-gradient(135deg, #e8a317, #f5b731)',
                  color: mode === 'ga4' ? '#ffffff' : '#1a2a3a',
                  boxShadow: mode === 'ga4'
                    ? '0 4px 14px rgba(232, 113, 10, 0.3)'
                    : '0 4px 14px rgba(232, 163, 23, 0.3)',
                }}
              >
                + New Chat
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f0f4f8' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#e8a317', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: '#6b7d8e' }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return <AuthenticatedApp />;
}
