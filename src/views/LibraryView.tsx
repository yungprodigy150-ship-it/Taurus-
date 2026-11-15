import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, Eye, FilePlus2, Trash2, Upload, X } from 'lucide-react';
import type { LibraryCategory, LibraryFileRecord, ProjectRecord, UserRole } from '../../shared/types.ts';
import { api, ApiError, formatBytes, formatTimestamp, getStoredSessionToken } from '../lib/api.ts';

const LIB_CATEGORIES: Array<{ id: LibraryCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All Files' },
  { id: 'source_code', label: 'Source Code' },
  { id: 'documents', label: 'Documents' },
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'business_assets', label: 'Business Assets' },
  { id: 'research', label: 'Research' },
  { id: 'project_files', label: 'Project Files' },
  { id: 'generated_materials', label: 'Generated Materials' },
];

interface LibraryViewProps {
  userRole: UserRole;
}

export function LibraryView({ userRole }: LibraryViewProps) {
  const [files, setFiles] = useState<LibraryFileRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [category, setCategory] = useState<LibraryCategory | 'all'>('all');
  const [uploadCategory, setUploadCategory] = useState<LibraryCategory>('project_files');
  const [uploadProjectId, setUploadProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showTextModal, setShowTextModal] = useState(false);
  const [textFilename, setTextFilename] = useState('');
  const [textContent, setTextContent] = useState('');
  const [textDescription, setTextDescription] = useState('');

  const [previewFile, setPreviewFile] = useState<LibraryFileRecord | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);

  const canMutate = userRole === 'owner' || userRole === 'operator';

  async function loadAll(cat: LibraryCategory | 'all' = category) {
    setError(null);
    try {
      const [fRes, pRes] = await Promise.all([api.library.list(cat), api.projects.list()]);
      setFiles(fRes.files);
      setProjects(pRes.projects.filter((p) => p.status !== 'archived'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load library files.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll(category);
  }, [category]);

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.library.uploadFile(file, {
        category: uploadCategory,
        projectId: uploadProjectId || null,
      });
      await loadAll(category);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'File upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCreateTextFile(e: FormEvent) {
    e.preventDefault();
    if (!textFilename.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await api.library.createText({
        filename: textFilename.trim(),
        content: textContent,
        category: uploadCategory,
        projectId: uploadProjectId || null,
        description: textDescription.trim(),
      });
      setTextFilename('');
      setTextContent('');
      setTextDescription('');
      setShowTextModal(false);
      await loadAll(category);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create file.');
    } finally {
      setUploading(false);
    }
  }

  async function fetchAuthenticatedBlob(fileId: string): Promise<Blob> {
    const token = getStoredSessionToken();
    const res = await fetch(`/api/library/${fileId}/content`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Failed to retrieve file (${res.status})`);
    return res.blob();
  }

  async function handlePreview(file: LibraryFileRecord) {
    setError(null);
    setPreviewFile(file);
    setPreviewText(null);
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      setPreviewObjectUrl(null);
    }

    try {
      const blob = await fetchAuthenticatedBlob(file.id);
      if (
        file.mimeType.startsWith('text/') ||
        file.mimeType === 'application/json' ||
        file.originalName.match(/\.(ts|tsx|js|jsx|md|txt|json|csv|yml|yaml|html|css|sql)$/i)
      ) {
        const text = await blob.text();
        setPreviewText(text);
      } else {
        setPreviewObjectUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview file.');
      setPreviewFile(null);
    }
  }

  async function handleDownload(file: LibraryFileRecord) {
    setError(null);
    try {
      const token = getStoredSessionToken();
      const res = await fetch(`/api/library/${file.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.originalName;
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
      await api.library.delete(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete file.');
    }
  }

  function closePreview() {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    setPreviewObjectUrl(null);
    setPreviewText(null);
    setPreviewFile(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">Persistent File Library</h2>
          <p className="text-xs text-slate-400 mt-1">
            Real server-side disk storage with SHA-256 verification, project linking, and binary retrieval.
          </p>
        </div>

        {canMutate && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Target category for uploads"
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as LibraryCategory)}
              className="h-10 px-3 rounded-xl bg-[#11161F] border border-white/[0.1] text-xs text-white"
            >
              {LIB_CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Link upload to project"
              value={uploadProjectId}
              onChange={(e) => setUploadProjectId(e.target.value)}
              className="h-10 px-3 rounded-xl bg-[#11161F] border border-white/[0.1] text-xs text-white"
            >
              <option value="">No Project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              <span>{uploading ? 'Uploading...' : 'Upload File'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTextModal(true)}
              className="min-h-[40px] px-3.5 rounded-xl border border-white/[0.1] hover:bg-white/[0.05] text-xs font-medium text-slate-200 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>New Text / Code</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {LIB_CATEGORIES.map((cat) => (
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
      ) : files.length === 0 ? (
        <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-8 text-center">
          <p className="text-sm text-slate-300">No files stored in this category.</p>
          <p className="text-xs text-slate-500 mt-1">
            Upload files up to 25 MB or create persistent source code and research documents.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
          {files.map((file) => (
            <div key={file.id} className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{file.originalName}</div>
                <div className="mt-1 text-xs text-slate-400 flex flex-wrap items-center gap-2">
                  <span>{file.category.replace(/_/g, ' ')}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{formatBytes(file.sizeBytes)}</span>
                  {file.projectName && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{file.projectName}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{formatTimestamp(file.createdAt)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handlePreview(file)}
                  className="min-h-[36px] px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>View</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(file)}
                  className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                {canMutate && (
                  <button
                    type="button"
                    aria-label={`Delete ${file.originalName}`}
                    onClick={() => handleDelete(file.id)}
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

      {/* Create Text/Code Modal */}
      {showTextModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[#11161F] border border-white/[0.1] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-white">Create Persistent File</h3>
              <button
                type="button"
                onClick={() => setShowTextModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTextFile} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Filename (with extension)</label>
                <input
                  type="text"
                  required
                  value={textFilename}
                  onChange={(e) => setTextFilename(e.target.value)}
                  placeholder="market-research-notes.md"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Description</label>
                <input
                  type="text"
                  value={textDescription}
                  onChange={(e) => setTextDescription(e.target.value)}
                  placeholder="Optional note"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">File Content</label>
                <textarea
                  rows={8}
                  required
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Enter source code, research notes, or configuration..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] font-mono text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTextModal(false)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/[0.1] text-xs text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                >
                  {uploading ? 'Saving...' : 'Save to Library'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* File Content Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-[#11161F] border border-white/[0.1] overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-white truncate">{previewFile.originalName}</h3>
                <p className="text-xs font-mono text-slate-400 truncate">
                  {previewFile.mimeType} · {formatBytes(previewFile.sizeBytes)} · SHA-256 {previewFile.sha256.slice(0, 12)}...
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5 bg-[#0A0D12]">
              {previewText !== null ? (
                <pre className="whitespace-pre-wrap font-mono text-xs sm:text-sm text-slate-200 leading-relaxed">
                  {previewText}
                </pre>
              ) : previewObjectUrl && previewFile.mimeType.startsWith('image/') ? (
                <img
                  src={previewObjectUrl}
                  alt={previewFile.originalName}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[65vh] mx-auto rounded-lg"
                />
              ) : previewObjectUrl && previewFile.mimeType.startsWith('video/') ? (
                <video src={previewObjectUrl} controls className="max-w-full max-h-[65vh] mx-auto rounded-lg" />
              ) : (
                <div className="text-sm text-slate-400">
                  Binary preview is not available for {previewFile.mimeType}. Use Download to retrieve the stored file.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
