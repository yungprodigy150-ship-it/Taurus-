import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { OverviewPayload, UserRole } from '../../shared/types.ts';
import type { NavSectionId } from '../components/LayoutShell.tsx';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatTimestamp } from '../lib/api.ts';

interface OverviewViewProps {
  userRole: UserRole;
  onNavigate: (section: NavSectionId) => void;
}

export function OverviewView({ userRole, onNavigate }: OverviewViewProps) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  async function loadOverview() {
    setError(null);
    try {
      const payload = await api.overview.get();
      setData(payload);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load system overview.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  async function handleApprovalDecision(taskId: string, decision: 'approve' | 'reject') {
    setBusyTaskId(taskId);
    setError(null);
    try {
      await api.commands.decideTask(taskId, decision);
      await loadOverview();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process task decision.');
    } finally {
      setBusyTaskId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-24 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-[#11161F] border border-rose-500/30 p-6">
        <p className="text-sm text-rose-300">{error || 'Overview data unavailable.'}</p>
        <button
          type="button"
          onClick={loadOverview}
          className="mt-4 min-h-[40px] px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-white cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const statItems = [
    {
      label: 'Active Agents',
      value: data.metrics.activeAgents,
      sub: `${data.metrics.totalAgents} divisions registered`,
      action: () => onNavigate('agents'),
    },
    {
      label: 'Running Tasks',
      value: data.metrics.runningTasks,
      sub: `${data.metrics.totalCommands} directives logged`,
      action: () => onNavigate('command'),
    },
    {
      label: 'Completed Tasks',
      value: data.metrics.completedTasks,
      sub: 'Verified completions',
      action: () => onNavigate('command'),
    },
    {
      label: 'Active Projects',
      value: data.metrics.activeProjects,
      sub: `${data.metrics.totalCreations} creations`,
      action: () => onNavigate('projects'),
    },
    {
      label: 'AI Providers',
      value: data.metrics.connectedAiProviders,
      sub: 'Verified connections',
      action: () => onNavigate('integrations'),
    },
    {
      label: 'Awaiting Approval',
      value: data.metrics.pendingApprovals,
      sub: 'Gated actions',
      action: () => onNavigate('command'),
    },
  ];

  return (
    <div className="space-y-8">
      {/* System Status Header */}
      <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-3">
            <StatusText status={data.systemStatus.health} />
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-xs text-slate-400">{data.systemStatus.phaseLabel}</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white mt-2">
            Operations Control Center
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Database {data.systemStatus.databaseConnected ? 'connected' : 'unavailable'} · Disk storage{' '}
            {data.systemStatus.storageAvailable ? 'ready' : 'unavailable'} ·{' '}
            <span className="tabular-nums">{data.systemStatus.verifiedProviders}</span> verified integration
            {data.systemStatus.verifiedProviders === 1 ? '' : 's'}
          </p>
        </div>

        <button
          type="button"
          onClick={loadOverview}
          className="self-start sm:self-auto min-h-[40px] px-4 rounded-xl border border-white/[0.1] hover:bg-white/[0.04] text-xs font-medium text-slate-200 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Telemetry</span>
        </button>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Primary Metrics Strip */}
      <section aria-label="Operational metrics" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="text-left rounded-2xl bg-[#11161F] border border-white/[0.08] hover:border-white/[0.16] p-4 transition-colors cursor-pointer"
          >
            <div className="text-xs font-medium text-slate-400 truncate">{item.label}</div>
            <div className="mt-2 font-display text-2xl font-semibold text-white tabular-nums">{item.value}</div>
            <div className="mt-1 text-xs text-slate-500 truncate">{item.sub}</div>
          </button>
        ))}
      </section>

      {/* Two-Column Operational Feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Tasks Requiring Approval */}
        <section className="lg:col-span-5 rounded-2xl bg-[#11161F] border border-white/[0.08] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-semibold text-white">Tasks Requiring Approval</h3>
              <p className="text-xs text-slate-400 mt-0.5">Actions gated by operator policy</p>
            </div>
            <span className="font-mono text-xs text-slate-400 tabular-nums">{data.pendingApprovals.length}</span>
          </div>

          {data.pendingApprovals.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">
              No tasks are currently awaiting approval. Directives requiring human sign-off appear here.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {data.pendingApprovals.map((task) => (
                <li key={task.id} className="p-5 space-y-3">
                  <div>
                    <div className="text-sm font-medium text-white">{task.title}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {task.division || 'COMMAND'} · {task.projectName || 'Unassigned Project'} ·{' '}
                      <span className="tabular-nums">{formatTimestamp(task.createdAt)}</span>
                    </div>
                    {task.description && (
                      <p className="mt-2 text-xs text-slate-300 leading-relaxed">{task.description}</p>
                    )}
                  </div>

                  {userRole === 'owner' ? (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busyTaskId === task.id}
                        onClick={() => handleApprovalDecision(task.id, 'approve')}
                        className="min-h-[38px] px-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-xs font-medium text-white cursor-pointer"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyTaskId === task.id}
                        onClick={() => handleApprovalDecision(task.id, 'reject')}
                        className="min-h-[38px] px-3.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] disabled:opacity-50 text-xs font-medium text-slate-300 cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-400">Owner role required to approve gated tasks.</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent Activity Log */}
        <section className="lg:col-span-7 rounded-2xl bg-[#11161F] border border-white/[0.08] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-semibold text-white">Recent Activity</h3>
              <p className="text-xs text-slate-400 mt-0.5">Live operational audit trail from persistent storage</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="text-xs font-medium text-[#3B82F6] hover:text-blue-300 cursor-pointer"
            >
              Full Logs
            </button>
          </div>

          {data.recentActivity.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">
              No operational events recorded yet. Create a project, test an integration, or submit a directive in the
              Command Center.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {data.recentActivity.map((entry) => (
                <li key={entry.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <StatusText status={entry.level} label={entry.subsystem} />
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px] text-slate-500">{entry.action}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-200 break-words">{entry.message}</p>
                  </div>
                  <div className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                    {formatTimestamp(entry.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
