import { useState, type FormEvent } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import type { UserProfile } from '../../shared/types.ts';
import { api, ApiError, setStoredSessionToken } from '../lib/api.ts';

interface AuthGateProps {
  initialized: boolean;
  onAuthenticated: (user: UserProfile) => void;
}

export function AuthGate({ initialized, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<'setup' | 'login'>(initialized ? 'login' : 'setup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'setup') {
        const res = await api.auth.setup({ name, email, password });
        setStoredSessionToken(res.sessionToken);
        onAuthenticated(res.user);
      } else {
        const res = await api.auth.login({ email, password });
        setStoredSessionToken(res.sessionToken);
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Authentication failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0D12] text-[#F1F5F9] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-[#11161F] border border-white/[0.08] rounded-2xl p-6 sm:p-8">
        <div className="mb-8">
          <div className="flex items-center gap-2.5 text-slate-200 mb-3">
            <div className="w-9 h-9 rounded-lg bg-[#2563EB]/15 border border-[#3B82F6]/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-[#3B82F6]" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Taurus</span>
          </div>
          <h1 className="font-display text-2xl font-semibold text-white">
            {mode === 'setup' ? 'Initialize Operations Console' : 'Operator Sign In'}
          </h1>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            {mode === 'setup'
              ? 'Create the primary Owner account to secure TAURUS data, integrations, and file storage.'
              : 'Authenticate to access the TAURUS operational control center.'}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'setup' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                Operator Name
              </label>
              <input
                id="auth-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Mercer"
                className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300 mb-1.5">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@taurus.local"
              className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-xs font-medium text-slate-300 mb-1.5">
              Passphrase
            </label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] mt-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            <span>
              {submitting
                ? mode === 'setup'
                  ? 'Initializing Account...'
                  : 'Authenticating...'
                : mode === 'setup'
                  ? 'Create Owner Account'
                  : 'Sign In'}
            </span>
          </button>
        </form>

        {initialized && mode === 'setup' && (
          <button
            type="button"
            onClick={() => setMode('login')}
            className="mt-4 w-full text-center text-xs text-slate-400 hover:text-slate-200 py-2"
          >
            Already initialized? Sign in instead
          </button>
        )}
      </div>
    </div>
  );
}
