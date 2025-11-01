import type {
  Session,
  File,
  Conversation,
  SaveContextInput,
  SaveContextOutput,
  ResumeContextInput,
  ResumeContextOutput,
  AmbiguousMatch,
  ListContextsInput,
  ListContextsOutput,
  ProjectContext,
  User,
} from '@/types';
import { createDatabaseLogger } from '@/utils/logger';
import type { DatabaseConnection } from '@/database/connection';
import { ProjectManager } from './project-manager.js';

const businessLogger = createDatabaseLogger();

type SessionWithContextRow = Session & {
  project_context_id: string | null;
  pc_project_name: string | null;
  pc_tech_stack: Record<string, unknown> | null;
  pc_languages: string[] | null;
  pc_type: string | null;
  snapshot_file_tree: Record<string, unknown> | null;
  snapshot_dependencies: Record<string, unknown> | null;
  snapshot_version: number | null;
};

export class SessionManager {
  private projectManager: ProjectManager;

  constructor(private db: DatabaseConnection) {
    this.projectManager = new ProjectManager(db);
  }

  async saveSession(input: SaveContextInput, userId?: string): Promise<SaveContextOutput> {
    const normalizedFiles = input.files && input.files.length > 0
      ? input.files
      : [this.createSyntheticFile(input)];
    const filesWereSynthetic = !input.files || input.files.length === 0;

    businessLogger.info('Saving session with 3-layer context', {
      sessionName: input.session_name,
      projectName: input.project_name,
      fileCount: normalizedFiles.length,
      conversationLength: input.conversation.length,
      userId: userId || 'anonymous',
      syntheticFilesAdded: filesWereSynthetic,
    });

    return await this.db.transaction(async (client) => {
      // Step 1: Create or update project context
      let projectContext: ProjectContext | null = null;
      let snapshotReason: 'auto' | 'manual' | 'tech-change' | 'major-update' | 'dependency-change' = 'auto';
      let snapshotId: string | null = null;

      if (userId && input.project_name) {
        // Get existing project context to detect changes
        const existingContext = await this.projectManager.getProjectContext(userId, input.project_name);

        // Detect current tech stack
        const currentTechInfo = await this.projectManager.detectTechStack(normalizedFiles);
        const currentContextHash = this.projectManager.calculateContextHash(currentTechInfo.tech_stack);

        // Determine if this is a significant change
        if (existingContext && existingContext.context_hash !== currentContextHash) {
          snapshotReason = 'tech-change';
          businessLogger.info('Tech stack change detected', {
            projectName: input.project_name,
            oldHash: existingContext.context_hash,
            newHash: currentContextHash,
          });
        }

        // Create or update project context
        projectContext = await this.projectManager.createOrUpdateProjectContext(
          userId,
          input.project_name,
          normalizedFiles,
          input.metadata?.description as string
        );

        // Create project snapshot
        const snapshot = await this.projectManager.createSnapshot(
          projectContext.id,
          normalizedFiles,
          snapshotReason
        );
        snapshotId = snapshot.id;
      }

      // Step 2: Check if session already exists and determine version
      if (!userId) {
        throw new Error('User authentication required for session saving');
      }

      const versionResult = await client.query(
        `SELECT MAX(version) as max_version
         FROM sessions
         WHERE user_id = $1
           AND name = $2
           AND project_name = $3`,
        [userId, input.session_name, input.project_name]
      );

      const currentVersion = versionResult.rows[0]?.max_version || 0;
      const newVersion = currentVersion + 1;

      businessLogger.info('Session version determined', {
        sessionName: input.session_name,
        projectName: input.project_name,
        currentVersion,
        newVersion,
        projectContextId: projectContext?.id,
      });

      // Step 3: Insert session with project context reference and user_id
      const sessionResult = await client.query(
        `INSERT INTO sessions (user_id, name, project_name, version, metadata, snapshot_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [
          userId, // CRITICAL: Store user_id to enforce data isolation
          input.session_name,
          input.project_name,
          newVersion,
          JSON.stringify({
            ...input.metadata,
            project_context_id: projectContext?.id,
            tech_stack_detected: !!projectContext,
            snapshot_reason: snapshotReason,
            snapshot_id: snapshotId,
            synthetic_files_added: filesWereSynthetic,
          }),
          snapshotId,
        ]
      );

      const sessionId = sessionResult.rows[0].id;

      // Step 4: Insert files (now linked to project context)
      for (const file of normalizedFiles) {
        const contentHash = this.calculateContentHash(file.content);
        const lineCount = file.content.split('\n').length;

        await client.query(
          `INSERT INTO files (session_id, path, content, content_hash, line_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, file.path, file.content, contentHash, lineCount]
        );
      }

      // Step 5: Insert conversation
      for (const [index, message] of input.conversation.entries()) {
        await client.query(
          `INSERT INTO conversations (session_id, role, content, created_at)
           VALUES ($1, $2, $3, NOW() - INTERVAL '${(input.conversation.length - index) * 1} seconds')`,
          [sessionId, message.role, message.content]
        );
      }

      businessLogger.info('Session saved successfully with 3-layer context', {
        sessionId,
        sessionName: input.session_name,
        projectName: input.project_name,
        version: newVersion,
        fileCount: normalizedFiles.length,
        conversationLength: input.conversation.length,
        projectContextId: projectContext?.id,
        snapshotReason,
        syntheticFilesAdded: filesWereSynthetic,
      });

      return {
        session_id: sessionId,
        status: currentVersion > 0 ? 'versioned' : 'saved',
        message: currentVersion > 0
          ? `Session saved as ${input.session_name}-${newVersion}`
          : `Session saved as ${input.session_name}`,
        version: newVersion,
        project_context_id: projectContext?.id,
      };
    });
  }

  async resumeSession(input: ResumeContextInput, userId?: string): Promise<ResumeContextOutput | { matches: AmbiguousMatch[] }> {
    businessLogger.info('Resuming session', {
      sessionName: input.session_name,
      projectName: input.project_name,
      filePath: input.file_path,
      userId: userId || 'anonymous',
    });

    if (!userId) {
      throw new Error('User authentication required for session access');
    }

    // Try to find exact match first with user scoping
    const exactMatches = await this.db.query<Session>(
      `SELECT * FROM sessions
       WHERE user_id = $1
       AND name = $2
       AND ($3::text IS NULL OR project_name = $3)
       ORDER BY version DESC`,
      [userId, input.session_name, input.project_name]
    );

    if (exactMatches.length === 0) {
      // Try fuzzy matching with user scoping
      return await this.fuzzySearchSessions(input, userId);
    }

    if (exactMatches.length > 1 && !input.project_name) {
      // Multiple matches without project specification - return options
      const matches: AmbiguousMatch[] = exactMatches.map(session => ({
        session_id: session.id,
        session_name: session.name,
        project_name: session.project_name,
        version: session.version,
        files: [], // Will be populated if needed
        created_at: session.created_at.toISOString(),
        metadata: session.metadata,
      }));

      businessLogger.info('Multiple matches found', {
        sessionName: input.session_name,
        matchCount: matches.length,
      });

      return { matches };
    }

    // Single match found - retrieve full session data
    const session = exactMatches[0];
    if (!session) {
      throw new Error('Session not found');
    }
    return await this.retrieveFullSession(session.id, input.file_path);
  }

  async listSessions(input: ListContextsInput, userId?: string): Promise<ListContextsOutput> {
    businessLogger.info('Listing sessions', {
      projectName: input.project_name,
      filePath: input.file_path,
      limit: input.limit,
      offset: input.offset,
      userId: userId || 'anonymous',
    });

    if (!userId) {
      throw new Error('User authentication required for session listing');
    }

    let whereClause = 'WHERE s.user_id = $1';
    const params: unknown[] = [userId];
    let paramIndex = 2;

    if (input.project_name) {
      whereClause += ` AND s.project_name ILIKE $${paramIndex}`;
      params.push(`%${input.project_name}%`);
      paramIndex++;
    }

    if (input.file_path) {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM files f WHERE f.session_id = s.id AND f.path ILIKE $${paramIndex}
      )`;
      params.push(`%${input.file_path}%`);
      paramIndex++;
    }

    const query = `
      SELECT
        s.id as session_id,
        s.name as session_name,
        s.project_name,
        s.version,
        s.created_at,
        s.updated_at,
        ARRAY_AGG(DISTINCT f.path) FILTER (WHERE f.path IS NOT NULL) as files
      FROM sessions s
      LEFT JOIN files f ON s.id = f.session_id
      ${whereClause}
      GROUP BY s.id, s.name, s.project_name, s.version, s.created_at, s.updated_at
      ORDER BY s.updated_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(input.limit, input.offset);

    const sessions = await this.db.query<{
      session_id: string;
      session_name: string;
      project_name: string;
      version: number;
      files: string[];
      created_at: Date;
      updated_at: Date;
    }>(query, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT s.id) as total
      FROM sessions s
      LEFT JOIN files f ON s.id = f.session_id
      ${whereClause}
    `;

    const countResult = await this.db.query<{ total: number }>(
      countQuery,
      params.slice(0, -2) // Remove limit and offset
    );

    const total = countResult[0]?.total || 0;

    businessLogger.info('Sessions listed', {
      returnedCount: sessions.length,
      totalCount: total,
      limit: input.limit,
      offset: input.offset,
    });

    return {
      sessions: sessions.map(session => ({
        session_id: session.session_id,
        session_name: session.session_name,
        project_name: session.project_name,
        version: session.version,
        files: session.files.filter(Boolean), // Remove null values
        created_at: session.created_at.toISOString(),
        updated_at: session.updated_at.toISOString(),
      })),
      total,
      limit: input.limit || 20,
      offset: input.offset || 0,
    };
  }

  private async fuzzySearchSessions(input: ResumeContextInput, userId: string): Promise<{ matches: AmbiguousMatch[] }> {
    businessLogger.info('Performing fuzzy search', {
      sessionName: input.session_name,
      projectName: input.project_name,
      userId: userId,
    });

    if (!userId) {
      throw new Error('User authentication required for fuzzy search');
    }

    const searchPattern = `%${input.session_name}%`;
    let whereClause = 'WHERE s.user_id = $1 AND s.name ILIKE $2';
    const params: unknown[] = [userId, searchPattern];

    if (input.project_name) {
      whereClause += ' AND s.project_name ILIKE $3';
      params.push(`%${input.project_name}%`);
    }

    const query = `
      SELECT
        s.id,
        s.name,
        s.project_name,
        s.version,
        s.created_at,
        s.metadata,
        ARRAY_AGG(DISTINCT f.path) FILTER (WHERE f.path IS NOT NULL) as files
      FROM sessions s
      LEFT JOIN files f ON s.id = f.session_id
      ${whereClause}
      GROUP BY s.id, s.name, s.project_name, s.version, s.created_at, s.metadata
      ORDER BY s.updated_at DESC
      LIMIT 10
    `;

    const results = await this.db.query<{
      id: string;
      name: string;
      project_name: string;
      version: number;
      created_at: Date;
      metadata: Record<string, unknown>;
      files: string[];
    }>(query, params);

    const matches: AmbiguousMatch[] = results.map(result => ({
      session_id: result.id,
      session_name: result.name,
      project_name: result.project_name,
      version: result.version,
      files: result.files.filter(Boolean),
      created_at: result.created_at.toISOString(),
      metadata: result.metadata,
    }));

    businessLogger.info('Fuzzy search completed', {
      searchTerm: input.session_name,
      matchCount: matches.length,
    });

    return { matches };
  }

  private async retrieveFullSession(sessionId: string, filePath?: string): Promise<ResumeContextOutput> {
    businessLogger.info('Retrieving full session with project context', { sessionId, filePath });

    // Get session details with project context
    const sessionResult = await this.db.query<SessionWithContextRow>(
      `SELECT s.*,
              pc.id as project_context_id,
              pc.project_name as pc_project_name,
              pc.tech_stack as pc_tech_stack,
              pc.programming_languages as pc_languages,
              pc.project_type as pc_type,
              pcs.file_tree as snapshot_file_tree,
              pcs.dependencies as snapshot_dependencies,
              pcs.snapshot_version as snapshot_version
       FROM sessions s
       LEFT JOIN project_contexts pc ON s.snapshot_id = pc.id
       LEFT JOIN project_context_snapshots pcs ON pc.id = pcs.project_context_id
         AND pcs.snapshot_version = (
           SELECT MAX(snapshot_version)
           FROM project_context_snapshots
           WHERE project_context_id = pc.id
         )
       WHERE s.id = $1`,
      [sessionId]
    );

    if (sessionResult.length === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const session = sessionResult[0]!;

    // Get files (with optional path filter)
    let filesQuery = 'SELECT * FROM files WHERE session_id = $1';
    const filesParams: unknown[] = [sessionId];

    if (filePath) {
      filesQuery += ' AND path = $2';
      filesParams.push(filePath);
    }

    filesQuery += ' ORDER BY path';

    const filesResult = await this.db.query<File>(filesQuery, filesParams);

    // Get conversation
    const conversationResult = await this.db.query<Conversation>(
      'SELECT * FROM conversations WHERE session_id = $1 ORDER BY created_at',
      [sessionId]
    );

    // Get summaries if any
    const summariesResult = await this.db.query<{
      file_id: string;
      summary: string;
    }>(
      `SELECT fs.file_id, s.summary
       FROM summaries s
       LEFT JOIN files fs ON s.file_id = fs.id
       WHERE s.session_id = $1`,
      [sessionId]
    );

    // Build project context info if available
    let projectContext = undefined;
    if (session.project_context_id) {
      const parsedTechStack = session.pc_tech_stack ?? {};
      const parsedLanguages = session.pc_languages ?? [];
      const parsedSnapshotTree = session.snapshot_file_tree ?? {};
      const parsedSnapshotDeps = session.snapshot_dependencies ?? {};
      projectContext = {
        id: session.project_context_id,
        project_name: session.pc_project_name || session.project_name,
        tech_stack: parsedTechStack,
        programming_languages: parsedLanguages,
        project_type: session.pc_type || 'other',
        snapshot: {
          file_tree: parsedSnapshotTree,
          dependencies: parsedSnapshotDeps,
          version: session.snapshot_version || 1,
        },
      };
    }

    let sessionMetadata: Record<string, unknown> = {};
    const rawMetadata = session.metadata as unknown;
    if (typeof rawMetadata === 'string') {
      try {
        sessionMetadata = JSON.parse(rawMetadata) as Record<string, unknown>;
      } catch (error) {
        businessLogger.warn('Failed to parse session metadata JSON', {
          sessionId,
          error: (error as Error).message,
        });
      }
    } else if (rawMetadata && typeof rawMetadata === 'object') {
      sessionMetadata = rawMetadata as Record<string, unknown>;
    }

    businessLogger.info('Full session retrieved with project context', {
      sessionId,
      fileCount: filesResult.length,
      conversationLength: conversationResult.length,
      summaryCount: summariesResult.length,
      hasProjectContext: !!projectContext,
    });

    return {
      session_id: session.id,
      session_name: session.name,
      project_name: session.project_name,
      version: session.version,
      files: filesResult.map(file => ({
        path: file.path,
        content: file.content,
      })),
      conversation: conversationResult.map(conv => ({
        role: conv.role,
        content: conv.content,
      })),
      metadata: {
        ...sessionMetadata,
        project_context: projectContext,
      },
      summaries: summariesResult.map(summary => ({
        file_path: filesResult.find(f => f.id === summary.file_id)?.path || 'unknown',
        summary: summary.summary,
      })),
    };
  }

  /**
   * Get sessions by project context
   */
  async getSessionsByProjectContext(
    projectContextId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<{ sessions: ResumeContextOutput[]; total: number }> {
    businessLogger.info('Getting sessions by project context', {
      projectContextId,
      limit,
      offset,
    });

    const sessions = await this.db.query<Session>(
      `SELECT s.* FROM sessions s
       WHERE s.snapshot_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [projectContextId, limit, offset]
    );

    const totalResult = await this.db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM sessions WHERE snapshot_id = $1',
      [projectContextId]
    );

    const fullSessions = await Promise.all(
      sessions.map(session => this.retrieveFullSession(session.id))
    );

    return {
      sessions: fullSessions,
      total: totalResult[0]?.count || 0,
    };
  }

  private createSyntheticFile(input: SaveContextInput): { path: string; content: string } {
    const timestamp = new Date().toISOString();
    const recentMessages = input.conversation && input.conversation.length > 0
      ? input.conversation.slice(-10)
      : [];
    const conversationSection = recentMessages.length > 0
      ? recentMessages.map(msg => `### ${msg.role.toUpperCase()}\n${msg.content}`).join('\n\n')
      : 'No conversation captured.';
    const metadataSection = input.metadata && Object.keys(input.metadata).length > 0
      ? JSON.stringify(input.metadata, null, 2)
      : 'None';

    return {
      path: 'CONVERSATION_SUMMARY.md',
      content: [
        `# Context Engine Snapshot`,
        '',
        `- Session: ${input.session_name}`,
        `- Project: ${input.project_name}`,
        `- Generated: ${timestamp}`,
        '',
        '## Metadata',
        metadataSection,
        '',
        '## Conversation',
        conversationSection,
        '',
      ].join('\n'),
    };
  }

  private calculateContentHash(content: string): string {
    // Simple hash function for now - in production, use crypto
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  async getSessionStats(): Promise<{
    totalSessions: number;
    totalFiles: number;
    totalConversations: number;
    averageFilesPerSession: number;
  }> {
    const stats = await this.db.query<{
      total_sessions: number;
      total_files: number;
      total_conversations: number;
      avg_files: number;
    }>(`
      SELECT
        COUNT(DISTINCT s.id) as total_sessions,
        COUNT(DISTINCT f.id) as total_files,
        COUNT(DISTINCT c.id) as total_conversations,
        AVG(file_counts.count) as avg_files
      FROM sessions s
      LEFT JOIN files f ON s.id = f.session_id
      LEFT JOIN conversations c ON s.id = c.session_id
      LEFT JOIN (
        SELECT session_id, COUNT(*) as count
        FROM files
        GROUP BY session_id
      ) file_counts ON s.id = file_counts.session_id
    `);

    const result = stats[0] || {
      total_sessions: 0,
      total_files: 0,
      total_conversations: 0,
      avg_files: 0,
    };

    return {
      totalSessions: result.total_sessions,
      totalFiles: result.total_files,
      totalConversations: result.total_conversations,
      averageFilesPerSession: Math.round(result.avg_files || 0),
    };
  }
}
