import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { ProjectRecord, UserRole, VentureRecord, VentureStatus } from '../../shared/types.ts';
import { StatusText } from '../components/StatusText.tsx';
import { api, ApiError, formatTimestamp } from '../lib/api.ts';

interface FoundryViewProps {
  userRole: UserRole;
  onNavigateToCreations: () => void;
}

const VENTURE_STAGES: Array<{ id: VentureStatus; label: string }> = [
  { id: 'idea_generated', label: 'Idea Generated' },
  { id: 'research_completed', label: 'Research Completed' },
  { id: 'blueprint_created', label: 'Blueprint Created' },
  { id: 'product_developed', label: 'Product Developed' },
  { id: 'product_deployed', label: 'Product Deployed' },
  { id: 'business_operational', label: 'Operational' },
];

export function FoundryView({ userRole, onNavigateToCreations }: FoundryViewProps) {
  const [ventures, setVentures] = useState<VentureRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Natural-language primary builder
  const [ideaPrompt, setIdeaPrompt] = useState('');
  const [naturalProjectId, setNaturalProjectId] = useState('');
  const [generatingNatural, setGeneratingNatural] = useState(false);

  // Manual modal fallback
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [targetMarket, setTargetMarket] = useState('');
  const [productType, setProductType] = useState('');
  const [revenueModel, setRevenueModel] = useState('');
  const [constraints, setConstraints] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);

  const [synthesizingId, setSynthesizingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [buildPrototypeOnApprove, setBuildPrototypeOnApprove] = useState(true);
  const [selectedVenture, setSelectedVenture] = useState<VentureRecord | null>(null);

  const canMutate = userRole === 'owner' || userRole === 'operator';

  async function loadAll() {
    setError(null);
    try {
      const [vRes, pRes] = await Promise.all([api.foundry.list(), api.projects.list()]);
      setVentures(vRes.ventures);
      setProjects(pRes.projects.filter((p) => p.status !== 'archived'));
      if (vRes.ventures.length > 0 && !selectedVenture) {
        setSelectedVenture(vRes.ventures[0]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load Business Foundry ventures.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleNaturalGenerate(e: FormEvent) {
    e.preventDefault();
    if (!ideaPrompt.trim() || !canMutate) return;
    setGeneratingNatural(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.foundry.createNatural({
        idea: ideaPrompt.trim(),
        projectId: naturalProjectId || null,
      });
      setIdeaPrompt('');
      setVentures((prev) => [res.venture, ...prev]);
      setSelectedVenture(res.venture);
      setNotice('Venture structured specification & Markdown blueprint generated and saved to My Creations.');
      const pRes = await api.projects.list();
      setProjects(pRes.projects.filter((p) => p.status !== 'archived'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate venture from natural language.');
    } finally {
      setGeneratingNatural(false);
    }
  }

  async function handleManualCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.foundry.create({
        name: name.trim(),
        targetMarket: targetMarket.trim(),
        productType: productType.trim(),
        revenueModel: revenueModel.trim(),
        constraints: constraints.trim(),
        projectId: projectId || null,
      });
      setVentures((prev) => [res.venture, ...prev]);
      setSelectedVenture(res.venture);
      setName('');
      setTargetMarket('');
      setProductType('');
      setRevenueModel('');
      setConstraints('');
      setShowModal(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create venture blueprint.');
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveVenture(id: string) {
    setApprovingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.foundry.approve(id, buildPrototypeOnApprove);
      setVentures((prev) => prev.map((v) => (v.id === id ? res.venture : v)));
      setSelectedVenture(res.venture);
      setNotice(
        `Blueprint approved: ${res.tasksCreated} operational tasks provisioned${
          res.prototypeCreationId ? ' and an interactive HTML MVP prototype was built by FORGE in My Creations' : ''
        }.`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve venture blueprint.');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleSynthesize(id: string) {
    setSynthesizingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.foundry.synthesize(id);
      setVentures((prev) => prev.map((v) => (v.id === id ? res.venture : v)));
      setSelectedVenture(res.venture);
      setNotice('Venture blueprint synthesized and saved to My Creations.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Synthesis failed.');
    } finally {
      setSynthesizingId(null);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await api.foundry.delete(id);
      setVentures((prev) => prev.filter((v) => v.id !== id));
      if (selectedVenture?.id === id) setSelectedVenture(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete venture.');
    }
  }

  function getStageIndex(status: VentureStatus): number {
    const idx = VENTURE_STAGES.findIndex((s) => s.id === status);
    if (idx !== -1) return idx;
    if (status === 'architected' || status === 'ready_for_phase_2') return 2;
    return 0;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">Business Foundry</h2>
          <p className="text-xs text-slate-400 mt-1">
            Describe a business idea in plain language to extract structured specs, generate a blueprint, provision tasks, and build an interactive MVP prototype.
          </p>
        </div>

        {canMutate && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="self-start sm:self-auto min-h-[40px] px-3.5 rounded-xl border border-white/[0.1] hover:bg-white/[0.05] text-slate-200 text-xs font-medium inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Manual Specification</span>
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={onNavigateToCreations}
            className="self-start sm:self-auto text-xs font-semibold underline cursor-pointer shrink-0"
          >
            View in My Creations
          </button>
        </div>
      )}

      {/* One-Box Natural-Language Venture Builder */}
      {canMutate && (
        <section className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-5 sm:p-6">
          <form onSubmit={handleNaturalGenerate} className="space-y-3">
            <label htmlFor="foundry-idea" className="block text-sm font-medium text-white">
              Describe Your Business Concept
            </label>
            <textarea
              id="foundry-idea"
              rows={3}
              required
              disabled={generatingNatural}
              value={ideaPrompt}
              onChange={(e) => setIdeaPrompt(e.target.value)}
              placeholder='Example: "I want to launch a B2B subscription platform selling automated GDPR cookie and privacy compliance kits for European Shopify stores, priced at €29/month."'
              className="w-full rounded-xl bg-[#0A0D12] border border-white/[0.1] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="w-full sm:w-64">
                <select
                  aria-label="Associate with existing project"
                  value={naturalProjectId}
                  onChange={(e) => setNaturalProjectId(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-xs text-white"
                >
                  <option value="">Auto-create linked project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      Link to: {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={generatingNatural || !ideaPrompt.trim()}
                className="min-h-[44px] px-5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" />
                <span>{generatingNatural ? 'Generating Blueprint...' : 'Extract Spec & Generate Blueprint'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <div className="h-44 rounded-2xl bg-[#11161F] border border-white/[0.06] animate-pulse" />
      ) : ventures.length === 0 ? (
        <div className="rounded-2xl bg-[#11161F] border border-white/[0.08] p-8 text-center">
          <p className="text-sm text-slate-300">No venture blueprints created yet.</p>
          <p className="text-xs text-slate-500 mt-1">
            Describe a digital product, SaaS, or service business above to generate a structured specification and blueprint.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 space-y-3">
            {ventures.map((v) => (
              <div
                key={v.id}
                className={`rounded-2xl bg-[#11161F] border p-5 space-y-3 transition-colors ${
                  selectedVenture?.id === v.id ? 'border-[#3B82F6]/50' : 'border-white/[0.08]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <StatusText status={v.status} />
                  <span className="tabular-nums">{formatTimestamp(v.updatedAt)}</span>
                </div>

                <div>
                  <h3 className="font-display text-base font-semibold text-white">{v.name}</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {v.productType || 'Digital Product'} · {v.targetMarket || 'Global'} · {v.revenueModel || 'Direct'}
                  </p>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedVenture(v)}
                      className="min-h-[38px] px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-white cursor-pointer"
                    >
                      Inspect
                    </button>
                    {canMutate && !v.blueprintMarkdown && (
                      <button
                        type="button"
                        disabled={synthesizingId === v.id}
                        onClick={() => handleSynthesize(v.id)}
                        className="min-h-[38px] px-3 rounded-lg bg-[#2563EB]/20 hover:bg-[#2563EB]/30 border border-[#3B82F6]/30 text-xs font-medium text-blue-200 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{synthesizingId === v.id ? 'Synthesizing...' : 'Synthesize Blueprint'}</span>
                      </button>
                    )}
                  </div>

                  {canMutate && (
                    <button
                      type="button"
                      aria-label={`Delete ${v.name}`}
                      onClick={() => handleDelete(v.id)}
                      className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-7 rounded-2xl bg-[#11161F] border border-white/[0.08] p-6 space-y-5">
            {!selectedVenture ? (
              <div className="text-sm text-slate-400">
                Select a venture on the left to review its lifecycle stage, structured specifications, and execution actions.
              </div>
            ) : (
              <>
                <div className="pb-4 border-b border-white/[0.08] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-lg font-semibold text-white">{selectedVenture.name}</h3>
                    <StatusText status={selectedVenture.status} />
                  </div>
                  <div className="text-xs text-slate-400">
                    {selectedVenture.projectName ? `Project: ${selectedVenture.projectName} · ` : ''}
                    Market: {selectedVenture.targetMarket || 'Unspecified'} · Model:{' '}
                    {selectedVenture.revenueModel || 'Unspecified'}
                  </div>

                  {/* Honest 6-Stage Lifecycle Indicator */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2">
                    {VENTURE_STAGES.map((stage, idx) => {
                      const activeIdx = getStageIndex(selectedVenture.status);
                      const reached = idx <= activeIdx;
                      return (
                        <div
                          key={stage.id}
                          className={`rounded-lg px-2.5 py-2 border text-[11px] ${
                            reached
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                              : 'border-white/[0.06] bg-[#0A0D12] text-slate-500'
                          }`}
                        >
                          <div className="font-mono text-[10px] opacity-75">0{idx + 1}</div>
                          <div className="truncate font-medium">{stage.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Review & Approve Action */}
                {canMutate && selectedVenture.blueprintMarkdown && (
                  <div className="rounded-xl border border-white/[0.08] bg-[#0A0D12] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-white">
                        {selectedVenture.approvedAt
                          ? `Blueprint Approved (${formatTimestamp(selectedVenture.approvedAt)})`
                          : 'Ready for Review & Approval'}
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={buildPrototypeOnApprove}
                          onChange={(e) => setBuildPrototypeOnApprove(e.target.checked)}
                          className="accent-[#2563EB]"
                        />
                        <span>Also build interactive HTML MVP prototype via FORGE</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={approvingId === selectedVenture.id}
                      onClick={() => handleApproveVenture(selectedVenture.id)}
                      className="min-h-[42px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-xs font-medium text-white inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {approvingId === selectedVenture.id
                          ? 'Provisioning & Building...'
                          : selectedVenture.approvedAt
                            ? 'Provision & Build Prototype'
                            : 'Approve & Provision Workspace'}
                      </span>
                    </button>
                  </div>
                )}

                {/* Structured Extraction Summary */}
                {selectedVenture.structuredSpec && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-[#0A0D12] border border-white/[0.06] p-3.5">
                      <div className="text-slate-400 font-medium">Target Audience</div>
                      <p className="mt-1 text-slate-200">{selectedVenture.structuredSpec.targetAudience}</p>
                    </div>
                    <div className="rounded-xl bg-[#0A0D12] border border-white/[0.06] p-3.5">
                      <div className="text-slate-400 font-medium">Market Opportunity</div>
                      <p className="mt-1 text-slate-200">{selectedVenture.structuredSpec.marketOpportunity}</p>
                    </div>
                    <div className="rounded-xl bg-[#0A0D12] border border-white/[0.06] p-3.5">
                      <div className="text-slate-400 font-medium">Growth Strategy (VANGUARD)</div>
                      <p className="mt-1 text-slate-200">{selectedVenture.structuredSpec.growthStrategy}</p>
                    </div>
                    <div className="rounded-xl bg-[#0A0D12] border border-white/[0.06] p-3.5">
                      <div className="text-slate-400 font-medium">Financial Considerations (TREASURY)</div>
                      <p className="mt-1 text-slate-200">{selectedVenture.structuredSpec.financialConsiderations}</p>
                    </div>
                  </div>
                )}

                {selectedVenture.blueprintMarkdown ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-200 leading-relaxed">
                    {selectedVenture.blueprintMarkdown}
                  </pre>
                ) : (
                  <div className="text-sm text-slate-400 space-y-2">
                    <p>No architecture document synthesized yet.</p>
                    <p className="text-xs text-slate-500">
                      Click "Synthesize Blueprint" on the venture card to generate a structured venture plan via the routed AI engine.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Manual Specification Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#11161F] border border-white/[0.1] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-white">Manual Venture Specification</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleManualCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Venture Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nordic Digital Templates Co."
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Target Market</label>
                  <input
                    type="text"
                    value={targetMarket}
                    onChange={(e) => setTargetMarket(e.target.value)}
                    placeholder="EU & North America"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Product Type</label>
                  <input
                    type="text"
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    placeholder="Downloadable SaaS kits"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Revenue Model</label>
                  <input
                    type="text"
                    value={revenueModel}
                    onChange={(e) => setRevenueModel(e.target.value)}
                    placeholder="One-time licenses + tiers"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Associate Project</label>
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
                <label className="block text-xs text-slate-300 mb-1">Operational Constraints</label>
                <textarea
                  rows={2}
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                  placeholder="VAT compliance, localization requirements, budget limits..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D12] border border-white/[0.1] text-sm text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/[0.1] text-xs font-medium text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-medium text-white cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Create Venture'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
