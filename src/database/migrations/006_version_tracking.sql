-- Version Tracking Migration for Backward Compatibility
-- Prepares database for future smart snapshots without breaking existing data

-- Add version columns to sessions table (backward compatible)
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS api_version VARCHAR(10) DEFAULT '0.1.0',
  ADD COLUMN IF NOT EXISTS snapshot_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS project_context_id UUID REFERENCES project_contexts(id) ON DELETE SET NULL;

-- Create project_contexts table for future use (doesn't affect existing data)
CREATE TABLE IF NOT EXISTS project_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_name VARCHAR(255) NOT NULL,
  description TEXT,
  project_type VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_modified_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_project UNIQUE(user_id, project_name)
);

-- Create project_context_snapshots table for future smart snapshots
CREATE TABLE IF NOT EXISTS project_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_context_id UUID NOT NULL REFERENCES project_contexts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  tech_stack JSONB NOT NULL,
  programming_languages JSONB DEFAULT '[]',
  project_type VARCHAR(50),
  git_branch VARCHAR(100),
  change_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_project_snapshot_version UNIQUE(project_context_id, version)
);

-- Create feedback table for user feedback collection
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255),  -- Optional, for logged-in users
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  feature_request TEXT,
  email VARCHAR(255),  -- Optional, for follow-up
  api_version VARCHAR(10) DEFAULT '0.1.0',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_api_version ON sessions(api_version);
CREATE INDEX IF NOT EXISTS idx_sessions_project_context ON sessions(project_context_id);
CREATE INDEX IF NOT EXISTS idx_sessions_snapshot ON sessions(project_context_id, snapshot_version);
CREATE INDEX IF NOT EXISTS idx_project_contexts_user ON project_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_version ON project_context_snapshots(project_context_id, version);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);

-- Set default values for existing sessions
UPDATE sessions
SET api_version = '0.1.0'
WHERE api_version IS NULL;

UPDATE sessions
SET snapshot_version = 1
WHERE snapshot_version IS NULL;

-- Add comment to document migration
COMMENT ON TABLE sessions IS 'Core sessions table with version tracking for backward compatibility';
COMMENT ON TABLE project_contexts IS 'Project context metadata for smart organization';
COMMENT ON TABLE project_context_snapshots IS 'Tech stack snapshots for version tracking';
COMMENT ON TABLE feedback IS 'User feedback collection for continuous improvement';