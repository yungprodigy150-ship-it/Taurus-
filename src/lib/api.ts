import type {
  AgentRecord,
  CommandRecord,
  CreationCategory,
  CreationContentType,
  CreationRecord,
  DivisionCode,
  ExecutionLogRecord,
  IntegrationProviderKey,
  IntegrationRecord,
  LibraryCategory,
  LibraryFileRecord,
  OverviewPayload,
  ProjectRecord,
  ProjectStatus,
  TaskRecord,
  UserProfile,
  UserRole,
  VentureRecord,
} from '../../shared/types.ts';

const TOKEN_STORAGE_KEY = 'taurus_session_token';

export function getStoredSessionToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Fallback to status message
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export const api = {
  auth: {
    status: () => apiFetch<{ initialized: boolean; authenticated: boolean; user: UserProfile | null }>('/api/auth/status'),
    setup: (body: { name: string; email: string; password: string }) =>
      apiFetch<{ user: UserProfile; sessionToken: string }>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    login: (body: { email: string; password: string }) =>
      apiFetch<{ user: UserProfile; sessionToken: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    users: () => apiFetch<{ users: UserProfile[] }>('/api/auth/users'),
    createUser: (body: { name: string; email: string; password: string; role: UserRole }) =>
      apiFetch<{ user: UserProfile }>('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateUserRole: (id: string, role: UserRole) =>
      apiFetch<{ ok: boolean }>(`/api/auth/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
  },

  overview: {
    get: () => apiFetch<OverviewPayload>('/api/overview'),
  },

  commands: {
    list: (projectId?: string) =>
      apiFetch<{ commands: CommandRecord[] }>(
        projectId ? `/api/commands?projectId=${encodeURIComponent(projectId)}` : '/api/commands'
      ),
    submit: (body: {
      prompt: string;
      projectId?: string | null;
      assignedAgentId?: string | null;
      runAiIntake?: boolean;
    }) =>
      apiFetch<{ command: CommandRecord }>('/api/commands', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    analyze: (id: string) =>
      apiFetch<{ command: CommandRecord }>(`/api/commands/${id}/analyze`, { method: 'POST' }),
    update: (
      id: string,
      body: {
        status?: CommandRecord['status'];
        progressPercent?: number;
        progressStage?: string;
        projectId?: string | null;
        assignedAgentId?: string | null;
      }
    ) =>
      apiFetch<{ command: CommandRecord }>(`/api/commands/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    tasks: (commandId: string) => apiFetch<{ tasks: TaskRecord[] }>(`/api/commands/${commandId}/tasks`),
    decideTask: (taskId: string, decision: 'approve' | 'reject' | 'complete', notes?: string) =>
      apiFetch<{ ok: boolean; status: string }>(`/api/commands/tasks/${taskId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, notes }),
      }),
  },

  agents: {
    list: () => apiFetch<{ agents: AgentRecord[] }>('/api/agents'),
    details: (id: string) =>
      apiFetch<{ agent: AgentRecord; tasks: TaskRecord[]; history: ExecutionLogRecord[] }>(`/api/agents/${id}/details`),
    create: (body: {
      name: string;
      division: DivisionCode;
      description: string;
      responsibilities: string;
      modelProvider?: string;
      modelName?: string;
      status?: AgentRecord['status'];
    }) =>
      apiFetch<{ agent: AgentRecord }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      body: Partial<{
        name: string;
        description: string;
        responsibilities: string;
        modelProvider: string;
        modelName: string;
        status: AgentRecord['status'];
      }>
    ) =>
      apiFetch<{ agent: AgentRecord }>(`/api/agents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    assignTask: (
      agentId: string,
      body: {
        title: string;
        description?: string;
        projectId?: string | null;
        priority?: TaskRecord['priority'];
        requiresApproval?: boolean;
      }
    ) =>
      apiFetch<{ taskId: string; status: string }>(`/api/agents/${agentId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => apiFetch<{ ok: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
  },

  projects: {
    list: () => apiFetch<{ projects: ProjectRecord[] }>('/api/projects'),
    create: (body: { name: string; description: string; category: string }) =>
      apiFetch<{ project: ProjectRecord }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      body: Partial<{ name: string; description: string; category: string; status: ProjectStatus }>
    ) =>
      apiFetch<{ project: ProjectRecord }>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    history: (id: string) =>
      apiFetch<{
        commands: Array<{ id: string; prompt: string; status: string; progressPercent: number; createdAt: string }>;
        tasks: Array<{ id: string; title: string; status: string; division: string | null; priority: string; createdAt: string }>;
        creations: Array<{ id: string; title: string; category: string; status: string; createdAt: string }>;
        files: Array<{ id: string; originalName: string; category: string; sizeBytes: number; createdAt: string }>;
      }>(`/api/projects/${id}/history`),
  },

  foundry: {
    list: () => apiFetch<{ ventures: VentureRecord[] }>('/api/foundry'),
    create: (body: {
      name: string;
      targetMarket: string;
      productType: string;
      revenueModel: string;
      constraints: string;
      projectId?: string | null;
      blueprintMarkdown?: string;
    }) =>
      apiFetch<{ venture: VentureRecord }>('/api/foundry', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    synthesize: (id: string) =>
      apiFetch<{ venture: VentureRecord; creationId: string }>(`/api/foundry/${id}/synthesize`, {
        method: 'POST',
      }),
    delete: (id: string) => apiFetch<{ ok: boolean }>(`/api/foundry/${id}`, { method: 'DELETE' }),
  },

  creations: {
    list: (category?: CreationCategory | 'all') =>
      apiFetch<{ creations: CreationRecord[] }>(
        category && category !== 'all' ? `/api/creations?category=${encodeURIComponent(category)}` : '/api/creations'
      ),
    create: (body: {
      title: string;
      category: CreationCategory;
      description: string;
      projectId?: string | null;
      contentType: CreationContentType;
      contentBody: string;
    }) =>
      apiFetch<{ creation: CreationRecord }>('/api/creations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => apiFetch<{ ok: boolean }>(`/api/creations/${id}`, { method: 'DELETE' }),
  },

  library: {
    list: (category?: LibraryCategory | 'all') =>
      apiFetch<{ files: LibraryFileRecord[] }>(
        category && category !== 'all' ? `/api/library?category=${encodeURIComponent(category)}` : '/api/library'
      ),
    uploadFile: async (
      file: File,
      meta: { category: LibraryCategory; projectId?: string | null; description?: string }
    ): Promise<LibraryFileRecord> => {
      const token = getStoredSessionToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Category': meta.category,
        'X-File-Mime': file.type || 'application/octet-stream',
      };
      if (meta.projectId) headers['X-Project-Id'] = meta.projectId;
      if (meta.description) headers['X-File-Description'] = encodeURIComponent(meta.description);
      if (token) headers.Authorization = `Bearer ${token}`;

      const buf = await file.arrayBuffer();
      const res = await fetch('/api/library/upload', {
        method: 'POST',
        headers,
        body: buf,
        credentials: 'include',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(data.error || `Upload failed (${res.status})`, res.status);
      }
      const data = (await res.json()) as { file: LibraryFileRecord };
      return data.file;
    },
    createText: (body: {
      filename: string;
      content: string;
      category: LibraryCategory;
      projectId?: string | null;
      description?: string;
    }) =>
      apiFetch<{ file: LibraryFileRecord }>('/api/library/text', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => apiFetch<{ ok: boolean }>(`/api/library/${id}`, { method: 'DELETE' }),
  },

  integrations: {
    list: () => apiFetch<{ integrations: IntegrationRecord[] }>('/api/integrations'),
    configure: (providerKey: IntegrationProviderKey, body: { credential?: string | null; config?: Record<string, string> }) =>
      apiFetch<{ integration: IntegrationRecord }>(`/api/integrations/${providerKey}/configure`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    clearCredentials: (providerKey: IntegrationProviderKey) =>
      apiFetch<{ integration: IntegrationRecord }>(`/api/integrations/${providerKey}/credentials`, {
        method: 'DELETE',
      }),
    test: (providerKey: IntegrationProviderKey) =>
      apiFetch<{ integration: IntegrationRecord }>(`/api/integrations/${providerKey}/test`, {
        method: 'POST',
      }),
  },

  settings: {
    get: () =>
      apiFetch<{
        policy: {
          requireApprovalForExternalActions?: boolean;
          defaultIntakeMode?: string;
          platformPhase?: string;
          executionEngineReady?: boolean;
        };
        policyUpdatedAt: string | null;
        infrastructure: {
          nodeVersion: string;
          databaseEngine: string;
          databaseSizeBytes: number;
          storageDirectory: string;
          storageFileCount: number;
          storageTotalBytes: number;
          encryptionAlgorithm: string;
        };
        logs: Array<{
          id: string;
          level: string;
          subsystem: string;
          action: string;
          message: string;
          actor_name: string | null;
          created_at: string;
        }>;
      }>('/api/settings'),
    updatePolicy: (body: { requireApprovalForExternalActions?: boolean; defaultIntakeMode?: string }) =>
      apiFetch<{ policy: Record<string, unknown>; updatedAt: string }>('/api/settings/policy', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
