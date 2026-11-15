export type UserRole = 'owner' | 'operator' | 'viewer';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export type DivisionCode =
  | 'COMMAND'
  | 'FORGE'
  | 'VANGUARD'
  | 'SENTRY'
  | 'ATLAS'
  | 'NEXUS'
  | 'TREASURY';

export type AgentStatus = 'standby' | 'configured' | 'active' | 'disabled';
export type AgentRuntimeMode = 'architecture_only' | 'intake_assisted' | 'autonomous_pending';

export interface AgentRecord {
  id: string;
  name: string;
  division: DivisionCode;
  description: string;
  responsibilities: string;
  modelProvider: string;
  modelName: string;
  status: AgentStatus;
  runtimeMode: AgentRuntimeMode;
  capabilities: string[];
  config: Record<string, unknown>;
  assignedTaskCount?: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  status: ProjectStatus;
  ownerId: string;
  ownerName?: string;
  commandCount?: number;
  taskCount?: number;
  creationCount?: number;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type CommandStatus =
  | 'queued'
  | 'analyzing'
  | 'planned'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CommandPlanStep {
  title: string;
  division: DivisionCode;
  phaseAvailability: 'phase_1_planned' | 'phase_2_required';
  requiresApproval: boolean;
  rationale: string;
}

export interface CommandRecord {
  id: string;
  prompt: string;
  projectId: string | null;
  projectName?: string | null;
  assignedAgentId: string | null;
  assignedDivision: DivisionCode | null;
  status: CommandStatus;
  progressPercent: number;
  progressStage: string;
  executionNote: string;
  planSteps: CommandPlanStep[];
  errorMessage: string | null;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'failed';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  projectName?: string | null;
  commandId: string | null;
  agentId: string | null;
  agentName?: string | null;
  division: DivisionCode | null;
  status: TaskStatus;
  priority: TaskPriority;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  resultNotes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type VentureStatus = 'draft' | 'architected' | 'ready_for_phase_2';

export interface VentureRecord {
  id: string;
  name: string;
  targetMarket: string;
  productType: string;
  revenueModel: string;
  constraints: string;
  projectId: string | null;
  projectName?: string | null;
  status: VentureStatus;
  blueprintMarkdown: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CreationCategory =
  | 'website'
  | 'application'
  | 'business'
  | 'document'
  | 'design'
  | 'media'
  | 'other';

export type CreationContentType = 'html' | 'markdown' | 'json' | 'text' | 'file';

export interface CreationRecord {
  id: string;
  title: string;
  category: CreationCategory;
  description: string;
  projectId: string | null;
  projectName?: string | null;
  commandId: string | null;
  contentType: CreationContentType;
  contentBody: string;
  libraryFileId: string | null;
  status: 'draft' | 'ready' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type LibraryCategory =
  | 'source_code'
  | 'documents'
  | 'images'
  | 'videos'
  | 'business_assets'
  | 'research'
  | 'project_files'
  | 'generated_materials';

export interface LibraryFileRecord {
  id: string;
  originalName: string;
  category: LibraryCategory;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  projectId: string | null;
  projectName?: string | null;
  description: string;
  uploadedBy: string;
  uploadedByName?: string;
  createdAt: string;
}

export type IntegrationProviderKey =
  | 'google_gemini'
  | 'groq'
  | 'openai'
  | 'github'
  | 'email_services'
  | 'browser_automation'
  | 'external_apis';

export type ConnectionStatus =
  | 'not_configured'
  | 'configured_untested'
  | 'connected'
  | 'error';

export interface IntegrationRecord {
  id: string;
  providerKey: IntegrationProviderKey;
  displayName: string;
  category: 'ai_provider' | 'developer' | 'messaging' | 'automation' | 'api';
  authType: 'env_secret' | 'encrypted_token' | 'endpoint_config';
  connectionStatus: ConnectionStatus;
  hasCredential: boolean;
  credentialSource: 'environment' | 'encrypted_vault' | 'none';
  config: Record<string, string>;
  accountLabel: string | null;
  lastTestedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  updatedAt: string;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface ExecutionLogRecord {
  id: string;
  level: LogLevel;
  subsystem: string;
  action: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface OverviewPayload {
  systemStatus: {
    health: 'operational' | 'degraded';
    databaseConnected: boolean;
    storageAvailable: boolean;
    verifiedProviders: number;
    phaseLabel: string;
  };
  metrics: {
    activeAgents: number;
    totalAgents: number;
    runningTasks: number;
    completedTasks: number;
    activeProjects: number;
    connectedAiProviders: number;
    pendingApprovals: number;
    totalCommands: number;
    totalCreations: number;
    totalLibraryFiles: number;
  };
  pendingApprovals: TaskRecord[];
  recentActivity: ExecutionLogRecord[];
}
