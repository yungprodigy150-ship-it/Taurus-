import { useState, type ReactNode } from 'react';
import {
  Activity,
  Bot,
  Briefcase,
  FolderKanban,
  FolderOpen,
  Layers,
  LogOut,
  Menu,
  Plug,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import type { UserProfile } from '../../shared/types.ts';

export type NavSectionId =
  | 'overview'
  | 'command'
  | 'agents'
  | 'projects'
  | 'foundry'
  | 'creations'
  | 'library'
  | 'integrations'
  | 'settings';

export interface NavItem {
  id: NavSectionId;
  label: string;
  shortLabel: string;
  icon: typeof Activity;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: Activity },
  { id: 'command', label: 'Command Center', shortLabel: 'Command', icon: Terminal },
  { id: 'agents', label: 'Agents', shortLabel: 'Agents', icon: Bot },
  { id: 'projects', label: 'Projects', shortLabel: 'Projects', icon: FolderKanban },
  { id: 'foundry', label: 'Business Foundry', shortLabel: 'Foundry', icon: Briefcase },
  { id: 'creations', label: 'My Creations', shortLabel: 'Creations', icon: Layers },
  { id: 'library', label: 'Library', shortLabel: 'Library', icon: FolderOpen },
  { id: 'integrations', label: 'Integrations', shortLabel: 'Connect', icon: Plug },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

interface LayoutShellProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  user: UserProfile;
  onLogout: () => void;
  children: ReactNode;
}

export function LayoutShell({
  activeSection,
  onSelectSection,
  user,
  onLogout,
  children,
}: LayoutShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeItem = NAV_ITEMS.find((i) => i.id === activeSection) || NAV_ITEMS[0];
  const mobilePrimaryTabs = NAV_ITEMS.filter((item) =>
    ['overview', 'command', 'projects', 'foundry'].includes(item.id)
  );

  function handleNavigate(id: NavSectionId) {
    onSelectSection(id);
    setDrawerOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#0A0D12] text-[#F1F5F9] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-white/[0.08] bg-[#0D1118]">
        <div className="h-14 px-5 flex items-center border-b border-white/[0.08]">
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            Taurus
          </span>
        </div>

        <nav aria-label="Primary sections" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full min-h-[42px] px-3 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#2563EB]/15 text-white border border-[#3B82F6]/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#3B82F6]' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/[0.08]">
          <div className="mb-3">
            <div className="text-sm font-medium text-white truncate">{user.name}</div>
            <div className="text-xs text-slate-400 truncate">
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)} · {user.email}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[40px] px-3 rounded-xl border border-white/[0.08] hover:bg-white/[0.04] text-xs font-medium text-slate-300 flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact Top Bar (Mobile + Desktop) */}
        <header className="sticky top-0 z-30 h-13 lg:h-14 px-4 lg:px-8 bg-[#0A0D12]/90 backdrop-blur-md border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              Taurus
            </span>
            <span className="lg:hidden text-slate-600" aria-hidden="true">
              /
            </span>
            <h1 className="font-display text-sm lg:text-base font-semibold text-slate-100 truncate">
              {activeItem.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeSection !== 'command' && (
              <button
                type="button"
                onClick={() => handleNavigate('command')}
                className="min-h-[38px] px-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                New Directive
              </button>
            )}
            <button
              type="button"
              aria-label="Open all navigation sections"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden min-h-[44px] min-w-[44px] -mr-2 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/[0.05] cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 px-4 py-5 pb-24 lg:px-8 lg:py-7 lg:pb-10 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Thumb Navigation */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-15 bg-[#0D1118]/95 backdrop-blur-md border-t border-white/[0.08] grid grid-cols-5 items-center px-1"
      >
        {mobilePrimaryTabs.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavigate(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors cursor-pointer ${
                isActive ? 'text-[#3B82F6]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium tracking-tight">{item.shortLabel}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors cursor-pointer ${
            ['agents', 'creations', 'library', 'integrations', 'settings'].includes(activeSection)
              ? 'text-[#3B82F6]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight">More</span>
        </button>
      </nav>

      {/* Mobile Slide-Over / Bottom Sheet Full Navigation Drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-xs">
          <div className="bg-[#11161F] border-t border-white/[0.1] rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
            <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-display text-base font-semibold text-white">Taurus Navigation</div>
                <div className="text-xs text-slate-400">
                  {user.name} · {user.role}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setDrawerOpen(false)}
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`min-h-[46px] px-4 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[#2563EB]/15 text-white border border-[#3B82F6]/30'
                        : 'text-slate-300 hover:bg-white/[0.04] border border-transparent'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-[#3B82F6]' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="mt-5 w-full min-h-[44px] rounded-xl border border-white/[0.1] text-sm font-medium text-slate-300 hover:bg-white/[0.04] flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
