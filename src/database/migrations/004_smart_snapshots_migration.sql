-- Smart Project Context Snapshots Migration
-- Based on updates.md implementation guide

-- Check and update project_context_snapshots table structure
DO $$
BEGIN
    -- Check if project_context_snapshots table exists with correct structure
    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'project_context_snapshots'
    ) THEN
        -- Add missing columns if they don't exist
        IF NOT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'project_context_snapshots'
            AND column_name = 'git_branch'
        ) THEN
            ALTER TABLE project_context_snapshots ADD COLUMN git_branch VARCHAR(100);
        END IF;

        IF NOT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'project_context_snapshots'
            AND column_name = 'change_reason'
        ) THEN
            ALTER TABLE project_context_snapshots ADD COLUMN change_reason TEXT;
        END IF;

        -- Update column types if needed
        IF EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'project_context_snapshots'
            AND column_name = 'snapshot_version'
        ) THEN
            -- Ensure version column is correct type
            ALTER TABLE project_context_snapshots ALTER COLUMN snapshot_version TYPE INTEGER;
        END IF;
    ELSE
        -- Create project_context_snapshots table from scratch
        CREATE TABLE project_context_snapshots (
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
    END IF;
END $$;

-- Add snapshot_version to sessions table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'sessions'
        AND column_name = 'snapshot_version'
    ) THEN
        ALTER TABLE sessions ADD COLUMN snapshot_version INTEGER DEFAULT 1;
    END IF;
END $$;

-- Create or update indexes
CREATE INDEX IF NOT EXISTS idx_snapshots_project_version
ON project_context_snapshots(project_context_id, version);

CREATE INDEX IF NOT EXISTS idx_sessions_snapshot
ON sessions(project_context_id, snapshot_version);

-- Create function to update project_contexts.last_modified_at
CREATE OR REPLACE FUNCTION update_project_modified_time()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE project_contexts
    SET last_modified_at = NOW()
    WHERE id = NEW.project_context_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updating project modified time
DROP TRIGGER IF EXISTS trigger_update_project_modified ON project_context_snapshots;
CREATE TRIGGER trigger_update_project_modified
AFTER INSERT ON project_context_snapshots
FOR EACH ROW
EXECUTE FUNCTION update_project_modified_time();

-- Add constraints for data integrity
ALTER TABLE project_context_snapshots
ADD CONSTRAINT IF NOT EXISTS snapshot_version_positive
CHECK (version > 0);

-- Update existing sessions to have snapshot_version = 1 if null
UPDATE sessions
SET snapshot_version = 1
WHERE snapshot_version IS NULL;