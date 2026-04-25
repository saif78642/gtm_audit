import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import { chatApi, type ChatMessage } from '../services/chatApi';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Derive a short title from the first user message. */
function buildAutoTitle(text: string): string {
  const cleaned = text.trim().replace(/\n+/g, ' ');
  return cleaned.length > 46 ? `${cleaned.slice(0, 43)}…` : cleaned;
}

interface Props {
  sessionId: string;
  onFirstReply?: (sessionId: string, title: string) => void;
}

export function Dashboard({ sessionId, onFirstReply }: Props) {
  const [chatMessages, setChatMessages]     = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]           = useState('');
  const [isSendingChat, setIsSendingChat]   = useState(false);
  const [isStreaming, setIsStreaming]        = useState(false);
  const [isLoadingMsgs, setIsLoadingMsgs]   = useState(true);
  const [loadError, setLoadError]           = useState<string | null>(null);

  const messagesEndRef   = useRef<HTMLDivElement>(null);
  /** True if this session had zero messages when the component mounted (= new session). */
  const isNewSessionRef  = useRef(false);
  /** Prevent auto-titling more than once. */
  const hasAutoTitledRef = useRef(false);

  // ── Load existing messages ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoadingMsgs(true);
    setLoadError(null);

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

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isSendingChat, isStreaming]);

  // ── Send message (streaming) ────────────────────────────────────────────
  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || isSendingChat) return;

    const question = chatInput.trim();

    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: question }]);
    setIsSendingChat(true);
    setIsStreaming(true);

    // Add a placeholder AI message that will be progressively filled
    setChatMessages(prev => [...prev, { role: 'model', text: '' }]);

    try {
      await chatApi.sendMessageStream(
        sessionId,
        question,
        // onChunk — append each text chunk to the last message
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
      );

      // Auto-title new sessions after the first AI response
      if (isNewSessionRef.current && !hasAutoTitledRef.current && onFirstReply) {
        hasAutoTitledRef.current = true;
        const title = buildAutoTitle(question);
        chatApi
          .renameSession(sessionId, title)
          .then(() => onFirstReply(sessionId, title))
          .catch(() => { /* non-fatal */ });
      }
    } catch (err: any) {
      setChatMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        // If the last message is the empty/partial AI placeholder, replace it with error
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
  }, [chatInput, isSendingChat, sessionId, onFirstReply]);

  // ── Loading / Error states ──────────────────────────────────────────────
  if (isLoadingMsgs) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#e8a317' }} />
          <span className="text-sm" style={{ color: '#6b7d8e' }}>Loading conversation…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500">
        <p className="text-sm bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
          ⚠ {loadError}
        </p>
      </div>
    );
  }

  // ── Chat UI ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="px-6 py-4 shrink-0" style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #dce4ec' }}>
        <h2 className="font-semibold text-sm" style={{ color: '#1a2a3a' }}>Chat with GTM Expert AI</h2>
        <p className="text-xs mt-0.5" style={{ color: '#9baab8' }}>
          Ask questions about your GTM container tags, triggers, and variables.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4" style={{ backgroundColor: '#f7f9fb' }}>
        {chatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="p-4 rounded-2xl shadow-sm" style={{ backgroundColor: '#ffffff', border: '1px solid #dce4ec' }}>
              <MessageSquare className="w-8 h-8" style={{ color: '#007a87' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: '#6b7d8e' }}>Ask a question to get started</p>
            <div className="flex gap-2 flex-wrap justify-center">
              {[
                'What tags are in this container?',
                'How can I fix the GA4 configuration?',
                'Are there any missing consent settings?',
              ].map(q => (
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
                    (e.target as HTMLElement).style.backgroundColor = 'rgba(232, 163, 23, 0.06)';
                    (e.target as HTMLElement).style.borderColor = 'rgba(232, 163, 23, 0.3)';
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
                    ? { background: 'linear-gradient(135deg, #1a3a5c, #1e4d7b)' }
                    : { backgroundColor: '#ffffff', border: '1px solid #dce4ec' }
                }
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
                ) : msg.text === '' && isStreaming ? (
                  /* Streaming placeholder — show cursor while waiting for first chunk */
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: '#e8a317', animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: '#e8a317', animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: '#e8a317', animationDelay: '300ms' }} />
                    </div>
                    <span className="text-sm" style={{ color: '#9baab8' }}>AI is thinking…</span>
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-a:text-blue-600">
                    <Markdown>{msg.text}</Markdown>
                    {/* Show a blinking cursor at the end while streaming */}
                    {isStreaming && idx === chatMessages.length - 1 && msg.role === 'model' && (
                      <span className="inline-block w-1.5 h-4 rounded-sm animate-pulse ml-0.5 align-text-bottom" style={{ backgroundColor: '#e8a317' }} />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 md:px-8 py-4" style={{ backgroundColor: '#ffffff', borderTop: '1px solid #dce4ec' }}>
        <form
          onSubmit={e => { e.preventDefault(); handleSendChat(); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="Ask about your GTM container…"
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
              e.target.style.borderColor = '#e8a317';
              e.target.style.boxShadow = '0 0 0 3px rgba(232, 163, 23, 0.15)';
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
              background: 'linear-gradient(135deg, #e8a317, #f5b731)',
              color: '#1a2a3a',
              boxShadow: '0 2px 8px rgba(232, 163, 23, 0.25)',
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
