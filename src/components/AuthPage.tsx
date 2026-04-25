import React, { useState } from 'react';
import { FileJson, KeyRound, Mail, Lock, User, Loader2, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type Tab = 'login' | 'signup';

export function AuthPage() {
  const { login, signup, bootstrap } = useAuth();
  const [tab, setTab] = useState<Tab>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [inviteKey, setInviteKey] = useState('');

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setUsername('');
    setInviteKey('');
    setError(null);
    setShowPassword(false);
  };

  const switchTab = (t: Tab) => {
    resetForm();
    setTab(t);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (tab === 'login') {
        if (!email.trim() || !password) {
          throw new Error('Please fill in all fields');
        }
        await login(email.trim(), password);
      } else {
        if (!username.trim() || !email.trim() || !password) {
          throw new Error('Please fill in all fields');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }

        if (inviteKey.trim()) {
          await signup(username.trim(), email.trim(), password, inviteKey.trim());
        } else {
          // Attempt bootstrap (first user — no invite key needed)
          try {
            await bootstrap(username.trim(), email.trim(), password);
          } catch (bootstrapErr: any) {
            // If bootstrap fails (users exist), require invite key
            if (bootstrapErr.message?.includes('already exists') || bootstrapErr.message?.includes('required')) {
              throw new Error('An invite key is required to sign up. Ask an existing user for one.');
            }
            throw bootstrapErr;
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" id="auth-page">
      {/* Light background */}
      <div className="absolute inset-0" style={{ background: '#f0f4f8' }} />

      {/* Subtle diagonal wave stripes */}
      <svg
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 200 Q 360 150, 720 220 T 1440 180 L 1440 0 L 0 0 Z"
          fill="rgba(200, 220, 245, 0.35)"
        />
        <path
          d="M0 350 Q 360 300, 720 370 T 1440 330 L 1440 100 L 0 100 Z"
          fill="rgba(200, 220, 245, 0.2)"
        />
        <path
          d="M0 900 Q 480 800, 960 860 T 1440 820 L 1440 900 Z"
          fill="rgba(200, 220, 245, 0.25)"
        />
      </svg>

      {/* Card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div
              className="relative p-4 rounded-2xl shadow-lg"
              style={{ background: 'linear-gradient(135deg, #1a3a5c, #1e4d7b)' }}
            >
              <FileJson className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1a2a3a' }}>
            GTM Auditor
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b7d8e' }}>
            AI-powered container analysis
          </p>
        </div>

        {/* White card */}
        <div
          className="rounded-3xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid rgba(200, 215, 235, 0.5)',
          }}
        >
          {/* Tab switcher */}
          <div className="flex" style={{ borderBottom: '1px solid #e8eef4' }}>
            <button
              onClick={() => switchTab('login')}
              id="auth-tab-login"
              className="flex-1 py-4 text-sm font-semibold transition-all duration-300 relative"
              style={{
                color: tab === 'login' ? '#1a2a3a' : '#9baab8',
              }}
            >
              Sign In
              {tab === 'login' && (
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(90deg, #e8a317, #f5b731)' }}
                />
              )}
            </button>
            <button
              onClick={() => switchTab('signup')}
              id="auth-tab-signup"
              className="flex-1 py-4 text-sm font-semibold transition-all duration-300 relative"
              style={{
                color: tab === 'signup' ? '#1a2a3a' : '#9baab8',
              }}
            >
              Sign Up
              {tab === 'signup' && (
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(90deg, #e8a317, #f5b731)' }}
                />
              )}
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Error message */}
            {error && (
              <div
                className="text-sm px-4 py-3 rounded-xl flex items-start gap-2"
                id="auth-error"
                style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                }}
              >
                <span className="shrink-0 mt-0.5">⚠</span>
                <span>{error}</span>
              </div>
            )}

            {/* Username — signup only */}
            {tab === 'signup' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider pl-1" style={{ color: '#6b7d8e' }}>
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9baab8' }} />
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Choose a username"
                    id="auth-username"
                    className="w-full text-sm rounded-xl pl-11 pr-4 py-3 outline-none transition-all"
                    style={{
                      backgroundColor: '#f7f9fb',
                      border: '1px solid #dce4ec',
                      color: '#1a2a3a',
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = '#e8a317';
                      e.target.style.boxShadow = '0 0 0 3px rgba(232, 163, 23, 0.15)';
                      e.target.style.backgroundColor = '#ffffff';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = '#dce4ec';
                      e.target.style.boxShadow = 'none';
                      e.target.style.backgroundColor = '#f7f9fb';
                    }}
                    disabled={isLoading}
                    autoComplete="username"
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider pl-1" style={{ color: '#6b7d8e' }}>
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9baab8' }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  id="auth-email"
                  className="w-full text-sm rounded-xl pl-11 pr-4 py-3 outline-none transition-all"
                  style={{
                    backgroundColor: '#f7f9fb',
                    border: '1px solid #dce4ec',
                    color: '#1a2a3a',
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#e8a317';
                    e.target.style.boxShadow = '0 0 0 3px rgba(232, 163, 23, 0.15)';
                    e.target.style.backgroundColor = '#ffffff';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = '#dce4ec';
                    e.target.style.boxShadow = 'none';
                    e.target.style.backgroundColor = '#f7f9fb';
                  }}
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider pl-1" style={{ color: '#6b7d8e' }}>
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9baab8' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={tab === 'signup' ? 'Min 6 characters' : '••••••••'}
                  id="auth-password"
                  className="w-full text-sm rounded-xl pl-11 pr-11 py-3 outline-none transition-all"
                  style={{
                    backgroundColor: '#f7f9fb',
                    border: '1px solid #dce4ec',
                    color: '#1a2a3a',
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#e8a317';
                    e.target.style.boxShadow = '0 0 0 3px rgba(232, 163, 23, 0.15)';
                    e.target.style.backgroundColor = '#ffffff';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = '#dce4ec';
                    e.target.style.boxShadow = 'none';
                    e.target.style.backgroundColor = '#f7f9fb';
                  }}
                  disabled={isLoading}
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: '#9baab8' }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Invite Key — signup only */}
            {tab === 'signup' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider pl-1" style={{ color: '#6b7d8e' }}>
                  Invite Key
                  <span className="font-normal normal-case ml-1" style={{ color: '#b0bec5' }}>(from an existing user)</span>
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9baab8' }} />
                  <input
                    type="text"
                    value={inviteKey}
                    onChange={e => setInviteKey(e.target.value)}
                    placeholder="Paste your invite key"
                    id="auth-invite-key"
                    className="w-full text-sm rounded-xl pl-11 pr-4 py-3 outline-none transition-all font-mono"
                    style={{
                      backgroundColor: '#f7f9fb',
                      border: '1px solid #dce4ec',
                      color: '#1a2a3a',
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = '#e8a317';
                      e.target.style.boxShadow = '0 0 0 3px rgba(232, 163, 23, 0.15)';
                      e.target.style.backgroundColor = '#ffffff';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = '#dce4ec';
                      e.target.style.boxShadow = 'none';
                      e.target.style.backgroundColor = '#f7f9fb';
                    }}
                    disabled={isLoading}
                  />
                </div>
                <p className="pl-1" style={{ fontSize: '11px', color: '#b0bec5' }}>
                  Leave blank if you're the first user setting up this app.
                </p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              id="auth-submit-btn"
              disabled={isLoading}
              className="w-full relative mt-2 py-3 font-semibold text-sm rounded-xl shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, #e8a317, #f5b731)',
                color: '#1a2a3a',
                boxShadow: '0 4px 14px rgba(232, 163, 23, 0.3)',
              }}
              onMouseEnter={e => {
                (e.target as HTMLElement).style.background = 'linear-gradient(135deg, #f5b731, #f9c84a)';
                (e.target as HTMLElement).style.boxShadow = '0 6px 20px rgba(232, 163, 23, 0.4)';
              }}
              onMouseLeave={e => {
                (e.target as HTMLElement).style.background = 'linear-gradient(135deg, #e8a317, #f5b731)';
                (e.target as HTMLElement).style.boxShadow = '0 4px 14px rgba(232, 163, 23, 0.3)';
              }}
            >
              {/* Shimmer effect */}
              <div
                className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                }}
              />

              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {tab === 'login' ? 'Signing in…' : 'Creating account…'}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  {tab === 'login' ? 'Sign In' : 'Create Account'}
                </span>
              )}
            </button>

            {/* Tab switch helper */}
            <p className="text-center text-xs pt-2" style={{ color: '#9baab8' }}>
              {tab === 'login' ? (
                <>
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchTab('signup')}
                    className="font-medium transition-colors"
                    style={{ color: '#007a87' }}
                    onMouseEnter={e => { (e.target as HTMLElement).style.color = '#005f6b'; }}
                    onMouseLeave={e => { (e.target as HTMLElement).style.color = '#007a87'; }}
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchTab('login')}
                    className="font-medium transition-colors"
                    style={{ color: '#007a87' }}
                    onMouseEnter={e => { (e.target as HTMLElement).style.color = '#005f6b'; }}
                    onMouseLeave={e => { (e.target as HTMLElement).style.color = '#007a87'; }}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center mt-6" style={{ fontSize: '11px', color: '#b0bec5' }}>
          Invitation-only access • Powered by Gemini AI
        </p>
      </div>
    </div>
  );
}
