import { useEffect, useState, type FormEvent } from 'react';
import { Download, Shield, UserPlus } from 'lucide-react';
import type { AiExecutionAuditRecord, UserProfile, UserRole } from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatBytes, formatTimestamp } from '../lib/api.ts';

interface SettingsViewProps {
  currentUser: UserProfile;
}

export function SettingsView({ currentUser }: SettingsViewProps) {
  const [policy, setPolicy] = useState<{
    requireApprovalForExternalActions?: boolean;
    defaultIntakeMode?: string;
    platformPhase?: string;
  }>({});
  const [infra, setInfra] = useState<{
    nodeVersion: string;
    databaseEngine: string;
    databaseSizeBytes: number;
    storageDirectory: string;
    storageFileCount: number;
    storageTotalBytes: number;
    storageDurability?: string;
    durabilityNotice?: string;
    encryptionAlgorithm: string;
  } | null>(null);
  const [aiExecutions, setAiExecutions] = useState<AiExecutionAuditRecord[]>([]);
  const [logs, setLogs] = useState<
    Array<{
      id: string;
      level: string;
      subsystem: string;
      action: string;
      message: string;
      actor_name: string | null;
      created_at: string;
    }>
  >([]);
  const [users, setUsers] = useState<UserProfile[]>([]);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('operator');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = currentUser.role === 'owner';

  async function loadAll() {
    setError(null);
    try {
      const settingsRes = await api.settings.get();
      setPolicy(settingsRes.policy);
      setInfra(settingsRes.infrastructure);
      setAiExecutions(settingsRes.aiExecutions || []);
      setLogs(settingsRes.logs);

      if (isOwner) {
        const usersRes = await api.auth.users();
        setUsers(usersRes.users);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load settings.');
    }
  }

  useEffect(() => {
    void loadAll();
  }, [isOwner]);

  async function handleToggleApprovalPolicy() {
    if (!isOwner) return;
    setError(null);
    try {
      const res = await api.settings.updatePolicy({
        requireApprovalForExternalActions: !policy.requireApprovalForExternalActions,
      });
      setPolicy(res.policy as typeof policy);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update policy.');
    }
  }

  async function handleExportBackup() {
    if (!isOwner) return;
    setExporting(true);
    setError(null);
    try {
      await api.settings.downloadBackup();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to export workspace backup.');
    } finally {
      setExporting(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    if (!isOwner) return;
    setSaving(true);
    setError(null);
    try {
      await api.auth.createUser({
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
      });
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create operator account.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setError(null);
    try {
      await api.auth.updateUserRole(userId, role);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update role.');
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Governance & Infrastructure Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-white">Governance Policy</h2>
          <div className="flex items-center justify-between gap-4 py-2 border-b border-white/[0.06]">
            <div>
              <div className="text-sm text-white">Require Owner Approval for External Actions</div>
              <div className="text-xs text-slate-400">
                Gates GitHub repo creation, outbound email, and external operations behind Owner approval.
              </div>
            </div>
            <button
              type="button"
              disabled={!isOwner}
              onClick={handleToggleApprovalPolicy}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50 ${
                policy.requireApprovalForExternalActions
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-white/[0.1] text-slate-300'
              }`}
            >
              {policy.requireApprovalForExternalActions ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="text-xs text-slate-400">
            Platform Phase: <span className="text-slate-200">{policy.platformPhase || 'Phase 2: Intelligence & Orchestration'}</span>
          </div>
        </section>

        <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-white">Storage & Runtime Diagnostics</h2>
            {isOwner && (
              <button
                type="button"
                disabled={exporting}
                onClick={handleExportBackup}
                className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exporting ? 'Exporting...' : 'Export Backup'}</span>
              </button>
            )}
          </div>

          {infra ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-slate-500">Database Engine</dt>
                  <dd className="text-slate-200 mt-0.5">{infra.databaseEngine}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Database Size</dt>
                  <dd className="text-slate-200 font-mono tabular-nums mt-0.5">{formatBytes(infra.databaseSizeBytes)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">File Storage</dt>
                  <dd className="text-slate-200 font-mono tabular-nums mt-0.5">
                    {infra.storageFileCount} files ({formatBytes(infra.storageTotalBytes)})
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Vault Encryption</dt>
                  <dd className="text-slate-200 font-mono mt-0.5">{infra.encryptionAlgorithm}</dd>
                </div>
              </dl>
              {infra.durabilityNotice && (
                <p className="text-xs text-amber-300/90 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 leading-relaxed">
                  {infra.durabilityNotice}
                </p>
              )}
            </>
          ) : (
            <div className="h-20 rounded-xl bg-[#0A0D12] animate-pulse" />
          )}
        </section>
      </div>

      {/* Owner-Only Operator & Permission Management */}
      {isOwner && (
        <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#3B82F6]" />
            <h2 className="font-display text-base font-semibold text-white">Operators & Permissions</h2>
          </div>

          <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
            {users.map((u) => (
              <div key={u.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">{u.name}</div>
                  <div className="text-xs text-slate-400">{u.email}</div>
                </div>
                <select
                  aria-label={`Role for ${u.name}`}
                  value={u.role}
                  disabled={u.id === currentUser.id}
                  onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                  className="h-9 px-3 rounded-lg bg-[#11161F] border border-white/[0.1] text-xs text-white disabled:opacity-60"
                >
                  <option value="owner">Owner</option>
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            ))}
          </div>

          <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Operator name"
              className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
            />
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email@taurus.local"
              className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
            />
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Passphrase (8+ chars)"
              className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
            />
            <div className="flex gap-2">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="flex-1 h-10 px-2.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
              >
                <option value="operator">Operator</option>
                <option value="viewer">Viewer</option>
                <option value="owner">Owner</option>
              </select>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[40px] px-3.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* AI Provider Execution Telemetry */}
      <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-white">AI Provider Execution Telemetry</h2>
          <span className="text-xs font-mono text-slate-400 tabular-nums">{aiExecutions.length} recent calls</span>
        </div>
        {aiExecutions.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No routed AI executions recorded yet.</div>
        ) : (
          <div className="divide-y divide-white/[0.06] max-h-64 overflow-y-auto">
            {aiExecutions.map((ex) => (
              <div key={ex.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusText status={ex.status} label={ex.division} />
                    <span className="font-mono text-blue-300">
                      {ex.providerKey}/{ex.modelName}
                    </span>
                    <span className="text-slate-400">
                      {ex.taskCategory} · {ex.complexity}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-400 truncate">{ex.routingReason}</p>
                </div>
                <div className="font-mono text-slate-400 tabular-nums shrink-0">
                  {ex.totalTokens} tok · {ex.latencyMs} ms
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Persistent Execution Audit Logs */}
      <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-white">Execution & Audit Logs</h2>
          <span className="text-xs font-mono text-slate-400 tabular-nums">{logs.length} entries</span>
        </div>

        {logs.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No execution logs recorded yet.</div>
        ) : (
          <div className="divide-y divide-white/[0.06] max-h-[420px] overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-slate-400">
                    <StatusText status={log.level} label={log.subsystem} />
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-500">{log.action}</span>
                    {log.actor_name && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{log.actor_name}</span>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-slate-200 break-words">{log.message}</p>
                </div>
                <div className="font-mono text-slate-500 tabular-nums shrink-0">{formatTimestamp(log.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
