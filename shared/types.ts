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
export type AgentRuntimeMode =
  | 'architecture_only'
  | 'intake_assisted'
  | 'ai_orchestrated'
  | 'autonomous_pending';

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
  completedTaskCount?: number;
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
  | 'clarification_needed'
  | 'awaiting_approval'
  | 'running'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CommandPlanStep {
  title: string;
  division: DivisionCode;
  taskCategory: TaskCategory;
  complexity: TaskComplexity;
  phaseAvailability: 'phase_1_planned' | 'phase_2_executable' | 'requires_external_integration';
  requiresApproval: boolean;
  rationale: string;
  externalActionType?: 'github_create_repo' | 'send_email' | 'browser_navigate' | null;
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
  clarificationQuestions?: string[];
  latestRunId?: string | null;
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
export type TaskCategory =
  | 'planning'
  | 'research'
  | 'strategy'
  | 'coding'
  | 'financial'
  | 'monitoring'
  | 'integration'
  | 'general';
export type TaskComplexity = 'low' | 'medium' | 'high';

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

export type VentureStatus =
  | 'idea_generated'
  | 'research_completed'
  | 'blueprint_created'
  | 'product_developed'
  | 'product_deployed'
  | 'business_operational'
  // Preserve Phase 1 legacy values safely
  | 'draft'
  | 'architected'
  | 'ready_for_phase_2';

export interface VentureStructuredSpec {
  businessConcept: string;
  targetAudience: string;
  marketOpportunity: string;
  productRequirements: string[];
  revenueModel: string;
  operationalRequirements: string[];
  initialDevelopmentTasks: Array<{ title: string; division: DivisionCode; description: string }>;
  growthStrategy: string;
  financialConsiderations: string;
}

export interface VentureRecord {
  id: string;
  name: string;
  sourceIdea?: string;
  targetMarket: string;
  productType: string;
  revenueModel: string;
  constraints: string;
  projectId: string | null;
  projectName?: string | null;
  status: VentureStatus;
  blueprintMarkdown: string;
  structuredSpec?: VentureStructuredSpec | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
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
  executionRunId?: string | null;
  contentType: CreationContentType;
  contentBody: string;
  libraryFileId: string | null;
  deployedUrl?: string | null;
  isInteractive?: boolean;
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

export type AiProviderKey = 'google_gemini' | 'groq' | 'openai';

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
  discoveredModels?: string[];
  accountLabel: string | null;
  lastTestedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  updatedAt: string;
}

export interface RoutingPolicy {
  preferredProvider: AiProviderKey | 'auto';
  fallbackOrder: AiProviderKey[];
  preferCostEfficiency: boolean;
  tierModels: {
    fast: Partial<Record<AiProviderKey, string>>;
    reasoning: Partial<Record<AiProviderKey, string>>;
    coding: Partial<Record<AiProviderKey, string>>;
  };
}

export type ExecutionRunStatus =
  | 'planning'
  | 'clarification_needed'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type ExecutionStepStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'waiting_ai'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface ExecutionStepRecord {
  id: string;
  runId: string;
  stepIndex: number;
  division: DivisionCode;
  agentId: string | null;
  agentName?: string | null;
  taskId: string | null;
  title: string;
  objective: string;
  taskCategory: TaskCategory;
  complexity: TaskComplexity;
  providerKey: string | null;
  modelName: string | null;
  routingReason: string | null;
  status: ExecutionStepStatus;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  inputSummary: string;
  outputSummary: string;
  outputCreationId: string | null;
  outputFileId: string | null;
  tokensUsed: number;
  latencyMs: number | null;
  retryCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExecutionRunRecord {
  id: string;
  commandId: string;
  projectId: string | null;
  originalInstruction: string;
  interpretedObjective: string;
  assignedDivisions: DivisionCode[];
  currentStage: string;
  status: ExecutionRunStatus;
  finalReport: string | null;
  remainingWork: string | null;
  errorMessage: string | null;
  totalTokens: number;
  retryCount: number;
  startedAt: string;
  completedAt: string | null;
  createdBy: string;
  steps: ExecutionStepRecord[];
}

export interface AiExecutionAuditRecord {
  id: string;
  runId: string | null;
  stepId: string | null;
  division: string;
  taskCategory: string;
  complexity: string;
  providerKey: string;
  modelName: string;
  routingReason: string;
  fallbackUsed: boolean;
  status: 'success' | 'error';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  errorMessage: string | null;
  createdAt: string;
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
    storageDurability: 'local_container_disk';
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
    totalExecutionRuns: number;
  };
  pendingApprovals: TaskRecord[];
  recentRuns: ExecutionRunRecord[];
  recentActivity: ExecutionLogRecord[];
}
