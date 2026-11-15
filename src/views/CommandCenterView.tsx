import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Play, Send, Sparkles } from 'lucide-react';
import type { AgentRecord, CommandRecord, IntegrationRecord, ProjectRecord, TaskRecord, UserRole } from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatTimestamp } from '../lib/api.ts';

interface CommandCenterViewProps {
  userRole: UserRole;
}

export function CommandCenterView({ userRole }: CommandCenterViewProps) {
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [geminiConnected, setGeminiConnected] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [assignedAgentId, setAssignedAgentId] = useState<string>('');
  const [runAiIntake, setRunAiIntake] = useState(true);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedCmdId, setExpandedCmdId] = useState<string | null>(null);
  const [cmdTasks, setCmdTasks] = useState<Record<string, TaskRecord[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const canMutate = userRole === 'owner' || userRole === 'operator';

  async function loadAll() {
    setError(null);
    try {
      const [cmdRes, prjRes, agtRes, intRes] = await Promise.all([
        api.commands.list(),
        api.projects.list(),
        api.agents.list(),
        api.integrations.list(),
      ]);
      setCommands(cmdRes.commands);
      setProjects(prjRes.projects.filter((p) => p.status !== 'archived'));
      setAgents(agtRes.agents);
      const gemini = intRes.integrations.find((i: IntegrationRecord) => i.providerKey === 'google_gemini');
      setGeminiConnected(gemini?.connectionStatus === 'connected');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load command history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadCommandTasks(commandId: string) {
    try {
      const res = await api.commands.tasks(commandId);
      setCmdTasks((prev) => ({ ...prev, [commandId]: res.tasks }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load command tasks.');
    }
  }

  async function handleToggleExpand(commandId: string) {
    if (expandedCmdId === commandId) {
      setExpandedCmdId(null);
      return;
    }
    setExpandedCmdId(commandId);
    await loadCommandTasks(commandId);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !canMutate) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.commands.submit({
        prompt: prompt.trim(),
        projectId: projectId || null,
        assignedAgentId: assignedAgentId || null,
        runAiIntake,
      });
      setPrompt('');
      setCommands((prev) => [res.command, ...prev]);
      setExpandedCmdId(res.command.id);
      await loadCommandTasks(res.command.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit directive.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAnalyze(commandId: string) {
    setBusyId(commandId);
    setError(null);
    try {
      const res = await api.commands.analyze(commandId);
      setCommands((prev) => prev.map((c) => (c.id === commandId ? res.command : c)));
      await loadCommandTasks(commandId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Analysis failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatusUpdate(commandId: string, status: CommandRecord['status'], progressPercent: number, progressStage: string) {
    setBusyId(commandId);
    setError(null);
    try {
      const res = await api.commands.update(commandId, { status, progressPercent, progressStage });
      setCommands((prev) => prev.map((c) => (c.id === commandId ? res.command : c)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update command.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTaskDecision(commandId: string, taskId: string, decision: 'approve' | 'reject' | 'complete') {
    setBusyId(taskId);
    setError(null);
    try {
      await api.commands.decideTask(taskId, decision);
      await loadCommandTasks(commandId);
      const cmdRes = await api.commands.list();
      setCommands(cmdRes.commands);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update task.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Directive Intake Composer */}
      <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Directive Intake</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {geminiConnected
                ? 'Google Gemini is verified. Directives can be decomposed into structured division tasks.'
                : 'Intake queues directives persistently. Verify Google Gemini in Integrations to enable AI task planning.'}
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 whitespace-nowrap">Phase 1 · Intake & Planning</span>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="cmd-prompt" className="sr-only">
              Operational Directive
            </label>
            <textarea
              id="cmd-prompt"
              rows={3}
              required
              disabled={!canMutate || submitting}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Example: "Research and create an online business selling digital products internationally."'
              className="w-full rounded-xl bg-[#0A0D12] border border-white/[0.1] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6] resize-y"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="cmd-project" className="block text-xs text-slate-400 mb-1">
                Associate Project
              </label>
              <select
                id="cmd-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={!canMutate}
                className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#3B82F6]"
              >
                <option value="">No project linked</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cmd-agent" className="block text-xs text-slate-400 mb-1">
                Route to Division / Agent
              </label>
              <select
                id="cmd-agent"
                value={assignedAgentId}
                onChange={(e) => setAssignedAgentId(e.target.value)}
                disabled={!canMutate}
                className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#3B82F6]"
              >
                <option value="">Auto-route by intake</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.division} · {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] flex items-center justify-between gap-2 text-xs text-slate-300 cursor-pointer">
                <span className="inline-flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>AI Task Breakdown</span>
                </span>
                <input
                  type="checkbox"
                  checked={runAiIntake}
                  onChange={(e) => setRunAiIntake(e.target.checked)}
                  className="accent-[#2563EB] w-4 h-4"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <span className="text-xs text-slate-500">
              {canMutate
                ? 'Commands are saved persistently. Autonomous multi-agent execution activates in Phase 2.'
                : 'Viewer role: read-only access.'}
            </span>
            <button
              type="submit"
              disabled={!canMutate || submitting || !prompt.trim()}
              className="min-h-[44px] px-5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? 'Recording Directive...' : 'Submit Directive'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Command History */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-white">Command History</h3>
          <span className="text-xs font-mono text-slate-400 tabular-nums">{commands.length} recorded</span>
        </div>

        {loading ? (
          <div className="h-40 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
        ) : commands.length === 0 ? (
          <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-8 text-center">
            <p className="text-sm text-slate-300">No directives have been submitted yet.</p>
            <p className="text-xs text-slate-500 mt-1">
              Enter an instruction above to record it, associate a project, and structure operational tasks.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
            {commands.map((cmd) => {
              const isExpanded = expandedCmdId === cmd.id;
              const tasks = cmdTasks[cmd.id] || [];
              return (
                <div key={cmd.id} className="p-5 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <StatusText status={cmd.status} />
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-300 tabular-nums">{cmd.progressPercent}%</span>
                        {cmd.assignedDivision && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{cmd.assignedDivision}</span>
                          </>
                        )}
                        {cmd.projectName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-300">{cmd.projectName}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{formatTimestamp(cmd.createdAt)}</span>
                      </div>

                      <p className="mt-2 text-sm sm:text-base font-medium text-white break-words">{cmd.prompt}</p>
                      <p className="mt-1 text-xs text-slate-400">{cmd.progressStage}</p>

                      {cmd.executionNote && (
                        <p className="mt-2 text-xs text-slate-300 leading-relaxed">{cmd.executionNote}</p>
                      )}
                      {cmd.errorMessage && (
                        <p className="mt-2 text-xs text-rose-400">Error: {cmd.errorMessage}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canMutate && cmd.status === 'queued' && (
                        <button
                          type="button"
                          disabled={busyId === cmd.id}
                          onClick={() => handleAnalyze(cmd.id)}
                          className="min-h-[38px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Run AI Intake</span>
                        </button>
                      )}
                      {canMutate && cmd.status !== 'cancelled' && cmd.status !== 'completed' && (
                        <button
                          type="button"
                          disabled={busyId === cmd.id}
                          onClick={() => handleStatusUpdate(cmd.id, 'cancelled', cmd.progressPercent, 'Cancelled by operator')}
                          className="min-h-[38px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-slate-400 cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleToggleExpand(cmd.id)}
                        className="min-h-[38px] px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Tasks & Plan</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Progress Track */}
                  <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        cmd.status === 'failed'
                          ? 'bg-rose-500'
                          : cmd.status === 'completed'
                            ? 'bg-emerald-500'
                            : 'bg-[#3B82F6]'
                      }`}
                      style={{ width: `${cmd.progressPercent}%` }}
                    />
                  </div>

                  {/* Expanded Structured Tasks */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-white/[0.06] space-y-2.5">
                      <div className="text-xs font-medium text-slate-300">
                        Associated Tasks ({tasks.length})
                      </div>
                      {tasks.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No decomposed tasks attached yet. Run AI Intake (with Gemini verified) or assign tasks from the Agents section.
                        </p>
                      ) : (
                        <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                          {tasks.map((t) => (
                            <div key={t.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                  <StatusText status={t.status} />
                                  <span aria-hidden="true">·</span>
                                  <span>{t.division || 'COMMAND'}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>Priority: {t.priority}</span>
                                </div>
                                <div className="mt-1 text-sm text-white font-medium">{t.title}</div>
                                {t.description && (
                                  <p className="mt-0.5 text-xs text-slate-400">{t.description}</p>
                                )}
                              </div>

                              {canMutate && (
                                <div className="flex items-center gap-2 shrink-0">
                                  {t.status === 'awaiting_approval' && userRole === 'owner' && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busyId === t.id}
                                        onClick={() => handleTaskDecision(cmd.id, t.id, 'approve')}
                                        className="min-h-[34px] px-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busyId === t.id}
                                        onClick={() => handleTaskDecision(cmd.id, t.id, 'reject')}
                                        className="min-h-[34px] px-3 rounded-lg border border-white/[0.1] text-xs text-slate-300 cursor-pointer"
                                      >
                                        Reject
                                      </button>
                                    </>
                                  )}
                                  {t.status === 'pending' && (
                                    <button
                                      type="button"
                                      disabled={busyId === t.id}
                                      onClick={() => handleTaskDecision(cmd.id, t.id, 'complete')}
                                      className="min-h-[34px] px-3 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 text-xs text-emerald-300 cursor-pointer"
                                    >
                                      Mark Complete
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
