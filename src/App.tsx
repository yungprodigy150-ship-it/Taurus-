import { useEffect, useState } from 'react';
import type { UserProfile } from '../shared/types.ts';
import { AuthGate } from './components/AuthGate.tsx';
import { LayoutShell, type NavSectionId } from './components/LayoutShell.tsx';
import { api, setStoredSessionToken } from './lib/api.ts';
import { AgentsView } from './views/AgentsView.tsx';
import { CommandCenterView } from './views/CommandCenterView.tsx';
import { CreationsView } from './views/CreationsView.tsx';
import { FoundryView } from './views/FoundryView.tsx';
import { IntegrationsView } from './views/IntegrationsView.tsx';
import { LibraryView } from './views/LibraryView.tsx';
import { OverviewView } from './views/OverviewView.tsx';
import { ProjectsView } from './views/ProjectsView.tsx';
import { SettingsView } from './views/SettingsView.tsx';

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeSection, setActiveSection] = useState<NavSectionId>('overview');

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await api.auth.status();
        setInitialized(res.initialized);
        setUser(res.user);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    }
    void checkAuth();
  }, []);

  async function handleLogout() {
    try {
      await api.auth.logout();
    } catch {
      // Ignore logout network error
    }
    setStoredSessionToken(null);
    setUser(null);
    setInitialized(true);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0A0D12] flex items-center justify-center text-sm text-slate-400">
        Loading TAURUS Operations Platform...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthGate
        initialized={initialized}
        onAuthenticated={(u) => {
          setUser(u);
          setInitialized(true);
        }}
      />
    );
  }

  return (
    <LayoutShell
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      user={user}
      onLogout={handleLogout}
    >
      {activeSection === 'overview' && <OverviewView userRole={user.role} onNavigate={setActiveSection} />}
      {activeSection === 'command' && <CommandCenterView userRole={user.role} />}
      {activeSection === 'agents' && <AgentsView userRole={user.role} />}
      {activeSection === 'projects' && <ProjectsView userRole={user.role} />}
      {activeSection === 'foundry' && (
        <FoundryView userRole={user.role} onNavigateToCreations={() => setActiveSection('creations')} />
      )}
      {activeSection === 'creations' && <CreationsView userRole={user.role} />}
      {activeSection === 'library' && <LibraryView userRole={user.role} />}
      {activeSection === 'integrations' && <IntegrationsView userRole={user.role} />}
      {activeSection === 'settings' && <SettingsView currentUser={user} />}
    </LayoutShell>
  );
}
