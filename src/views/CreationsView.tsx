import { useEffect, useState, type FormEvent } from 'react';
import { Download, Eye, Plus, Trash2, X } from 'lucide-react';
import type {
  CreationCategory,
  CreationContentType,
  CreationRecord,
  ProjectRecord,
  UserRole,
} from '../../shared/types.ts';
import { api, ApiError, formatTimestamp, getStoredSessionToken } from '../lib/api.ts';

const CATEGORIES: Array<{ id: CreationCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'website', label: 'Websites' },
  { id: 'application', label: 'Applications' },
  { id: 'business', label: 'Businesses' },
  { id: 'document', label: 'Documents' },
  { id: 'design', label: 'Designs' },
  { id: 'media', label: 'Media' },
  { id: 'other', label: 'Other' },
];

interface CreationsViewProps {
  userRole: UserRole;
}

export function CreationsView({ userRole }: CreationsViewProps) {
  const [creations, setCreations] = useState<CreationRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [category, setCategory] = useState<CreationCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [newCategory, setNewCategory] = useState<CreationCategory>('website');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [contentType, setContentType] = useState<CreationContentType>('html');
  const [contentBody, setContentBody] = useState('');
  const [saving, setSaving] = useState(false);

  const [previewItem, setPreviewItem] = useState<CreationRecord | null>(null);

  const canMutate = userRole === 'owner' || userRole === 'operator';

  async function loadAll(cat: CreationCategory | 'all' = category) {
    setError(null);
    try {
      const [cRes, pRes] = await Promise.all([api.creations.list(cat), api.projects.list()]);
      setCreations(cRes.creations);
      setProjects(pRes.projects.filter((p) => p.status !== 'archived'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load creations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll(category);
  }, [category]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.creations.create({
        title: title.trim(),
        category: newCategory,
        description: description.trim(),
        projectId: projectId || null,
        contentType,
        contentBody,
      });
      setTitle('');
      setDescription('');
      setContentBody('');
      setShowCreate(false);
      await loadAll(category);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save creation.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload(item: CreationRecord) {
    setError(null);
    try {
      const token = getStoredSessionToken();
      const res = await fetch(`/api/creations/${item.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext =
        item.contentType === 'html'
          ? 'html'
          : item.contentType === 'markdown'
            ? 'md'
            : item.contentType === 'json'
              ? 'json'
              : 'txt';
      a.href = url;
      a.download = `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'creation'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await api.creations.delete(id);
      setCreations((prev) => prev.filter((c) => c.id !== id));
      if (previewItem?.id === id) setPreviewItem(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete creation.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">My Creations</h2>
          <p className="text-xs text-slate-400 mt-1">
            Deliverables produced by TAURUS with live preview rendering and direct asset downloads.
          </p>
        </div>

        {canMutate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="self-start sm:self-auto min-h-[42px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Register Creation</span>
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
              category === cat.id ? 'bg-white text-slate-900' : 'bg-[#11161F] text-slate-400 hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-44 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
      ) : creations.length === 0 ? (
        <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-8 text-center">
          <p className="text-sm text-slate-300">No creations stored in this category yet.</p>
          <p className="text-xs text-slate-500 mt-1">
            Synthesize a venture in Business Foundry or register an HTML, Markdown, or JSON deliverable here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {creations.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="capitalize">{item.category}</span>
                  <span className="font-mono uppercase">{item.contentType}</span>
                </div>
                <h3 className="mt-2 font-display text-base font-semibold text-white">{item.title}</h3>
                {item.description && <p className="mt-1 text-xs text-slate-400 line-clamp-2">{item.description}</p>}
                <div className="mt-2 text-xs text-slate-500 tabular-nums">
                  {item.projectName ? `${item.projectName} · ` : ''}
                  {formatTimestamp(item.updatedAt)}
                </div>
              </div>

              <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewItem(item)}
                    className="min-h-[36px] px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(item)}
                    className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>

                {canMutate && (
                  <button
                    type="button"
                    aria-label={`Delete ${item.title}`}
                    onClick={() => handleDelete(item.id)}
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

      {/* Register Creation Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[#11161F] border border-white/[0.1] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-white">Register Creation</h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Product Landing Prototype"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as CreationCategory)}
                    className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  >
                    {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Format</label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as CreationContentType)}
                    className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  >
                    <option value="html">HTML (Live Preview)</option>
                    <option value="markdown">Markdown</option>
                    <option value="json">JSON</option>
                    <option value="text">Plain Text</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Project</label>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  >
                    <option value="">None</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief summary of deliverable"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Asset Source / Content</label>
                <textarea
                  rows={8}
                  required
                  value={contentBody}
                  onChange={(e) => setContentBody(e.target.value)}
                  placeholder="Paste HTML, Markdown, JSON, or text deliverable content..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] font-mono text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/[0.1] text-xs text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Creation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-[#11161F] border border-white/[0.1] overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-white truncate">{previewItem.title}</h3>
                <p className="text-xs text-slate-400 capitalize">
                  {previewItem.category} · {previewItem.contentType}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDownload(previewItem)}
                  className="min-h-[36px] px-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5 bg-[#0A0D12]">
              {previewItem.contentType === 'html' ? (
                <iframe
                  title={previewItem.title}
                  sandbox=""
                  srcDoc={previewItem.contentBody}
                  className="w-full h-[65vh] rounded-xl bg-white border border-white/[0.1]"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs sm:text-sm text-slate-200 leading-relaxed">
                  {previewItem.contentBody}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
