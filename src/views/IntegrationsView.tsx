import { useEffect, useState, type FormEvent } from 'react';
import { Check, KeyRound, RefreshCw, Trash2, X } from 'lucide-react';
import type { IntegrationProviderKey, IntegrationRecord, UserRole } from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatTimestamp } from '../lib/api.ts';

interface IntegrationsViewProps {
  userRole: UserRole;
}

export function IntegrationsView({ userRole }: IntegrationsViewProps) {
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<IntegrationProviderKey | null>(null);

  const [configuring, setConfiguring] = useState<IntegrationRecord | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [saving, setSaving] = useState(false);

  const isOwner = userRole === 'owner';
  const canTest = userRole === 'owner' || userRole === 'operator';

  async function loadIntegrations() {
    setError(null);
    try {
      const res = await api.integrations.list();
      setIntegrations(res.integrations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load integrations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadIntegrations();
  }, []);

  function openConfigure(item: IntegrationRecord) {
    setConfiguring(item);
    setSecretInput('');
    setEndpointInput(item.config.endpointUrl || item.config.healthUrl || '');
  }

  async function handleSaveConfig(e: FormEvent) {
    e.preventDefault();
    if (!configuring) return;
    setSaving(true);
    setError(null);
    try {
      const config: Record<string, string> = {};
      if (configuring.providerKey === 'browser_automation') {
        config.endpointUrl = endpointInput.trim();
      } else if (configuring.providerKey === 'external_apis') {
        config.healthUrl = endpointInput.trim();
      }
      const res = await api.integrations.configure(configuring.providerKey, {
        credential: secretInput.trim() || null,
        config,
      });
      setIntegrations((prev) =>
        prev.map((i) => (i.providerKey === configuring.providerKey ? res.integration : i))
      );
      setConfiguring(null);
      setSecretInput('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear(providerKey: IntegrationProviderKey) {
    setError(null);
    try {
      const res = await api.integrations.clearCredentials(providerKey);
      setIntegrations((prev) => prev.map((i) => (i.providerKey === providerKey ? res.integration : i)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to clear credentials.');
    }
  }

  async function handleTest(providerKey: IntegrationProviderKey) {
    setTestingKey(providerKey);
    setError(null);
    try {
      const res = await api.integrations.test(providerKey);
      setIntegrations((prev) => prev.map((i) => (i.providerKey === providerKey ? res.integration : i)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connection verification failed.');
    } finally {
      setTestingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold text-white">Integrations & Providers</h2>
        <p className="text-xs text-slate-400 mt-1">
          Live authentication verification and AES-256-GCM server-side credential storage. Providers remain unverified until a live connection test passes.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {integrations.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">
                    {item.category.replace('_', ' ')}
                  </span>
                  <StatusText status={item.connectionStatus} />
                </div>

                <h3 className="mt-2 font-display text-base font-semibold text-white">{item.displayName}</h3>

                <div className="mt-2 space-y-1 text-xs text-slate-400">
                  <div>
                    Credential state:{' '}
                    <span className="text-slate-200">
                      {item.credentialSource === 'environment'
                        ? 'Server Environment Secret'
                        : item.credentialSource === 'encrypted_vault'
                          ? 'Encrypted Server Vault (write-only)'
                          : 'Not Configured'}
                    </span>
                  </div>
                  {item.accountLabel && (
                    <div className="text-emerald-300">Verified: {item.accountLabel}</div>
                  )}
                  {item.lastTestedAt && (
                    <div className="tabular-nums">
                      Last verified: {formatTimestamp(item.lastTestedAt)}
                      {item.lastLatencyMs !== null ? ` (${item.lastLatencyMs} ms)` : ''}
                    </div>
                  )}
                  {item.lastError && <div className="text-rose-400 break-words">Failure: {item.lastError}</div>}
                </div>
              </div>

              <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {canTest && (
                    <button
                      type="button"
                      disabled={testingKey === item.providerKey}
                      onClick={() => handleTest(item.providerKey)}
                      className="min-h-[38px] px-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingKey === item.providerKey ? 'animate-spin' : ''}`} />
                      <span>{testingKey === item.providerKey ? 'Testing...' : 'Verify Connection'}</span>
                    </button>
                  )}

                  {isOwner && item.authType !== 'env_secret' && (
                    <button
                      type="button"
                      onClick={() => openConfigure(item)}
                      className="min-h-[38px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Configure</span>
                    </button>
                  )}
                </div>

                {isOwner && item.authType !== 'env_secret' && item.hasCredential && (
                  <button
                    type="button"
                    aria-label={`Clear ${item.displayName} credentials`}
                    onClick={() => handleClear(item.providerKey)}
                    className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Write-Only Vault Configuration Modal for Non-Gemini Providers */}
      {configuring && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#11161F] border border-white/[0.1] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-white">Configure {configuring.displayName}</h3>
              <button
                type="button"
                onClick={() => setConfiguring(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              {(configuring.providerKey === 'browser_automation' ||
                configuring.providerKey === 'external_apis') && (
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    {configuring.providerKey === 'browser_automation'
                      ? 'Remote Chromium CDP / WebDriver URL'
                      : 'External API Health Check URL'}
                  </label>
                  <input
                    type="url"
                    required
                    value={endpointInput}
                    onChange={(e) => setEndpointInput(e.target.value)}
                    placeholder="https://..."
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  />
                </div>
              )}

              {configuring.providerKey !== 'browser_automation' && (
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    {configuring.providerKey === 'external_apis'
                      ? 'Optional Bearer Token (write-only)'
                      : 'Access Token / Secret (write-only, encrypted at rest)'}
                  </label>
                  <input
                    type="password"
                    required={configuring.providerKey !== 'external_apis'}
                    autoComplete="off"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder="Enter secret credential..."
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Encrypted with AES-256-GCM on the server. Secrets are never returned to the browser or written to logs.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfiguring(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/[0.1] text-xs text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{saving ? 'Encrypting...' : 'Save Configuration'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
