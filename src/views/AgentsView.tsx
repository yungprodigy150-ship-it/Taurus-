import { useEffect, useState, type FormEvent } from 'react';
import { Play, Plus, SlidersHorizontal, X } from 'lucide-react';
import type {
  AgentRecord,
  DivisionCode,
  ExecutionLogRecord,
  ProjectRecord,
  TaskRecord,
  UserRole,
} from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatTimestamp } from '../lib/api.ts';

const DIVISIONS: DivisionCode[] = [
  'COMMAND',
  'FORGE',
  'VANGUARD',
  'SENTRY',
  'ATLAS',
  'NEXUS',
  'TREASURY',
];

interface AgentsViewProps {
  userRole: UserRole;
}

export function AgentsView({ userRole }: AgentsViewProps) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [divisionFilter, setDivisionFilter] = useState<DivisionCode | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDivision, setNewDivision] = useState<DivisionCode>('FORGE');
  const [newDesc, setNewDesc] = useState('');
  const [newResp, setNewResp] = useState('');
  const [saving, setSaving] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<{
    agent: AgentRecord;
    tasks: TaskRecord[];
    history: ExecutionLogRecord[];
  } | null>(null);

  // Direct execution
  const [execTitle, setExecTitle] = useState('');
  const [execObjective, setExecObjective] = useState('');
  const [execProjectId, setExecProjectId] = useState('');
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<{
    outputSummary: string;
    providerKey: string;
    modelName: string;
    tokensUsed: number;
    latencyMs: number;
  } | null>(null);

  // Assign queued task
  const [taskTitle, setTaskTitle] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskApproval, setTaskApproval] = useState(false);

  const [editProvider, setEditProvider] = useState('auto_routed');
  const [editStatus, setEditStatus] = useState<AgentRecord['status']>('standby');

  const canMutate = userRole === 'owner' || userRole === 'operator';

  async function loadAgents() {
    setError(null);
    try {
      const [agtRes, prjRes] = await Promise.all([api.agents.list(), api.projects.list()]);
      setAgents(agtRes.agents);
      setProjects(prjRes.projects.filter((p) => p.status !== 'archived'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load agents.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  async function openAgentDetails(id: string) {
    setSelectedAgentId(id);
    setExecResult(null);
    setError(null);
    try {
      const data = await api.agents.details(id);
      setDetailData(data);
      setEditProvider(data.agent.modelProvider);
      setEditStatus(data.agent.status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load agent details.');
    }
  }

  async function handleCreateAgent(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.agents.create({
        name: newName.trim(),
        division: newDivision,
        description: newDesc.trim(),
        responsibilities: newResp.trim(),
        status: 'configured',
      });
      setNewName('');
      setNewDesc('');
      setNewResp('');
      setShowCreateModal(false);
      await loadAgents();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create agent.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateConfig(e: FormEvent) {
    e.preventDefault();
    if (!detailData) return;
    setSaving(true);
    setError(null);
    try {
      await api.agents.update(detailData.agent.id, {
        modelProvider: editProvider,
        modelName: editProvider === 'auto_routed' ? 'intelligent_router' : detailData.agent.modelName,
        status: editStatus,
      });
      await openAgentDetails(detailData.agent.id);
      await loadAgents();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update agent configuration.');
    } finally {
      setSaving(false);
    }
  }

  async function handleExecuteNow(e: FormEvent) {
    e.preventDefault();
    if (!detailData || !execTitle.trim()) return;
    setExecuting(true);
    setError(null);
    setExecResult(null);
    try {
      const res = await api.agents.executeTask(detailData.agent.id, {
        title: execTitle.trim(),
        objective: execObjective.trim() || undefined,
        projectId: execProjectId || null,
      });
      setExecResult(res.result);
      setExecTitle('');
      setExecObjective('');
      await openAgentDetails(detailData.agent.id);
      await loadAgents();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Direct division execution failed.');
    } finally {
      setExecuting(false);
    }
  }

  async function handleAssignTask(e: FormEvent) {
    e.preventDefault();
    if (!detailData || !taskTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.agents.assignTask(detailData.agent.id, {
        title: taskTitle.trim(),
        projectId: taskProjectId || null,
        requiresApproval: taskApproval,
      });
      setTaskTitle('');
      setTaskApproval(false);
      await openAgentDetails(detailData.agent.id);
      await loadAgents();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign task.');
    } finally {
      setSaving(false);
    }
  }

  const filteredAgents =
    divisionFilter === 'ALL' ? agents : agents.filter((a) => a.division === divisionFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">Operational Divisions & Agents</h2>
          <p className="text-xs text-slate-400 mt-1">
            Specialized AI divisions equipped with intelligent model routing, deliverable storage, and direct execution. Agents activate automatically when at least one AI provider is verified.
          </p>
        </div>

        {canMutate && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="self-start sm:self-auto min-h-[42px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Register Agent</span>
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Division Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setDivisionFilter('ALL')}
          className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
            divisionFilter === 'ALL' ? 'bg-white text-slate-900' : 'bg-[#11161F] text-slate-400 hover:text-white'
          }`}
        >
          All Divisions
        </button>
        {DIVISIONS.map((div) => (
          <button
            key={div}
            type="button"
            onClick={() => setDivisionFilter(div)}
            className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
              divisionFilter === div ? 'bg-white text-slate-900' : 'bg-[#11161F] text-slate-400 hover:text-white'
            }`}
          >
            {div}
          </button>
        ))}
      </div>

      {/* Agents Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="font-mono text-slate-300">{agent.division}</span>
                  <StatusText status={agent.status} />
                </div>
                <h3 className="mt-2 font-display text-base font-semibold text-white">{agent.name}</h3>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed line-clamp-3">{agent.description}</p>
              </div>

              <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="truncate">
                  {agent.runtimeMode === 'ai_orchestrated'
                    ? 'AI Orchestrated'
                    : agent.runtimeMode === 'intake_assisted'
                      ? 'AI Intake Assisted'
                      : 'Standby'}{' '}
                  · <span className="tabular-nums">{agent.completedTaskCount ?? 0}</span> done
                </span>
                <button
                  type="button"
                  onClick={() => openAgentDetails(agent.id)}
                  className="min-h-[38px] px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-white inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Inspect & Run</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Register Custom Agent Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#11161F] border border-white/[0.1] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-white">Register New Agent</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAgent} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Agent Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Market Research Specialist"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Operational Division</label>
                <select
                  value={newDivision}
                  onChange={(e) => setNewDivision(e.target.value as DivisionCode)}
                  className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                >
                  {DIVISIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Purpose and operational scope"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Responsibilities</label>
                <textarea
                  rows={2}
                  value={newResp}
                  onChange={(e) => setNewResp(e.target.value)}
                  placeholder="Assigned task domains and boundaries"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/[0.1] text-xs font-medium text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Create Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Agent Detail, Execution & Config Drawer */}
      {selectedAgentId && detailData && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-[#11161F] border-l border-white/[0.1] h-full overflow-y-auto p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.08]">
              <div>
                <div className="text-xs font-mono text-slate-400">
                  {detailData.agent.division} · {detailData.agent.runtimeMode.replace(/_/g, ' ')}
                </div>
                <h3 className="font-display text-xl font-semibold text-white mt-1">{detailData.agent.name}</h3>
                <p className="text-xs text-slate-400 mt-1">{detailData.agent.responsibilities}</p>
                {detailData.agent.capabilities.length > 0 && (
                  <p className="text-[11px] font-mono text-slate-500 mt-2">
                    Capabilities: {detailData.agent.capabilities.join(' · ')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedAgentId(null);
                  setDetailData(null);
                }}
                className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Direct AI Task Execution */}
            {canMutate && (
              <form onSubmit={handleExecuteNow} className="space-y-3 pb-5 border-b border-white/[0.08]">
                <h4 className="text-sm font-semibold text-white">Execute Task Immediately</h4>
                <input
                  type="text"
                  required
                  value={execTitle}
                  onChange={(e) => setExecTitle(e.target.value)}
                  placeholder={`Give ${detailData.agent.division} an immediate deliverable or analysis task...`}
                  className="w-full h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                />
                <textarea
                  rows={2}
                  value={execObjective}
                  onChange={(e) => setExecObjective(e.target.value)}
                  placeholder="Optional details, URLs to inspect (for ATLAS), or output requirements..."
                  className="w-full px-3 py-2 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={execProjectId}
                    onChange={(e) => setExecProjectId(e.target.value)}
                    className="flex-1 h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                  >
                    <option value="">No project linked</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={executing || !execTitle.trim()}
                    className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-xs font-medium text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{executing ? 'Executing...' : 'Run via Division'}</span>
                  </button>
                </div>

                {execResult && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-1.5">
                    <div className="text-[11px] font-mono text-emerald-300">
                      Completed via {execResult.providerKey}/{execResult.modelName} · {execResult.tokensUsed} tokens ·{' '}
                      {execResult.latencyMs} ms
                    </div>
                    <div className="text-xs text-slate-200 whitespace-pre-wrap">{execResult.outputSummary}</div>
                  </div>
                )}
              </form>
            )}

            {canMutate && (
              <form onSubmit={handleUpdateConfig} className="space-y-3 pb-5 border-b border-white/[0.08]">
                <h4 className="text-sm font-semibold text-white">Agent Routing & Status</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Provider Binding</label>
                    <select
                      value={editProvider}
                      onChange={(e) => setEditProvider(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                    >
                      <option value="auto_routed">Intelligent Router (Recommended)</option>
                      <option value="google_gemini">Google Gemini</option>
                      <option value="groq">Groq</option>
                      <option value="openai">OpenAI</option>
                      <option value="unassigned">Unassigned</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Operational Status</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as AgentRecord['status'])}
                      className="w-full h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                    >
                      <option value="standby">Standby</option>
                      <option value="configured">Configured</option>
                      <option value="active">Active (Requires Verified Provider)</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[38px] px-4 rounded-xl border border-white/[0.15] hover:bg-white/[0.05] text-xs font-medium text-white cursor-pointer"
                >
                  Save Configuration
                </button>
              </form>
            )}

            {canMutate && (
              <form onSubmit={handleAssignTask} className="space-y-3 pb-5 border-b border-white/[0.08]">
                <h4 className="text-sm font-semibold text-white">Queue Persistent Task</h4>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Task title..."
                  className="w-full h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={taskProjectId}
                    onChange={(e) => setTaskProjectId(e.target.value)}
                    className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <label className="h-10 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={taskApproval}
                      onChange={(e) => setTaskApproval(e.target.checked)}
                      className="accent-[#2563EB]"
                    />
                    <span>Requires Approval</span>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[38px] px-4 rounded-xl border border-white/[0.15] hover:bg-white/[0.05] text-xs font-medium text-white cursor-pointer"
                >
                  Queue Task
                </button>
              </form>
            )}

            <div className="space-y-2.5">
              <h4 className="text-sm font-semibold text-white">Assigned Tasks ({detailData.tasks.length})</h4>
              {detailData.tasks.length === 0 ? (
                <p className="text-xs text-slate-500">No tasks assigned to this agent yet.</p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                  {detailData.tasks.map((t) => (
                    <li key={t.id} className="p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <StatusText status={t.status} />
                        <span className="text-slate-500 tabular-nums">{formatTimestamp(t.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-sm text-white">{t.title}</div>
                      {t.resultNotes && <p className="mt-1 text-xs text-slate-400 line-clamp-3">{t.resultNotes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2.5">
              <h4 className="text-sm font-semibold text-white">Division Execution History</h4>
              {detailData.history.length === 0 ? (
                <p className="text-xs text-slate-500">No execution events logged for this agent yet.</p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                  {detailData.history.map((log) => (
                    <li key={log.id} className="p-3 text-xs">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="font-mono">{log.action}</span>
                        <span className="tabular-nums">{formatTimestamp(log.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-slate-200">{log.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
