// Database schema definitions for Context Engine
// This file contains the SQL DDL for creating all required tables

export const CREATE_TABLES_SQL = `
-- Users table for token authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  auth_token TEXT UNIQUE NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active', -- active, inactive, suspended

  -- Constraints
  CONSTRAINT users_username_not_empty CHECK (length(trim(username)) > 0),
  CONSTRAINT users_auth_token_not_empty CHECK (length(trim(auth_token)) > 0),
  CONSTRAINT users_username_min_length CHECK (length(username) >= 3),
  CONSTRAINT users_auth_token_min_length CHECK (length(auth_token) >= 64)
);

-- Sessions table: Core session metadata
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  project_name VARCHAR(100) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  full_path TEXT,
  git_branch TEXT,
  git_commit TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active', -- active, archived, deleted

  -- Constraints
  CONSTRAINT sessions_user_name_project_version_unique UNIQUE (user_id, name, project_name, version),
  CONSTRAINT sessions_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT sessions_project_name_not_empty CHECK (length(trim(project_name)) > 0),
  CONSTRAINT sessions_version_positive CHECK (version > 0),
  CONSTRAINT sessions_name_min_length CHECK (length(name) >= 1),
  CONSTRAINT sessions_project_name_min_length CHECK (length(project_name) >= 1)
);

-- Files table: File content per session
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL, -- SHA-256 hash
  line_count INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0, -- bytes
  language TEXT, -- javascript, typescript, python, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT files_session_path_unique UNIQUE (session_id, path),
  CONSTRAINT files_path_not_empty CHECK (length(trim(path)) > 0),
  CONSTRAINT files_line_count_non_negative CHECK (line_count >= 0),
  CONSTRAINT files_file_size_non_negative CHECK (file_size >= 0),
  CONSTRAINT files_content_hash_valid CHECK (length(content_hash) = 64),
  CONSTRAINT files_path_max_length CHECK (length(path) <= 500)
);

-- Conversations table: Message history
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  ai_model TEXT, -- claude-code, cursor, codex, chatgpt, etc.
  message_order INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT conversations_session_order_unique UNIQUE (session_id, message_order),
  CONSTRAINT conversations_content_not_empty CHECK (length(trim(content)) > 0),
  CONSTRAINT conversations_message_order_non_negative CHECK (message_order >= 0),
  CONSTRAINT conversations_token_count_non_negative CHECK (token_count >= 0)
);

-- Summaries table: Old version summaries
CREATE TABLE IF NOT EXISTS summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  previous_version INTEGER NOT NULL,
  summary TEXT NOT NULL,
  summary_type TEXT DEFAULT 'version_upgrade', -- version_upgrade, archival, cleanup
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'auto', -- auto, manual

  -- Constraints
  CONSTRAINT summaries_summary_not_empty CHECK (length(trim(summary)) > 0),
  CONSTRAINT summaries_previous_version_positive CHECK (previous_version > 0),
  CONSTRAINT summaries_summary_type_valid CHECK (summary_type IN ('version_upgrade', 'archival', 'cleanup'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_auth_token ON users(auth_token);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_name_project ON sessions(name, project_name);
CREATE INDEX IF NOT EXISTS idx_sessions_project_name_created ON sessions(project_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_full_path ON sessions(full_path);

CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id_created ON conversations(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_session_order ON conversations(session_id, message_order);
CREATE INDEX IF NOT EXISTS idx_conversations_ai_model ON conversations(ai_model);
CREATE INDEX IF NOT EXISTS idx_conversations_role ON conversations(role);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_summaries_session_id ON summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_summaries_previous_version ON summaries(previous_version);
CREATE INDEX IF NOT EXISTS idx_summaries_created_at ON summaries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_type ON summaries(summary_type);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to automatically update last_accessed timestamp
CREATE OR REPLACE FUNCTION update_last_accessed_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_accessed = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_sessions_last_accessed
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_last_accessed_column();
`;

// Note: PostgreSQL 17 has built-in UUID generation with gen_random_uuid()
// pg_trgm extension for fuzzy matching needs to be installed manually if needed
export const ADD_EXTENSIONS_SQL = `
-- No extensions needed - using built-in functions
SELECT 1 as extensions_ready;
`;

// Create GIN indexes for fuzzy search
export const ADD_PERFORMANCE_INDEXES_SQL = `
-- Create basic indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
CREATE INDEX IF NOT EXISTS idx_sessions_project_name ON sessions(project_name);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id_created ON conversations(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_session_order ON conversations(session_id, message_order);
CREATE INDEX IF NOT EXISTS idx_conversations_ai_model ON conversations(ai_model);
CREATE INDEX IF NOT EXISTS idx_conversations_role ON conversations(role);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- Create partial indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, project_name, name, version) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_files_active ON files(session_id, path);
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations(session_id, message_order);
`;

// Sample data for development
export const SEED_DATA_SQL = `
-- Insert default user for development
-- NOTE: This is development seed data with a known token.
-- In production, tokens should be generated dynamically and hashed.
INSERT INTO users (username, auth_token, email) VALUES
('demo-user', 'ce-dev-12345678901234567890', 'demo@context-engine.dev')
ON CONFLICT (username) DO NOTHING;

-- Get the user ID for demo data
DO $$
DECLARE
    user_id UUID;
    session_id UUID;
BEGIN
    SELECT id INTO user_id FROM users WHERE username = 'demo-user';

    IF user_id IS NOT NULL THEN
        -- Insert sample session
        INSERT INTO sessions (user_id, name, project_name, version, metadata) VALUES
        (user_id, 'getting-started', 'context-engine', 1,
         '{"description": "Initial setup session", "tags": ["setup", "tutorial"], "difficulty": "beginner"}')
        ON CONFLICT (user_id, name, project_name, version) DO NOTHING;

        -- Get the session ID
        SELECT id INTO session_id FROM sessions WHERE user_id = user_id AND name = 'getting-started' AND project_name = 'context-engine';

        IF session_id IS NOT NULL THEN
            -- Insert sample file
            INSERT INTO files (session_id, path, content, content_hash, line_count, language) VALUES
            (session_id, 'README.md', '# Context Engine\n\nA persistent memory system for AI coding tools.\n\n## Features\n- Session persistence\n- Cross-platform compatibility\n- Version management\n- Fuzzy search',
             'context-engine-readme-hash-v1', 12, 'markdown')
            ON CONFLICT (session_id, path) DO NOTHING;

            -- Insert another sample file
            INSERT INTO files (session_id, path, content, content_hash, line_count, language) VALUES
            (session_id, 'src/index.ts', 'import express from "express";\n\nconst app = express();\nconst port = 3000;\n\napp.get("/", (req, res) => {\n  res.json({ message: "Context Engine API" });\n});\n\napp.listen(port, () => {\n  console.log("Server running on port " || port);\n});',
             'context-engine-index-hash-v1', 13, 'typescript')
            ON CONFLICT (session_id, path) DO NOTHING;

            -- Insert sample conversation
            INSERT INTO conversations (session_id, role, content, message_order, ai_model) VALUES
            (session_id, 'user', 'Help me set up the context engine MCP server', 1, 'claude-code'),
            (session_id, 'assistant', 'I''ll help you set up the context engine MCP server. Let me start by creating the project structure and database schema.', 2, 'claude-code'),
            (session_id, 'user', 'Great! Can you also help me understand how to use it with different AI tools?', 3, 'claude-code'),
            (session_id, 'assistant', 'Absolutely! The context engine works with any MCP-compatible AI tool like Claude Code, Cursor, or Codex. It provides persistent memory across different platforms.', 4, 'claude-code')
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;
END $$;
`;

// Health check query
export const HEALTH_CHECK_SQL = `
SELECT
    'healthy' as status,
    NOW() as timestamp,
    version() as postgres_version,
    (SELECT COUNT(*) FROM users WHERE status = 'active') as active_users,
    (SELECT COUNT(*) FROM sessions WHERE status = 'active') as active_sessions,
    (SELECT COUNT(*) FROM files) as total_files,
    (SELECT COUNT(*) FROM conversations) as total_conversations,
    (SELECT COUNT(*) FROM summaries) as total_summaries,
    (SELECT pg_size_pretty(pg_total_relation_size('sessions'))) as sessions_size,
    (SELECT pg_size_pretty(pg_total_relation_size('files'))) as files_size,
    (SELECT pg_size_pretty(pg_total_relation_size('conversations'))) as conversations_size,
    (SELECT pg_size_pretty(pg_total_relation_size('summaries'))) as summaries_size
FROM pg_database WHERE datname = current_database();
`;

// Statistics query
export const STATISTICS_SQL = `
SELECT
    (SELECT COUNT(*) FROM users WHERE status = 'active') as active_users,
    (SELECT COUNT(*) FROM sessions WHERE status = 'active') as active_sessions,
    (SELECT COUNT(*) FROM files) as total_files,
    (SELECT COUNT(*) FROM conversations) as total_conversations,
    (SELECT COUNT(*) FROM summaries) as total_summaries,
    (SELECT AVG(line_count) FROM files) as avg_file_lines,
    (SELECT AVG(token_count) FROM conversations WHERE token_count > 0) as avg_tokens_per_message,
    (SELECT MAX(created_at) FROM sessions) as latest_session,
    (SELECT name FROM sessions ORDER BY created_at DESC LIMIT 1) as latest_session_name,
    (SELECT COUNT(DISTINCT project_name) FROM sessions) as unique_projects,
    (SELECT COUNT(DISTINCT ai_model) FROM conversations WHERE ai_model IS NOT NULL) as ai_models_used
`;

// Fuzzy search query helper
export const FUZZY_SEARCH_SQL = `
-- Function for fuzzy session search
CREATE OR REPLACE FUNCTION search_sessions_fuzzy(search_term TEXT, project_filter TEXT DEFAULT NULL, user_filter UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    username TEXT,
    name VARCHAR(100),
    project_name VARCHAR(100),
    version INTEGER,
    full_path TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    last_accessed TIMESTAMP WITH TIME ZONE,
    relevance_score FLOAT,
    file_count INTEGER,
    message_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.user_id,
        u.username,
        s.name,
        s.project_name,
        s.version,
        s.full_path,
        s.metadata,
        s.created_at,
        s.updated_at,
        s.last_accessed,
        CASE
            WHEN s.name ILIKE '%' || search_term || '%' THEN 1.0
            WHEN s.name ILIKE search_term || '%' THEN 0.8
            WHEN s.name ILIKE '%' || search_term THEN 0.6
            ELSE 0.3
        END * CASE
            WHEN project_filter IS NULL THEN 1.0
            WHEN s.project_name ILIKE '%' || project_filter || '%' THEN 1.0
            ELSE 0.5
        END * CASE
            WHEN user_filter IS NULL THEN 1.0
            WHEN s.user_id = user_filter THEN 1.0
            ELSE 0.0
        END as relevance_score,
        (SELECT COUNT(*) FROM files WHERE session_id = s.id) as file_count,
        (SELECT COUNT(*) FROM conversations WHERE session_id = s.id) as message_count
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE
        s.status = 'active'
        AND (search_term IS NULL OR s.name ILIKE '%' || search_term || '%')
        AND (project_filter IS NULL OR s.project_name ILIKE '%' || project_filter || '%')
        AND (user_filter IS NULL OR s.user_id = user_filter)
    ORDER BY relevance_score DESC, s.last_accessed DESC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql;
`;

// Cleanup old data query (for future maintenance)
export const CLEANUP_OLD_DATA_SQL = `
-- Archive sessions older than 90 days with no recent activity
UPDATE sessions
SET status = 'archived'
WHERE updated_at < NOW() - INTERVAL '90 days'
AND status = 'active'
AND id NOT IN (
    SELECT DISTINCT session_id FROM (
        SELECT session_id, MAX(created_at) as last_activity
        FROM conversations
        GROUP BY session_id
        UNION
        SELECT session_id, MAX(created_at) as last_activity
        FROM files
        GROUP BY session_id
    ) recent_activity
WHERE last_activity >= NOW() - INTERVAL '30 days'
);

-- Delete archived sessions older than 180 days
DELETE FROM sessions
WHERE status = 'archived'
AND updated_at < NOW() - INTERVAL '180 days';

-- Delete summaries older than 365 days
DELETE FROM summaries
WHERE created_at < NOW() - INTERVAL '365 days';

-- Delete inactive users (no activity for 1 year)
UPDATE users
SET status = 'inactive'
WHERE last_active < NOW() - INTERVAL '1 year'
AND status = 'active';
`;

// Session statistics query
export const SESSION_STATS_SQL = `
-- Get detailed statistics for a specific session
SELECT
    s.id,
    s.name,
    s.project_name,
    s.version,
    s.full_path,
    s.created_at,
    s.updated_at,
    s.last_accessed,
    s.metadata,
    u.username,
    (SELECT COUNT(*) FROM files WHERE session_id = s.id) as file_count,
    (SELECT SUM(line_count) FROM files WHERE session_id = s.id) as total_lines,
    (SELECT SUM(file_size) FROM files WHERE session_id = s.id) as total_file_size,
    (SELECT COUNT(*) FROM conversations WHERE session_id = s.id) as message_count,
    (SELECT SUM(token_count) FROM conversations WHERE session_id = s.id) as total_tokens,
    (SELECT COUNT(DISTINCT ai_model) FROM conversations WHERE session_id = s.id AND ai_model IS NOT NULL) as ai_models_used,
    (SELECT content FROM conversations WHERE session_id = s.id ORDER BY message_order ASC LIMIT 1) as first_message,
    (SELECT content FROM conversations WHERE session_id = s.id ORDER BY message_order DESC LIMIT 1) as last_message,
    (SELECT summary FROM summaries WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as latest_summary
FROM sessions s
JOIN users u ON s.user_id = u.id
WHERE s.id = $1;
`;

// New Smart Project Context Management tables
export const CREATE_PROJECT_CONTEXTS_SQL = `
-- Project contexts table: Stores persistent project context
CREATE TABLE IF NOT EXISTS project_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_name VARCHAR(100) NOT NULL,
  description TEXT,
  tech_stack JSONB DEFAULT '{}', -- Frameworks, libraries, tools
  project_type VARCHAR(50), -- web-app, cli-tool, api-service, library, etc.
  programming_languages JSONB DEFAULT '[]', -- Array of primary languages
  build_system VARCHAR(50), -- npm, yarn, pnpm, make, cargo, etc.
  test_framework VARCHAR(50), -- jest, vitest, pytest, etc.
  git_url TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_modified_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  context_hash VARCHAR(64), -- Hash of tech stack for change detection

  -- Constraints
  CONSTRAINT project_contexts_user_project_unique UNIQUE (user_id, project_name),
  CONSTRAINT project_contexts_project_name_not_empty CHECK (length(trim(project_name)) > 0),
  CONSTRAINT project_contexts_project_type_valid CHECK (project_type IN ('web-app', 'cli-tool', 'api-service', 'library', 'mobile-app', 'desktop-app', 'other')),
  CONSTRAINT project_contexts_context_hash_valid CHECK (context_hash IS NULL OR length(context_hash) = 64)
);
`;

export const CREATE_PROJECT_CONTEXT_SNAPSHOTS_SQL = `
-- Project context snapshots table: Versioned snapshots of project state
CREATE TABLE IF NOT EXISTS project_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_context_id UUID NOT NULL REFERENCES project_contexts(id) ON DELETE CASCADE,
  snapshot_version INTEGER NOT NULL,
  file_tree JSONB NOT NULL DEFAULT '{}', -- Structure of all files
  key_files JSONB DEFAULT '[]', -- Important files (package.json, tsconfig.json, etc.)
  dependencies JSONB DEFAULT '{}', -- All dependencies from package managers
  dev_dependencies JSONB DEFAULT '{}', -- Development dependencies
  build_config JSONB DEFAULT '{}', -- Build configuration files
  environment_config JSONB DEFAULT '{}', -- Environment variables and config
  git_state JSONB DEFAULT '{}', -- Branch, commit, working directory status
  total_files INTEGER DEFAULT 0,
  total_lines INTEGER DEFAULT 0,
  estimated_complexity VARCHAR(20) DEFAULT 'low', -- low, medium, high, very-high
  snapshot_reason VARCHAR(50), -- auto, manual, tech-change, major-update
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(50) DEFAULT 'auto', -- auto, manual, system

  -- Constraints
  CONSTRAINT project_context_snapshots_context_version_unique UNIQUE (project_context_id, snapshot_version),
  CONSTRAINT project_context_snapshots_version_positive CHECK (snapshot_version > 0),
  CONSTRAINT project_context_snapshots_reason_valid CHECK (snapshot_reason IN ('auto', 'manual', 'tech-change', 'major-update', 'dependency-change')),
  CONSTRAINT project_context_snapshots_total_non_negative CHECK (total_files >= 0 AND total_lines >= 0),
  CONSTRAINT project_context_snapshots_complexity_valid CHECK (estimated_complexity IN ('low', 'medium', 'high', 'very-high'))
);
`;

// Update sessions table to reference snapshots
export const UPDATE_SESSIONS_FOR_SNAPSHOTS_SQL = `
-- Add snapshot_id foreign key to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS snapshot_id UUID REFERENCES project_context_snapshots(id) ON DELETE SET NULL;

-- Add indexes for snapshot relationships
CREATE INDEX IF NOT EXISTS idx_sessions_snapshot_id ON sessions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_project_contexts_user_id ON project_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_project_contexts_project_name ON project_contexts(project_name);
CREATE INDEX IF NOT EXISTS idx_project_contexts_active ON project_contexts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_project_contexts_modified ON project_contexts(last_modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_context_snapshots_context_id ON project_context_snapshots(project_context_id);
CREATE INDEX IF NOT EXISTS idx_project_context_snapshots_created ON project_context_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_context_snapshots_version ON project_context_snapshots(project_context_id, snapshot_version);
`;

// Trigger for automatic snapshot creation
export const CREATE_SNAPSHOT_TRIGGER_SQL = `
-- Function to detect tech stack changes and create snapshots
CREATE OR REPLACE FUNCTION detect_tech_stack_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_project_context UUID;
    current_snapshot_version INTEGER;
    should_create_snapshot BOOLEAN := false;
    snapshot_reason VARCHAR(50) := 'auto';
BEGIN
    -- Find or create project context for this session
    SELECT id INTO current_project_context
    FROM project_contexts
    WHERE user_id = NEW.user_id AND project_name = NEW.project_name AND is_active = true;

    -- If no project context exists, create one
    IF current_project_context IS NULL THEN
        INSERT INTO project_contexts (user_id, project_name, description)
        VALUES (NEW.user_id, NEW.project_name, 'Auto-detected project context')
        RETURNING id INTO current_project_context;

        should_create_snapshot := true;
        snapshot_reason := 'auto';
    END IF;

    -- Get current snapshot version
    SELECT COALESCE(MAX(snapshot_version), 0) INTO current_snapshot_version
    FROM project_context_snapshots
    WHERE project_context_id = current_project_context;

    -- Check if we should create a new snapshot (simplified logic for now)
    -- In a full implementation, this would analyze files for tech stack changes
    IF should_create_snapshot OR (current_snapshot_version = 0) THEN
        INSERT INTO project_context_snapshots (
            project_context_id,
            snapshot_version,
            file_tree,
            key_files,
            snapshot_reason
        ) VALUES (
            current_project_context,
            current_snapshot_version + 1,
            '{}', -- Would be populated with actual file tree analysis
            '[]', -- Would be populated with key files detection
            snapshot_reason
        ) RETURNING id INTO NEW.snapshot_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic snapshot creation on new sessions
CREATE OR REPLACE TRIGGER create_snapshot_on_new_session
    BEFORE INSERT ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION detect_tech_stack_changes();
`;

// Combined migration for all new tables
export const CREATE_SMART_CONTEXT_TABLES_SQL = `
-- Project contexts table: Stores persistent project context
CREATE TABLE IF NOT EXISTS project_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_name VARCHAR(100) NOT NULL,
  description TEXT,
  tech_stack JSONB DEFAULT '{}', -- Frameworks, libraries, tools
  project_type VARCHAR(50), -- web-app, cli-tool, api-service, library, etc.
  programming_languages JSONB DEFAULT '[]', -- Array of primary languages
  build_system VARCHAR(50), -- npm, yarn, pnpm, make, cargo, etc.
  test_framework VARCHAR(50), -- jest, vitest, pytest, etc.
  git_url TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_modified_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  context_hash VARCHAR(64), -- Hash of tech stack for change detection

  -- Constraints
  CONSTRAINT project_contexts_user_project_unique UNIQUE (user_id, project_name),
  CONSTRAINT project_contexts_project_name_not_empty CHECK (length(trim(project_name)) > 0),
  CONSTRAINT project_contexts_project_type_valid CHECK (project_type IN ('web-app', 'cli-tool', 'api-service', 'library', 'mobile-app', 'desktop-app', 'other')),
  CONSTRAINT project_contexts_context_hash_valid CHECK (context_hash IS NULL OR length(context_hash) = 64)
);

-- Project context snapshots table: Versioned snapshots of project state
CREATE TABLE IF NOT EXISTS project_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_context_id UUID NOT NULL REFERENCES project_contexts(id) ON DELETE CASCADE,
  snapshot_version INTEGER NOT NULL,
  file_tree JSONB NOT NULL DEFAULT '{}', -- Structure of all files
  key_files JSONB DEFAULT '[]', -- Important files (package.json, tsconfig.json, etc.)
  dependencies JSONB DEFAULT '{}', -- All dependencies from package managers
  dev_dependencies JSONB DEFAULT '{}', -- Development dependencies
  build_config JSONB DEFAULT '{}', -- Build configuration files
  environment_config JSONB DEFAULT '{}', -- Environment variables and config
  git_state JSONB DEFAULT '{}', -- Branch, commit, working directory status
  total_files INTEGER DEFAULT 0,
  total_lines INTEGER DEFAULT 0,
  estimated_complexity VARCHAR(20) DEFAULT 'low', -- low, medium, high, very-high
  snapshot_reason VARCHAR(50), -- auto, manual, tech-change, major-update
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(50) DEFAULT 'auto', -- auto, manual, system

  -- Constraints
  CONSTRAINT project_context_snapshots_context_version_unique UNIQUE (project_context_id, snapshot_version),
  CONSTRAINT project_context_snapshots_version_positive CHECK (snapshot_version > 0),
  CONSTRAINT project_context_snapshots_reason_valid CHECK (snapshot_reason IN ('auto', 'manual', 'tech-change', 'major-update', 'dependency-change')),
  CONSTRAINT project_context_snapshots_total_non_negative CHECK (total_files >= 0 AND total_lines >= 0),
  CONSTRAINT project_context_snapshots_complexity_valid CHECK (estimated_complexity IN ('low', 'medium', 'high', 'very-high'))
);

-- Add snapshot_id foreign key to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS snapshot_id UUID REFERENCES project_context_snapshots(id) ON DELETE SET NULL;

-- Add indexes for snapshot relationships
CREATE INDEX IF NOT EXISTS idx_sessions_snapshot_id ON sessions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_project_contexts_user_id ON project_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_project_contexts_project_name ON project_contexts(project_name);
CREATE INDEX IF NOT EXISTS idx_project_contexts_active ON project_contexts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_project_contexts_modified ON project_contexts(last_modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_context_snapshots_context_id ON project_context_snapshots(project_context_id);
CREATE INDEX IF NOT EXISTS idx_project_context_snapshots_created ON project_context_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_context_snapshots_version ON project_context_snapshots(project_context_id, snapshot_version);

-- Function to detect tech stack changes and create snapshots
CREATE OR REPLACE FUNCTION detect_tech_stack_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_project_context UUID;
    current_snapshot_version INTEGER;
    should_create_snapshot BOOLEAN := false;
    snapshot_reason VARCHAR(50) := 'auto';
BEGIN
    -- Find or create project context for this session
    SELECT id INTO current_project_context
    FROM project_contexts
    WHERE user_id = NEW.user_id AND project_name = NEW.project_name AND is_active = true;

    -- If no project context exists, create one
    IF current_project_context IS NULL THEN
        INSERT INTO project_contexts (user_id, project_name, description)
        VALUES (NEW.user_id, NEW.project_name, 'Auto-detected project context')
        RETURNING id INTO current_project_context;

        should_create_snapshot := true;
        snapshot_reason := 'auto';
    END IF;

    -- Get current snapshot version
    SELECT COALESCE(MAX(snapshot_version), 0) INTO current_snapshot_version
    FROM project_context_snapshots
    WHERE project_context_id = current_project_context;

    -- Check if we should create a new snapshot (simplified logic for now)
    -- In a full implementation, this would analyze files for tech stack changes
    IF should_create_snapshot OR (current_snapshot_version = 0) THEN
        INSERT INTO project_context_snapshots (
            project_context_id,
            snapshot_version,
            file_tree,
            key_files,
            snapshot_reason
        ) VALUES (
            current_project_context,
            current_snapshot_version + 1,
            '{}', -- Would be populated with actual file tree analysis
            '[]', -- Would be populated with key files detection
            snapshot_reason
        ) RETURNING id INTO NEW.snapshot_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic snapshot creation on new sessions
CREATE OR REPLACE TRIGGER create_snapshot_on_new_session
    BEFORE INSERT ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION detect_tech_stack_changes();
`;