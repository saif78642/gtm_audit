import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Loader2, Settings, Check, X, Link as LinkIcon, LogOut, ChevronDown } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatApi, type ChatMessage, type AppMode } from '../services/chatApi';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function buildAutoTitle(text: string): string {
  const cleaned = text.trim().replace(/\n+/g, ' ');
  return cleaned.length > 46 ? `${cleaned.slice(0, 43)}…` : cleaned;
}

interface Props {
  sessionId: string;
  mode: AppMode;
  ga4PropertyId: string;
  onFirstReply?: (sessionId: string, title: string) => void;
  onGa4PropertySaved?: (propertyId: string) => void;
}

const GTM_SUGGESTIONS = [
  'What tags are in this container?',
  'How can I fix the GA4 configuration?',
  'Are there any missing consent settings?',
];

const GA4_SUGGESTIONS = [
  'What are my top 10 events in the last 30 days?',
  'Show me daily active users for the past week',
  'What channels are driving the most sessions?',
];

export function Dashboard({ sessionId, mode, ga4PropertyId, onFirstReply, onGa4PropertySaved }: Props) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingMsgs, setIsLoadingMsgs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPid, setSettingsPid] = useState(ga4PropertyId);
  const [isSavingPid, setIsSavingPid] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<{ connected: boolean; email?: string | null }>({ connected: false });
  const [properties, setProperties] = useState<{ propertyId: string; propertyName: string; accountName: string }[]>([]);
  const [isLoadingProps, setIsLoadingProps] = useState(false);
  const [isCheckingOauth, setIsCheckingOauth] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNewSessionRef = useRef(false);
  const hasAutoTitledRef = useRef(false);

  const checkOauthStatus = useCallback(async () => {
    if (mode !== 'ga4') return;
    setIsCheckingOauth(true);
    try {
      const status = await chatApi.getGa4OAuthStatus();
      setOauthStatus(status);
      if (status.connected) {
        setIsLoadingProps(true);
        const propsRes = await chatApi.getGa4Properties();
        setProperties(propsRes.properties);
      } else {
        setProperties([]);
      }
    } catch (err) {
      console.error('Failed to fetch OAuth status', err);
    } finally {
      setIsLoadingProps(false);
      setIsCheckingOauth(false);
    }
  }, [mode]);

  useEffect(() => {
    checkOauthStatus();
  }, [checkOauthStatus]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ga4_oauth_success') {
        checkOauthStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [checkOauthStatus]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingMsgs(true);
    setLoadError(null);
    setShowSettings(false);

    chatApi
      .getMessages(sessionId)
      .then(msgs => {
        if (cancelled) return;
        setChatMessages(msgs);
        isNewSessionRef.current = msgs.length === 0;
      })
      .catch(err => {
        if (!cancelled) setLoadError(err.message || 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMsgs(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    setSettingsPid(ga4PropertyId);
  }, [ga4PropertyId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isSendingChat, isStreaming]);

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || isSendingChat) return;

    const question = chatInput.trim();

    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: question }]);
    setIsSendingChat(true);
    setIsStreaming(true);

    setChatMessages(prev => [...prev, { role: 'model', text: '' }]);

    try {
      await chatApi.sendMessageStream(
        sessionId,
        question,
        (chunk: string) => {
          setChatMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'model') {
              updated[updated.length - 1] = {
                ...lastMsg,
                text: lastMsg.text + chunk,
              };
            }
            return updated;
          });
        },
        { mode },
      );

      if (isNewSessionRef.current && !hasAutoTitledRef.current && onFirstReply) {
        hasAutoTitledRef.current = true;
        const title = buildAutoTitle(question);
        chatApi
          .renameSession(sessionId, title)
          .then(() => onFirstReply(sessionId, title))
          .catch(() => { });
      }
    } catch (err: any) {
      setChatMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'model') {
          updated[updated.length - 1] = {
            ...lastMsg,
            text: `**Error:** ${err.message || 'Failed to get response'}`,
          };
        } else {
          updated.push({
            role: 'model',
            text: `**Error:** ${err.message || 'Failed to get response'}`,
          });
        }
        return updated;
      });
    } finally {
      setIsSendingChat(false);
      setIsStreaming(false);
    }
  }, [chatInput, isSendingChat, sessionId, onFirstReply, mode]);

  const handleSavePropertyId = async () => {
    if (!settingsPid.trim()) return;
    setIsSavingPid(true);
    try {
      await chatApi.setSessionGa4Property(sessionId, settingsPid.trim());
      onGa4PropertySaved?.(settingsPid.trim());
      setShowSettings(false);
    } catch (err: any) {
      alert(err.message || 'Failed to save');
    } finally {
      setIsSavingPid(false);
    }
  };

  const handleConnectGA4 = () => {
    const origin = window.location.origin;
    const workerUrl = import.meta.env.DEV
      ? ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? 'http://localhost:8787')
      : ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '');
    const authUrl = `${workerUrl}/api/ga4/oauth/authorize`;
    const token = localStorage.getItem('gtm_auth_token') || '';
    window.open(`${authUrl}?token=${token}`, 'ga4_oauth', 'width=500,height=600');
  };

  const handleDisconnectGA4 = async () => {
    try {
      await chatApi.disconnectGa4OAuth();
      setOauthStatus({ connected: false });
      setProperties([]);
      onGa4PropertySaved?.('');
    } catch (err: any) {
      alert('Failed to disconnect: ' + err.message);
    }
  };

  const suggestions = mode === 'ga4' ? GA4_SUGGESTIONS : GTM_SUGGESTIONS;
  const expertName = mode === 'ga4' ? 'GA4 Expert AI' : 'GTM Expert AI';
  const placeholder = mode === 'ga4'
    ? 'Ask about your GA4 data…'
    : 'Ask about your GTM container…';
  const subtitle = mode === 'ga4'
    ? 'Ask questions about your Google Analytics events, users, and reports.'
    : 'Ask questions about your GTM container tags, triggers, and variables.';

  if (isLoadingMsgs) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: mode === 'ga4' ? '#e8710a' : '#e8a317' }} />
          <span className="text-sm" style={{ color: '#6b7d8e' }}>Loading conversation…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500">
        <p className="text-sm bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
          Warning: {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 shrink-0 flex items-center justify-between" style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #dce4ec' }}>
        <div>
          <h2 className="font-semibold text-sm" style={{ color: '#1a2a3a' }}>Chat with {expertName}</h2>
          <p className="text-xs mt-0.5" style={{ color: '#9baab8' }}>{subtitle}</p>
        </div>
        {mode === 'ga4' && (
          <button
            onClick={() => setShowSettings(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: '#f7f9fb', border: '1px solid #dce4ec', color: '#6b7d8e' }}
          >
            <Settings className="w-3.5 h-3.5" />
            {ga4PropertyId ? `Property: ${ga4PropertyId}` : 'Set Property'}
          </button>
        )}
      </div>

      {/* GA4 Property Settings Panel */}
      {showSettings && mode === 'ga4' && (
        <div className="px-6 py-4 shrink-0 shadow-inner" style={{ backgroundColor: '#f7f9fb', borderBottom: '1px solid #dce4ec' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-800">Google Analytics Connection</h3>
            <button onClick={() => setShowSettings(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", oauthStatus.connected ? "bg-green-500" : "bg-red-500")} />
                <span className="text-sm font-medium text-gray-700">
                  {oauthStatus.connected ? `Connected (${oauthStatus.email || 'OAuth'})` : 'Not Connected'}
                </span>
              </div>
              {oauthStatus.connected ? (
                <button onClick={handleDisconnectGA4} className="text-xs text-red-600 hover:text-red-700 font-medium px-3 py-1.5 rounded bg-red-50 hover:bg-red-100 transition-colors">
                  Disconnect
                </button>
              ) : (
                <button onClick={handleConnectGA4} className="flex items-center gap-1.5 text-xs text-white font-medium px-4 py-2 rounded-lg transition-colors" style={{ backgroundColor: '#e8710a' }}>
                  <LinkIcon className="w-3.5 h-3.5" />
                  Connect GA4
                </button>
              )}
            </div>

            {oauthStatus.connected && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <label className="block text-xs font-medium text-gray-500 mb-2">Select GA4 Property</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <select
                      value={settingsPid}
                      onChange={e => setSettingsPid(e.target.value)}
                      disabled={isLoadingProps}
                      className="w-full text-sm rounded-lg px-3 py-2 outline-none appearance-none cursor-pointer"
                      style={{ backgroundColor: '#f8fafc', border: '1px solid #dce4ec', color: '#1a2a3a' }}
                    >
                      <option value="">Select a property...</option>
                      {properties.map(p => (
                        <option key={p.propertyId} value={p.propertyId}>
                          {p.accountName} &gt; {p.propertyName} ({p.propertyId})
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      {isLoadingProps ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>
                  <button
                    onClick={handleSavePropertyId}
                    disabled={isSavingPid || !settingsPid || settingsPid === ga4PropertyId}
                    className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#10b981', color: '#ffffff' }}
                  >
                    {isSavingPid ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4" style={{ backgroundColor: '#f7f9fb' }}>
        {chatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="p-4 rounded-2xl shadow-sm" style={{ backgroundColor: '#ffffff', border: '1px solid #dce4ec' }}>
              <MessageSquare className="w-8 h-8" style={{ color: mode === 'ga4' ? '#e8710a' : '#007a87' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: '#6b7d8e' }}>Ask a question to get started</p>
            <div className="flex gap-2 flex-wrap justify-center">
              {suggestions.map(q => (
                <button
                  key={q}
                  onClick={() => setChatInput(q)}
                  className="text-xs px-3 py-2 rounded-full transition-all cursor-pointer"
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #dce4ec',
                    color: '#6b7d8e',
                  }}
                  onMouseEnter={e => {
                    (e.target as HTMLElement).style.backgroundColor = mode === 'ga4' ? 'rgba(232, 113, 10, 0.06)' : 'rgba(232, 163, 23, 0.06)';
                    (e.target as HTMLElement).style.borderColor = mode === 'ga4' ? 'rgba(232, 113, 10, 0.3)' : 'rgba(232, 163, 23, 0.3)';
                    (e.target as HTMLElement).style.color = '#1a2a3a';
                  }}
                  onMouseLeave={e => {
                    (e.target as HTMLElement).style.backgroundColor = '#ffffff';
                    (e.target as HTMLElement).style.borderColor = '#dce4ec';
                    (e.target as HTMLElement).style.color = '#6b7d8e';
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
            {/* GA4: show property warning if not set */}
            {mode === 'ga4' && !ga4PropertyId && (
              <div className="mt-2 px-4 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(232, 113, 10, 0.08)', border: '1px solid rgba(232, 113, 10, 0.2)', color: '#e8710a' }}>
                Configure your GA4 Property ID above before sending questions.
              </div>
            )}
          </div>
        ) : (
          chatMessages.map((msg, idx) => (
            <div key={idx} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-3 shadow-sm',
                  msg.role === 'user'
                    ? 'text-white'
                    : 'text-gray-900',
                )}
                style={
                  msg.role === 'user'
                    ? { background: mode === 'ga4' ? 'linear-gradient(135deg, #e8710a, #f58634)' : 'linear-gradient(135deg, #1a3a5c, #1e4d7b)' }
                    : { backgroundColor: '#ffffff', border: '1px solid #dce4ec' }
                }
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
                ) : msg.text === '' && isStreaming ? (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: mode === 'ga4' ? '#e8710a' : '#e8a317', animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: mode === 'ga4' ? '#e8710a' : '#e8a317', animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: mode === 'ga4' ? '#e8710a' : '#e8a317', animationDelay: '300ms' }} />
                    </div>
                    <span className="text-sm" style={{ color: '#9baab8' }}>
                      {mode === 'ga4' ? 'AI is querying your analytics…' : 'AI is thinking…'}
                    </span>
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-a:text-blue-600 prose-table:border-collapse prose-th:border prose-th:border-gray-300 prose-th:px-4 prose-th:py-2 prose-th:bg-gray-100 prose-td:border prose-td:border-gray-300 prose-td:px-4 prose-td:py-2">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                    {isStreaming && idx === chatMessages.length - 1 && msg.role === 'model' && (
                      <span className="inline-block w-1.5 h-4 rounded-sm animate-pulse ml-0.5 align-text-bottom" style={{ backgroundColor: mode === 'ga4' ? '#e8710a' : '#e8a317' }} />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 px-4 md:px-8 py-4" style={{ backgroundColor: '#ffffff', borderTop: '1px solid #dce4ec' }}>
        <form
          onSubmit={e => { e.preventDefault(); handleSendChat(); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder={placeholder}
            aria-label="Chat message input"
            id="chat-input"
            className="flex-1 text-sm rounded-xl outline-none p-3 transition-all"
            style={{
              backgroundColor: '#f7f9fb',
              border: '1px solid #dce4ec',
              color: '#1a2a3a',
            }}
            onFocus={e => {
              e.target.style.backgroundColor = '#ffffff';
              e.target.style.borderColor = mode === 'ga4' ? '#e8710a' : '#e8a317';
              e.target.style.boxShadow = mode === 'ga4'
                ? '0 0 0 3px rgba(232, 113, 10, 0.15)'
                : '0 0 0 3px rgba(232, 163, 23, 0.15)';
            }}
            onBlur={e => {
              e.target.style.backgroundColor = '#f7f9fb';
              e.target.style.borderColor = '#dce4ec';
              e.target.style.boxShadow = 'none';
            }}
            disabled={isSendingChat}
          />
          <button
            type="submit"
            id="chat-send-btn"
            disabled={!chatInput.trim() || isSendingChat}
            aria-label="Send message"
            className="px-4 py-2 rounded-xl focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
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
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}