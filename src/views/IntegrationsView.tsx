import { useEffect, useState, type FormEvent } from 'react';
import { Check, GitBranch, Globe, KeyRound, Mail, RefreshCw, Sliders, Trash2, X } from 'lucide-react';
import type {
  AiExecutionAuditRecord,
  AiProviderKey,
  IntegrationProviderKey,
  IntegrationRecord,
  RoutingPolicy,
  UserRole,
} from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import {
  api,
  ApiError,
  formatTimestamp,
  type BrowserInspectionResult,
  type EmailOutboxRecord,
  type GithubRepoSummary,
} from '../lib/api.ts';

interface IntegrationsViewProps {
  userRole: UserRole;
}

export function IntegrationsView({ userRole }: IntegrationsViewProps) {
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [routingPolicy, setRoutingPolicy] = useState<RoutingPolicy | null>(null);
  const [aiAudit, setAiAudit] = useState<AiExecutionAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<IntegrationProviderKey | null>(null);

  // Configure modal state
  const [configuring, setConfiguring] = useState<IntegrationRecord | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [fromAddressInput, setFromAddressInput] = useState('');
  const [defaultModelInput, setDefaultModelInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Routing form
  const [savingRouting, setSavingRouting] = useState(false);

  // GitHub workspace
  const [repos, setRepos] = useState<GithubRepoSummary[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [creatingRepo, setCreatingRepo] = useState(false);

  // Email Outbox workspace
  const [emails, setEmails] = useState<EmailOutboxRecord[]>([]);
  const [toEmail, setToEmail] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [queueingEmail, setQueueingEmail] = useState(false);

  // Browser URL inspector
  const [inspectUrl, setInspectUrl] = useState('https://example.com');
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<BrowserInspectionResult | null>(null);

  const isOwner = userRole === 'owner';
  const canOperate = userRole === 'owner' || userRole === 'operator';

  async function loadAll() {
    setError(null);
    try {
      const [intRes, routeRes, emailRes] = await Promise.all([
        api.integrations.list(),
        api.integrations.routing.get(),
        api.integrations.email.outbox(),
      ]);
      setIntegrations(intRes.integrations);
      setRoutingPolicy(routeRes.policy);
      setAiAudit(routeRes.recentExecutions);
      setEmails(emailRes.emails);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load integrations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function openConfigure(item: IntegrationRecord) {
    setConfiguring(item);
    setSecretInput('');
    setEndpointInput(item.config.endpointUrl || item.config.healthUrl || '');
    setFromAddressInput(item.config.fromAddress || '');
    setDefaultModelInput(item.config.defaultModel || '');
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
      } else if (configuring.providerKey === 'email_services' && fromAddressInput.trim()) {
        config.fromAddress = fromAddressInput.trim();
      } else if (
        (configuring.providerKey === 'groq' || configuring.providerKey === 'openai') &&
        defaultModelInput.trim()
      ) {
        config.defaultModel = defaultModelInput.trim();
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

  async function handleSaveRouting(e: FormEvent) {
    e.preventDefault();
    if (!routingPolicy || !isOwner) return;
    setSavingRouting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.integrations.routing.update(routingPolicy);
      setRoutingPolicy(res.policy);
      setNotice('Model routing policy saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update routing policy.');
    } finally {
      setSavingRouting(false);
    }
  }

  async function handleLoadRepos() {
    setLoadingRepos(true);
    setError(null);
    try {
      const res = await api.integrations.github.repos();
      setRepos(res.repos);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load GitHub repositories.');
    } finally {
      setLoadingRepos(false);
    }
  }

  async function handleCreateRepo(e: FormEvent) {
    e.preventDefault();
    if (!newRepoName.trim()) return;
    setCreatingRepo(true);
    setError(null);
    try {
      const res = await api.integrations.github.createRepo({
        name: newRepoName.trim(),
        description: newRepoDesc.trim() || undefined,
        isPrivate: true,
      });
      setRepos((prev) => [res.repo, ...prev]);
      setNewRepoName('');
      setNewRepoDesc('');
      setNotice(`Created private GitHub repository: ${res.repo.fullName}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create GitHub repository.');
    } finally {
      setCreatingRepo(false);
    }
  }

  async function handleQueueEmail(e: FormEvent) {
    e.preventDefault();
    if (!toEmail.trim() || !emailSubject.trim() || !emailBody.trim()) return;
    setQueueingEmail(true);
    setError(null);
    try {
      const res = await api.integrations.email.queue({
        toEmail: toEmail.trim(),
        subject: emailSubject.trim(),
        bodyText: emailBody.trim(),
      });
      setEmails((prev) => [res.email, ...prev]);
      setToEmail('');
      setEmailSubject('');
      setEmailBody('');
      setNotice('Email queued in outbox awaiting Owner approval.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to queue email.');
    } finally {
      setQueueingEmail(false);
    }
  }

  async function handleEmailDecision(id: string, decision: 'approve_and_send' | 'reject') {
    setError(null);
    try {
      const res = await api.integrations.email.decide(id, decision);
      setEmails((prev) => prev.map((em) => (em.id === id ? res.email : em)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process email decision.');
    }
  }

  async function handleInspectUrl(e: FormEvent) {
    e.preventDefault();
    if (!inspectUrl.trim()) return;
    setInspecting(true);
    setError(null);
    try {
      const res = await api.integrations.browser.inspect(inspectUrl.trim());
      setInspection(res.inspection);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Web page inspection failed.');
    } finally {
      setInspecting(false);
    }
  }

  const githubIntegration = integrations.find((i) => i.providerKey === 'github');

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-white">Integrations, Routing & External Tools</h2>
        <p className="text-xs text-slate-400 mt-1">
          Live completion verification across Gemini, Groq, and OpenAI; intelligent model routing policy; plus GitHub, approval-gated Email, and SSRF-safe Browser tools.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {/* Integration Cards Grid */}
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
                  {item.accountLabel && <div className="text-emerald-300">Verified: {item.accountLabel}</div>}
                  {item.discoveredModels && item.discoveredModels.length > 0 && (
                    <div className="font-mono text-[11px] text-slate-400 truncate">
                      Models: {item.discoveredModels.slice(0, 4).join(', ')}
                      {item.discoveredModels.length > 4 ? ` (+${item.discoveredModels.length - 4})` : ''}
                    </div>
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
                  {canOperate && (
                    <button
                      type="button"
                      disabled={testingKey === item.providerKey}
                      onClick={() => handleTest(item.providerKey)}
                      className="min-h-[38px] px-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingKey === item.providerKey ? 'animate-spin' : ''}`} />
                      <span>{testingKey === item.providerKey ? 'Testing...' : 'Verify Live'}</span>
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
                    className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Intelligent Model Routing Configuration */}
      {routingPolicy && (
        <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#3B82F6]" />
            <div>
              <h3 className="font-display text-base font-semibold text-white">Intelligent Model Routing Policy</h3>
              <p className="text-xs text-slate-400">
                Selects optimal provider and model tier per task category, complexity, and prompt length with automatic provider fallback.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveRouting} className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Preferred Primary Provider</label>
              <select
                disabled={!isOwner}
                value={routingPolicy.preferredProvider}
                onChange={(e) =>
                  setRoutingPolicy({
                    ...routingPolicy,
                    preferredProvider: e.target.value as AiProviderKey | 'auto',
                  })
                }
                className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-white"
              >
                <option value="auto">Automatic by Task Category & Complexity</option>
                <option value="google_gemini">Google Gemini First</option>
                <option value="groq">Groq First</option>
                <option value="openai">OpenAI First</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Fallback Order (comma-separated)</label>
              <input
                type="text"
                disabled={!isOwner}
                value={routingPolicy.fallbackOrder.join(', ')}
                onChange={(e) =>
                  setRoutingPolicy({
                    ...routingPolicy,
                    fallbackOrder: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean) as AiProviderKey[],
                  })
                }
                className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] font-mono text-white"
              />
            </div>

            <div className="flex items-end">
              <label className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] flex items-center justify-between text-slate-200 cursor-pointer">
                <span>Prioritize Low Cost / Fast Tiers</span>
                <input
                  type="checkbox"
                  disabled={!isOwner}
                  checked={routingPolicy.preferCostEfficiency}
                  onChange={(e) =>
                    setRoutingPolicy({
                      ...routingPolicy,
                      preferCostEfficiency: e.target.checked,
                    })
                  }
                  className="accent-[#2563EB] w-4 h-4"
                />
              </label>
            </div>

            {isOwner && (
              <div className="md:col-span-3 flex justify-end">
                <button
                  type="submit"
                  disabled={savingRouting}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                >
                  {savingRouting ? 'Saving...' : 'Save Routing Policy'}
                </button>
              </div>
            )}
          </form>

          {aiAudit.length > 0 && (
            <div className="pt-4 border-t border-white/[0.06] space-y-2">
              <div className="text-xs font-medium text-slate-300">Recent AI Execution Audit ({aiAudit.length})</div>
              <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12] max-h-56 overflow-y-auto">
                {aiAudit.map((row) => (
                  <div key={row.id} className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="font-mono text-slate-300">{row.division}</span> ·{' '}
                      <span className="text-blue-300 font-mono">
                        {row.providerKey}/{row.modelName}
                      </span>{' '}
                      · <span className="text-slate-400">{row.taskCategory} ({row.complexity})</span>
                      {row.fallbackUsed && <span className="ml-2 text-amber-400">[Fallback]</span>}
                      <div className="text-[11px] text-slate-500 truncate">{row.routingReason}</div>
                    </div>
                    <div className="font-mono text-slate-400 tabular-nums shrink-0">
                      {row.status === 'success' ? `${row.totalTokens} tok · ${row.latencyMs}ms` : 'Failed'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Operational Tool Workspaces: GitHub, Email Outbox, Web Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GitHub Operations */}
        <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-[#3B82F6]" />
              <h3 className="font-display text-base font-semibold text-white">GitHub Workspace</h3>
            </div>
            <button
              type="button"
              disabled={loadingRepos || githubIntegration?.connectionStatus !== 'connected'}
              onClick={handleLoadRepos}
              className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] disabled:opacity-40 text-xs text-slate-200 cursor-pointer"
            >
              {loadingRepos ? 'Loading...' : 'Load Repositories'}
            </button>
          </div>

          {githubIntegration?.connectionStatus !== 'connected' ? (
            <p className="text-xs text-slate-400">
              Configure and verify a GitHub token above to list repositories, create new private repos, and commit creations.
            </p>
          ) : (
            <>
              {isOwner && (
                <form onSubmit={handleCreateRepo} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    required
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="new-venture-repo"
                    className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                  />
                  <input
                    type="text"
                    value={newRepoDesc}
                    onChange={(e) => setNewRepoDesc(e.target.value)}
                    placeholder="Optional description"
                    className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                  />
                  <button
                    type="submit"
                    disabled={creatingRepo}
                    className="min-h-[40px] px-3 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                  >
                    {creatingRepo ? 'Creating...' : 'Create Private Repo'}
                  </button>
                </form>
              )}

              {repos.length > 0 && (
                <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12] max-h-48 overflow-y-auto">
                  {repos.map((r) => (
                    <li key={r.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                      <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="text-blue-300 hover:underline truncate">
                        {r.fullName}
                      </a>
                      <span className="text-slate-500">{r.private ? 'Private' : 'Public'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* Web & Browser Inspection Tool */}
        <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#3B82F6]" />
            <div>
              <h3 className="font-display text-base font-semibold text-white">Web & Browser Inspector</h3>
              <p className="text-xs text-slate-400">
                Uses Remote Chromium CDP when verified, or SSRF-safe HTTP DOM Fetch otherwise.
              </p>
            </div>
          </div>

          {canOperate && (
            <form onSubmit={handleInspectUrl} className="flex gap-2">
              <input
                type="url"
                required
                value={inspectUrl}
                onChange={(e) => setInspectUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
              />
              <button
                type="submit"
                disabled={inspecting}
                className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer whitespace-nowrap"
              >
                {inspecting ? 'Inspecting...' : 'Inspect URL'}
              </button>
            </form>
          )}

          {inspection && (
            <div className="rounded-xl border border-white/[0.06] bg-[#0A0D12] p-3.5 space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
                <span className="font-mono text-blue-300">{inspection.mode}</span>
                <span className="font-mono">HTTP {inspection.statusCode} · {inspection.linksCount} links</span>
              </div>
              <div className="font-medium text-white">{inspection.title}</div>
              {inspection.metaDescription && <p className="text-slate-400">{inspection.metaDescription}</p>}
              {inspection.textExcerpt && (
                <p className="text-slate-300 line-clamp-4 leading-relaxed">{inspection.textExcerpt}</p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Approval-Gated Email Outbox */}
      <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#3B82F6]" />
          <div>
            <h3 className="font-display text-base font-semibold text-white">Approval-Gated Email Outbox</h3>
            <p className="text-xs text-slate-400">
              All outbound communications are held in approval queue until explicitly approved by the Owner.
            </p>
          </div>
        </div>

        {canOperate && (
          <form onSubmit={handleQueueEmail} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <input
              type="email"
              required
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="recipient@domain.com"
              className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
            />
            <input
              type="text"
              required
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Subject line"
              className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
            />
            <input
              type="text"
              required
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Plain text body..."
              className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
            />
            <button
              type="submit"
              disabled={queueingEmail}
              className="min-h-[40px] px-4 rounded-xl border border-white/[0.1] hover:bg-white/[0.05] text-xs font-medium text-white cursor-pointer"
            >
              {queueingEmail ? 'Queueing...' : 'Queue Draft'}
            </button>
          </form>
        )}

        {emails.length === 0 ? (
          <p className="text-xs text-slate-500">No outbound emails queued.</p>
        ) : (
          <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
            {emails.map((em) => (
              <div key={em.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-slate-400">
                    <StatusText status={em.status} />
                    <span>·</span>
                    <span className="text-white font-medium">{em.toEmail}</span>
                    <span>·</span>
                    <span className="tabular-nums">{formatTimestamp(em.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-slate-200 font-medium">{em.subject}</div>
                  <p className="mt-0.5 text-slate-400 line-clamp-2">{em.bodyText}</p>
                  {em.errorMessage && <p className="mt-1 text-rose-400">{em.errorMessage}</p>}
                </div>

                {em.status === 'awaiting_approval' && isOwner && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEmailDecision(em.id, 'approve_and_send')}
                      className="min-h-[36px] px-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                    >
                      Approve & Send
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEmailDecision(em.id, 'reject')}
                      className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] text-xs text-slate-300 cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Write-Only Vault Configuration Modal */}
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

              {configuring.providerKey === 'email_services' && (
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Verified Sender From Address</label>
                  <input
                    type="text"
                    value={fromAddressInput}
                    onChange={(e) => setFromAddressInput(e.target.value)}
                    placeholder="Taurus Operations <noreply@yourdomain.com>"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  />
                </div>
              )}

              {(configuring.providerKey === 'groq' || configuring.providerKey === 'openai') && (
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Default Model Override (Optional)</label>
                  <input
                    type="text"
                    value={defaultModelInput}
                    onChange={(e) => setDefaultModelInput(e.target.value)}
                    placeholder={configuring.providerKey === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] font-mono text-xs text-white"
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
                    required={configuring.providerKey !== 'external_apis' && !configuring.hasCredential}
                    autoComplete="off"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder={configuring.hasCredential ? 'Leave blank to keep existing secret...' : 'Enter secret credential...'}
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
