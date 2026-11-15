import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Cpu, Play, Send, Sparkles } from 'lucide-react';
import type {
  AgentRecord,
  CommandRecord,
  ExecutionRunRecord,
  IntegrationRecord,
  ProjectRecord,
  TaskRecord,
  UserRole,
} from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatTimestamp } from '../lib/api.ts';

interface CommandCenterViewProps {
  userRole: UserRole;
}

export function CommandCenterView({ userRole }: CommandCenterViewProps) {
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [connectedAiCount, setConnectedAiCount] = useState(0);

  const [prompt, setPrompt] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [assignedAgentId, setAssignedAgentId] = useState<string>('');
  const [autoExecute, setAutoExecute] = useState(true);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedCmdId, setExpandedCmdId] = useState<string | null>(null);
  const [cmdRuns, setCmdRuns] = useState<Record<string, ExecutionRunRecord | null>>({});
  const [cmdTasks, setCmdTasks] = useState<Record<string, TaskRecord[]>>({});
  const [clarifyInputs, setClarifyInputs] = useState<Record<string, string>>({});
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
      const aiReady = intRes.integrations.filter(
        (i: IntegrationRecord) => i.category === 'ai_provider' && i.connectionStatus === 'connected'
      ).length;
      setConnectedAiCount(aiReady);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load command history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadCommandDetails(commandId: string) {
    try {
      const [runRes, tasksRes] = await Promise.all([api.commands.run(commandId), api.commands.tasks(commandId)]);
      setCmdRuns((prev) => ({ ...prev, [commandId]: runRes.executionRun }));
      setCmdTasks((prev) => ({ ...prev, [commandId]: tasksRes.tasks }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load execution run details.');
    }
  }

  async function handleToggleExpand(commandId: string) {
    if (expandedCmdId === commandId) {
      setExpandedCmdId(null);
      return;
    }
    setExpandedCmdId(commandId);
    await loadCommandDetails(commandId);
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
        autoExecute,
        runAiIntake: true,
      });
      setPrompt('');
      setCommands((prev) => [res.command, ...prev]);
      setCmdRuns((prev) => ({ ...prev, [res.command.id]: res.executionRun }));
      setExpandedCmdId(res.command.id);
      await loadCommandDetails(res.command.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit directive.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePlanOrExecute(commandId: string, mode: 'analyze' | 'execute') {
    setBusyId(commandId);
    setError(null);
    try {
      const res =
        mode === 'analyze'
          ? await api.commands.analyze(commandId, autoExecute)
          : await api.commands.execute(commandId);
      setCommands((prev) => prev.map((c) => (c.id === commandId ? res.command : c)));
      setCmdRuns((prev) => ({ ...prev, [commandId]: res.executionRun }));
      setExpandedCmdId(commandId);
      await loadCommandDetails(commandId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Execution request failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleClarifySubmit(e: FormEvent, commandId: string) {
    e.preventDefault();
    const answer = (clarifyInputs[commandId] || '').trim();
    if (!answer) return;
    setBusyId(commandId);
    setError(null);
    try {
      const res = await api.commands.clarify(commandId, answer, autoExecute);
      setClarifyInputs((prev) => ({ ...prev, [commandId]: '' }));
      setCommands((prev) => prev.map((c) => (c.id === commandId ? res.command : c)));
      setCmdRuns((prev) => ({ ...prev, [commandId]: res.executionRun }));
      await loadCommandDetails(commandId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process clarification.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleStepDecision(commandId: string, stepId: string, decision: 'approve' | 'reject') {
    setBusyId(stepId);
    setError(null);
    try {
      const res = await api.commands.decideStep(stepId, decision);
      setCmdRuns((prev) => ({ ...prev, [commandId]: res.executionRun }));
      const cmdList = await api.commands.list();
      setCommands(cmdList.commands);
      await loadCommandDetails(commandId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process step approval.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatusUpdate(
    commandId: string,
    status: CommandRecord['status'],
    progressPercent: number,
    progressStage: string
  ) {
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
      await loadCommandDetails(commandId);
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
      {/* Directive Composer */}
      <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Autonomous Command Center</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {connectedAiCount > 0
                ? `${connectedAiCount} verified AI provider${connectedAiCount > 1 ? 's' : ''} connected. TAURUS interprets objectives, selects optimal models, delegates to divisions, and executes workflows.`
                : 'No verified AI provider connected. Verify Gemini, Groq, or OpenAI in Integrations to execute directives.'}
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
            Orchestration Engine · Live
          </span>
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
              placeholder='Example: "Build an interactive SaaS landing page and pricing calculator for a Nordic cybersecurity compliance tool, plus prepare a go-to-market plan."'
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
                Primary Division / Agent
              </label>
              <select
                id="cmd-agent"
                value={assignedAgentId}
                onChange={(e) => setAssignedAgentId(e.target.value)}
                disabled={!canMutate}
                className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#3B82F6]"
              >
                <option value="">Auto-delegate across divisions</option>
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
                  <span>Plan & Execute Immediately</span>
                </span>
                <input
                  type="checkbox"
                  checked={autoExecute}
                  onChange={(e) => setAutoExecute(e.target.checked)}
                  className="accent-[#2563EB] w-4 h-4"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <span className="text-xs text-slate-500">
              {canMutate
                ? 'External actions (GitHub repo creation, outbound email) automatically pause for Owner approval.'
                : 'Viewer role: read-only access.'}
            </span>
            <button
              type="submit"
              disabled={!canMutate || submitting || !prompt.trim()}
              className="min-h-[44px] px-5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>
                {submitting
                  ? autoExecute
                    ? 'Orchestrating Execution...'
                    : 'Generating Plan...'
                  : autoExecute
                    ? 'Plan & Execute Directive'
                    : 'Generate Plan Only'}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* Command History & Live Run Monitor */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-white">Directives & Execution Monitor</h3>
          <span className="text-xs font-mono text-slate-400 tabular-nums">{commands.length} recorded</span>
        </div>

        {loading ? (
          <div className="h-40 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
        ) : commands.length === 0 ? (
          <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-8 text-center">
            <p className="text-sm text-slate-300">No directives have been submitted yet.</p>
            <p className="text-xs text-slate-500 mt-1">
              Enter an instruction in plain language above to plan, delegate, and execute real work.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
            {commands.map((cmd) => {
              const isExpanded = expandedCmdId === cmd.id;
              const run = cmdRuns[cmd.id] || null;
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
                            <span className="font-mono">{cmd.assignedDivision}</span>
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
                        <p className="mt-2 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{cmd.executionNote}</p>
                      )}
                      {cmd.errorMessage && <p className="mt-2 text-xs text-rose-400">Error: {cmd.errorMessage}</p>}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canMutate && cmd.status === 'queued' && (
                        <button
                          type="button"
                          disabled={busyId === cmd.id}
                          onClick={() => handlePlanOrExecute(cmd.id, 'analyze')}
                          className="min-h-[40px] px-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Plan & Execute</span>
                        </button>
                      )}
                      {canMutate && (cmd.status === 'planned' || cmd.status === 'partial' || cmd.status === 'failed') && (
                        <button
                          type="button"
                          disabled={busyId === cmd.id}
                          onClick={() => handlePlanOrExecute(cmd.id, 'execute')}
                          className="min-h-[40px] px-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>{busyId === cmd.id ? 'Executing...' : 'Execute Pending Steps'}</span>
                        </button>
                      )}
                      {canMutate && cmd.status !== 'cancelled' && cmd.status !== 'completed' && (
                        <button
                          type="button"
                          disabled={busyId === cmd.id}
                          onClick={() => handleStatusUpdate(cmd.id, 'cancelled', cmd.progressPercent, 'Cancelled by operator')}
                          className="min-h-[40px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-slate-400 cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleToggleExpand(cmd.id)}
                        className="min-h-[40px] px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Execution Details</span>
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
                            : cmd.status === 'partial' || cmd.status === 'awaiting_approval' || cmd.status === 'clarification_needed'
                              ? 'bg-amber-500'
                              : 'bg-[#3B82F6]'
                      }`}
                      style={{ width: `${cmd.progressPercent}%` }}
                    />
                  </div>

                  {/* Clarification Prompt if Critical Info Missing */}
                  {cmd.status === 'clarification_needed' && cmd.clarificationQuestions && cmd.clarificationQuestions.length > 0 && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                      <div className="text-xs font-semibold text-amber-200">
                        Clarification Needed Before Execution
                      </div>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-amber-100">
                        {cmd.clarificationQuestions.map((q, idx) => (
                          <li key={idx}>{q}</li>
                        ))}
                      </ul>
                      {canMutate && (
                        <form onSubmit={(e) => handleClarifySubmit(e, cmd.id)} className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            required
                            value={clarifyInputs[cmd.id] || ''}
                            onChange={(e) => setClarifyInputs((prev) => ({ ...prev, [cmd.id]: e.target.value }))}
                            placeholder="Provide the missing details..."
                            className="flex-1 h-10 px-3 rounded-lg bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                          />
                          <button
                            type="submit"
                            disabled={busyId === cmd.id}
                            className="min-h-[40px] px-4 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                          >
                            {busyId === cmd.id ? 'Processing...' : 'Submit & Run'}
                          </button>
                        </form>
                      )}
                    </div>
                  )}

                  {/* Expanded Execution Run Monitor & Tasks */}
                  {isExpanded && (
                    <div className="pt-4 border-t border-white/[0.06] space-y-5">
                      {run && (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-slate-200 inline-flex items-center gap-2">
                              <Cpu className="w-3.5 h-3.5 text-[#3B82F6]" />
                              <span>Execution Run · {run.assignedDivisions.join(', ')}</span>
                            </div>
                            <span className="font-mono text-xs text-slate-400 tabular-nums">
                              {run.totalTokens.toLocaleString()} total tokens · {run.steps.length} steps
                            </span>
                          </div>

                          <div className="text-xs text-slate-400">
                            Objective: <span className="text-slate-200">{run.interpretedObjective}</span>
                          </div>

                          {/* Steps List */}
                          <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                            {run.steps.map((step) => (
                              <div key={step.id} className="p-4 space-y-2">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                    <span className="font-mono text-slate-500 tabular-nums">#{step.stepIndex + 1}</span>
                                    <span className="font-mono text-slate-200">{step.division}</span>
                                    <span aria-hidden="true">·</span>
                                    <StatusText status={step.status} />
                                    {step.providerKey && step.modelName && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono text-blue-300">
                                          {step.providerKey}/{step.modelName}
                                        </span>
                                      </>
                                    )}
                                    {step.tokensUsed > 0 && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono tabular-nums">{step.tokensUsed} tok</span>
                                      </>
                                    )}
                                    {step.latencyMs !== null && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono tabular-nums">{step.latencyMs} ms</span>
                                      </>
                                    )}
                                  </div>

                                  {step.status === 'awaiting_approval' && userRole === 'owner' && (
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        disabled={busyId === step.id}
                                        onClick={() => handleStepDecision(cmd.id, step.id, 'approve')}
                                        className="min-h-[36px] px-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                                      >
                                        Approve & Resume
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busyId === step.id}
                                        onClick={() => handleStepDecision(cmd.id, step.id, 'reject')}
                                        className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] text-xs text-slate-300 cursor-pointer"
                                      >
                                        Skip
                                      </button>
                                    </div>
                                  )}
                                </div>

                                <div className="text-sm font-medium text-white">{step.title}</div>
                                <div className="text-xs text-slate-400">{step.objective}</div>
                                {step.routingReason && (
                                  <div className="text-[11px] text-slate-500">Routing: {step.routingReason}</div>
                                )}
                                {step.outputSummary && (
                                  <div className="mt-2 rounded-lg bg-[#11161F] border border-white/[0.06] p-3 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                                    {step.outputSummary}
                                  </div>
                                )}
                                {step.errorMessage && (
                                  <div className="text-xs text-rose-400">Step error: {step.errorMessage}</div>
                                )}
                              </div>
                            ))}
                          </div>

                          {run.finalReport && (
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1.5">
                              <div className="text-xs font-semibold text-emerald-300">Compiled Execution Report</div>
                              <pre className="whitespace-pre-wrap font-sans text-xs text-slate-200 leading-relaxed">
                                {run.finalReport}
                              </pre>
                            </div>
                          )}

                          {run.remainingWork && (
                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-amber-200">
                              <span className="font-semibold">Remaining / Blocked Work: </span>
                              {run.remainingWork}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Associated Tasks */}
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-300">Associated Tasks ({tasks.length})</div>
                        {tasks.length === 0 ? (
                          <p className="text-xs text-slate-500">No tasks attached to this directive.</p>
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
                                  {t.resultNotes && (
                                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{t.resultNotes}</p>
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
                                          className="min-h-[36px] px-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                                        >
                                          Approve
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyId === t.id}
                                          onClick={() => handleTaskDecision(cmd.id, t.id, 'reject')}
                                          className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] text-xs text-slate-300 cursor-pointer"
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
                                        className="min-h-[36px] px-3 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 text-xs text-emerald-300 cursor-pointer"
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
