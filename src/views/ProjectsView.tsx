import { useEffect, useState, type FormEvent } from 'react';
import { Archive, ArchiveRestore, Edit3, History, Plus, X } from 'lucide-react';
import type { ProjectRecord, ProjectStatus, UserRole } from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatBytes, formatTimestamp } from '../lib/api.ts';

interface ProjectsViewProps {
  userRole: UserRole;
}

export function ProjectsView({ userRole }: ProjectsViewProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Operations');
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [saving, setSaving] = useState(false);

  const [historyProject, setHistoryProject] = useState<ProjectRecord | null>(null);
  const [historyData, setHistoryData] = useState<{
    commands: Array<{ id: string; prompt: string; status: string; progressPercent: number; createdAt: string }>;
    tasks: Array<{ id: string; title: string; status: string; division: string | null; priority: string; createdAt: string }>;
    creations: Array<{ id: string; title: string; category: string; status: string; createdAt: string }>;
    files: Array<{ id: string; originalName: string; category: string; sizeBytes: number; createdAt: string }>;
  } | null>(null);

  const canMutate = userRole === 'owner' || userRole === 'operator';

  async function loadProjects() {
    setError(null);
    try {
      const res = await api.projects.list();
      setProjects(res.projects);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  function openCreate() {
    setModalMode('create');
    setEditingId(null);
    setName('');
    setDescription('');
    setCategory('Operations');
    setStatus('active');
  }

  function openEdit(p: ProjectRecord) {
    setModalMode('edit');
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description);
    setCategory(p.category);
    setStatus(p.status);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (modalMode === 'create') {
        await api.projects.create({ name: name.trim(), description: description.trim(), category: category.trim() });
      } else if (modalMode === 'edit' && editingId) {
        await api.projects.update(editingId, {
          name: name.trim(),
          description: description.trim(),
          category: category.trim(),
          status,
        });
      }
      setModalMode(null);
      await loadProjects();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save project.');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle(p: ProjectRecord) {
    setError(null);
    try {
      await api.projects.update(p.id, { status: p.status === 'archived' ? 'active' : 'archived' });
      await loadProjects();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update archive state.');
    }
  }

  async function openHistory(p: ProjectRecord) {
    setHistoryProject(p);
    setHistoryData(null);
    try {
      const data = await api.projects.history(p.id);
      setHistoryData(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load project history.');
    }
  }

  const visibleProjects = projects.filter((p) => {
    if (filter === 'active') return p.status !== 'archived';
    if (filter === 'archived') return p.status === 'archived';
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">Projects</h2>
          <p className="text-xs text-slate-400 mt-1">
            Organize directives, tasks, creations, and stored files into persistent operational workspaces.
          </p>
        </div>

        {canMutate && (
          <button
            type="button"
            onClick={openCreate}
            className="self-start sm:self-auto min-h-[42px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {(['active', 'archived', 'all'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium capitalize cursor-pointer ${
              filter === tab ? 'bg-white text-slate-900' : 'bg-[#11161F] text-slate-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-44 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
      ) : visibleProjects.length === 0 ? (
        <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-8 text-center">
          <p className="text-sm text-slate-300">No {filter === 'all' ? '' : filter} projects found.</p>
          {canMutate && filter !== 'archived' && (
            <button
              type="button"
              onClick={openCreate}
              className="mt-4 min-h-[40px] px-4 rounded-xl bg-[#2563EB] text-xs font-medium text-white cursor-pointer"
            >
              Create First Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleProjects.map((p) => (
            <div key={p.id} className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span>{p.category}</span>
                  <StatusText status={p.status} />
                </div>
                <h3 className="mt-2 font-display text-lg font-semibold text-white">{p.name}</h3>
                {p.description && <p className="mt-1 text-xs text-slate-400 leading-relaxed">{p.description}</p>}
              </div>

              <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-400 tabular-nums">
                  {p.commandCount ?? 0} commands · {p.taskCount ?? 0} tasks · {p.fileCount ?? 0} files
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openHistory(p)}
                    className="min-h-[36px] px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-white inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>History</span>
                  </button>
                  {canMutate && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleArchiveToggle(p)}
                        aria-label={p.status === 'archived' ? 'Restore project' : 'Archive project'}
                        className="min-h-[36px] px-2.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-slate-300 cursor-pointer"
                      >
                        {p.status === 'archived' ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#11161F] border border-white/[0.1] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-white">
                {modalMode === 'create' ? 'Create Project' : 'Edit Project'}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Project Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="International Digital Products Venture"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Business / Software"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  />
                </div>
                {modalMode === 'edit' && (
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                      className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Objectives, scope, and operational notes"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/[0.1] text-xs font-medium text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project History Drawer */}
      {historyProject && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-[#11161F] border-l border-white/[0.1] h-full overflow-y-auto p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.08]">
              <div>
                <div className="text-xs text-slate-400">{historyProject.category}</div>
                <h3 className="font-display text-xl font-semibold text-white mt-1">{historyProject.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setHistoryProject(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!historyData ? (
              <div className="h-32 rounded-xl bg-[#0A0D12] animate-pulse" />
            ) : (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Commands ({historyData.commands.length})</h4>
                  {historyData.commands.length === 0 ? (
                    <p className="text-xs text-slate-500">No commands linked to this project.</p>
                  ) : (
                    <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                      {historyData.commands.map((c) => (
                        <li key={c.id} className="p-3 text-xs">
                          <div className="flex justify-between text-slate-400">
                            <StatusText status={c.status} />
                            <span className="tabular-nums">{formatTimestamp(c.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-slate-200">{c.prompt}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Tasks ({historyData.tasks.length})</h4>
                  {historyData.tasks.length === 0 ? (
                    <p className="text-xs text-slate-500">No tasks linked to this project.</p>
                  ) : (
                    <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                      {historyData.tasks.map((t) => (
                        <li key={t.id} className="p-3 text-xs flex justify-between gap-2">
                          <span className="text-slate-200">{t.title}</span>
                          <StatusText status={t.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Creations ({historyData.creations.length})</h4>
                  {historyData.creations.length === 0 ? (
                    <p className="text-xs text-slate-500">No creations linked to this project.</p>
                  ) : (
                    <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                      {historyData.creations.map((cr) => (
                        <li key={cr.id} className="p-3 text-xs flex justify-between gap-2">
                          <span className="text-slate-200">{cr.title}</span>
                          <span className="text-slate-400 capitalize">{cr.category}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-white mb-2">Library Files ({historyData.files.length})</h4>
                  {historyData.files.length === 0 ? (
                    <p className="text-xs text-slate-500">No files linked to this project.</p>
                  ) : (
                    <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0A0D12]">
                      {historyData.files.map((f) => (
                        <li key={f.id} className="p-3 text-xs flex justify-between gap-2">
                          <span className="text-slate-200 truncate">{f.originalName}</span>
                          <span className="text-slate-400 tabular-nums shrink-0">{formatBytes(f.sizeBytes)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
