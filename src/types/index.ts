// Core type definitions for Context Engine MCP Server

// Database Models
export interface Session {
  id: string;
  name: string;
  project_name: string;
  version: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  user_id: string;
  snapshot_id?: string;
  full_path?: string;
  last_accessed: Date;
}

export interface File {
  id: string;
  session_id: string;
  path: string;
  content: string;
  content_hash: string;
  line_count: number;
  file_size: number;
  language?: string;
  created_at: Date;
}

export interface Conversation {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ai_model?: string;
  message_order: number;
  token_count?: number;
  created_at: Date;
}

export interface Summary {
  id: string;
  session_id: string;
  file_id?: string;
  summary: string;
  original_version: number;
  created_at: Date;
}

// Smart Project Context Management Models
export interface ProjectContext {
  id: string;
  user_id: string;
  project_name: string;
  description?: string;
  tech_stack: Record<string, unknown>;
  project_type: 'web-app' | 'cli-tool' | 'api-service' | 'library' | 'mobile-app' | 'desktop-app' | 'other';
  programming_languages: string[];
  build_system?: string;
  test_framework?: string;
  git_url?: string;
  first_seen_at: Date;
  last_modified_at: Date;
  is_active: boolean;
  context_hash?: string;
}

export interface ProjectContextSnapshot {
  id: string;
  project_context_id: string;
  snapshot_version: number;
  file_tree: Record<string, unknown>;
  key_files: Array<{
    path: string;
    type: string;
    content?: string;
  }>;
  dependencies: Record<string, unknown>;
  dev_dependencies: Record<string, unknown>;
  build_config: Record<string, unknown>;
  environment_config: Record<string, unknown>;
  git_state: Record<string, unknown>;
  total_files: number;
  total_lines: number;
  estimated_complexity: 'low' | 'medium' | 'high' | 'very-high';
  snapshot_reason: 'auto' | 'manual' | 'tech-change' | 'major-update' | 'dependency-change';
  created_at: Date;
  created_by: 'auto' | 'manual' | 'system';
}

export interface User {
  id: string;
  username: string;
  api_key: string;
  email?: string;
  created_at: Date;
  last_active: Date;
  status: 'active' | 'inactive' | 'suspended';
}

// MCP Tool Types
export interface SaveContextInput {
  session_name: string;
  project_name: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  conversation: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  metadata?: Record<string, unknown>;
  auth_token: string;
  user_id?: string; // Added after authentication
}

export interface ResumeContextInput {
  session_name: string;
  project_name?: string;
  file_path?: string;
  auth_token: string;
  user_id?: string; // Added after authentication
}

export interface ListContextsInput {
  project_name?: string;
  file_path?: string;
  limit?: number;
  offset?: number;
  auth_token: string;
  user_id?: string; // Added after authentication
}

export interface SaveContextOutput {
  session_id: string;
  status: 'saved' | 'versioned';
  message: string;
  version?: number;
  project_context_id?: string;
}

export interface ResumeContextOutput {
  session_id: string;
  session_name: string;
  project_name: string;
  version: number;
  files: Array<{
    path: string;
    content: string;
  }>;
  conversation: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  metadata: Record<string, unknown>;
  summaries?: Array<{
    file_path: string;
    summary: string;
  }>;
}

export interface AmbiguousMatch {
  session_id: string;
  session_name: string;
  project_name: string;
  version: number;
  files: Array<string>;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ListContextsOutput {
  sessions: Array<{
    session_id: string;
    session_name: string;
    project_name: string;
    version: number;
    files: Array<string>;
    created_at: string;
    updated_at: string;
  }>;
  total: number;
  limit: number;
  offset: number;
}

// Error Types
export interface ContextEngineError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  alternatives?: string[];
}

// Database Connection
export interface DatabaseConfig {
  url: string;
  poolSize: number;
  timeout: number;
}

// Server Configuration
export interface ServerConfig {
  port: number;
  host: string;
  environment: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableHttps: boolean;
  httpsKeyPath?: string;
  httpsCertPath?: string;
  trustProxy: boolean;
  trustProxyIps: string[];
}

// Feature Flags
export interface FeatureFlags {
  enableSessionVersioning: boolean;
  enableFuzzyMatching: boolean;
  enableFileValidation: boolean;
  enableAutoSummarization: boolean;
  enableInputValidation: boolean;
  enableRateLimiting: boolean;
}

// Validation Limits
export interface ValidationLimits {
  maxFileSizeKB: number;
  maxSessionTokens: number;
  maxConcurrentOperations: number;
  allowedFileTypes: string[];
  maxLinesPerFile: number;
}

// MCP Configuration
export interface MCPConfig {
  transport: 'stdio' | 'http' | 'both';
  version: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}
