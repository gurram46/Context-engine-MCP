import type {
  ProjectContext,
  ProjectContextSnapshot,
  SaveContextInput,
  ResumeContextInput,
  ListContextsInput,
} from '@/types';
import { createDatabaseLogger } from '@/utils/logger';
import type { DatabaseConnection } from '@/database/connection';
import crypto from 'crypto';

const projectLogger = createDatabaseLogger();

export class ProjectManager {
  constructor(private db: DatabaseConnection) {}

  /**
   * Detect project tech stack from file contents
   */
  async detectTechStack(files: Array<{ path: string; content: string }>): Promise<{
    tech_stack: Record<string, unknown>;
    project_type: string;
    programming_languages: string[];
    build_system?: string;
    test_framework?: string;
  }> {
    const tech_stack: Record<string, unknown> = {};
    const programming_languages = new Set<string>();
    let project_type = 'other';
    let build_system: string | undefined;
    let test_framework: string | undefined;

    for (const file of files) {
      const { path, content } = file;
      const ext = path.split('.').pop()?.toLowerCase();

      // Detect programming languages
      if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
        programming_languages.add(ext === 'ts' || ext === 'tsx' ? 'typescript' : 'javascript');

        // Check for React
        if (content.includes('import React') || content.includes('from "react"') || content.includes('from \'react\'')) {
          tech_stack.react = true;
          project_type = 'web-app';
        }

        // Check for Node.js specific patterns
        if (content.includes('require(') || content.includes('module.exports') || content.includes('const express')) {
          tech_stack.nodejs = true;
        }

        // Check for Vue
        if (content.includes('import { createApp }') || content.includes('from "vue"')) {
          tech_stack.vue = true;
          project_type = 'web-app';
        }

        // Check for Angular
        if (content.includes('@angular/core') || content.includes('NgModule')) {
          tech_stack.angular = true;
          project_type = 'web-app';
        }
      }

      // Check Python
      if (ext === 'py') {
        programming_languages.add('python');

        if (content.includes('import flask') || content.includes('from flask')) {
          tech_stack.flask = true;
          project_type = 'api-service';
        }

        if (content.includes('import django') || content.includes('from django')) {
          tech_stack.django = true;
          project_type = 'web-app';
        }

        if (content.includes('import fastapi') || content.includes('from fastapi')) {
          tech_stack.fastapi = true;
          project_type = 'api-service';
        }
      }

      // Check for package.json
      if (path === 'package.json') {
        try {
          const packageData = JSON.parse(content);

          tech_stack.npm_packages = Object.keys(packageData.dependencies || {});
          tech_stack.dev_packages = Object.keys(packageData.devDependencies || {});

          // Detect build system
          if (packageData.scripts) {
            const scripts = Object.keys(packageData.scripts);
            if (scripts.some(s => s.includes('npm') || s.includes('yarn') || s.includes('pnpm'))) {
              build_system = 'npm'; // Default to npm
            }
          }

          // Detect test framework
          if (packageData.devDependencies) {
            const devDeps = packageData.devDependencies;
            if (devDeps.jest || devDeps['@jest/core']) {
              test_framework = 'jest';
            } else if (devDeps.vitest) {
              test_framework = 'vitest';
            } else if (devDeps.mocha) {
              test_framework = 'mocha';
            } else if (devDeps.pytest) {
              test_framework = 'pytest';
            }
          }

          // More specific type detection
          if (packageData.dependencies?.express || packageData.dependencies?.fastify) {
            project_type = 'api-service';
          } else if (packageData.dependencies?.react || packageData.dependencies?.['@types/react']) {
            project_type = 'web-app';
          } else if (packageData.dependencies?.electron) {
            project_type = 'desktop-app';
          } else if (packageData.dependencies?.react || packageData.dependencies?.['@react-native']) {
            project_type = 'mobile-app';
          }
        } catch (e) {
          projectLogger.warn('Failed to parse package.json', { error: e });
        }
      }

      // Check for tsconfig.json
      if (path === 'tsconfig.json') {
        try {
          const tsConfig = JSON.parse(content);
          tech_stack.tsconfig = tsConfig;

          if (tsConfig.compilerOptions?.target) {
            tech_stack.typescript_target = tsConfig.compilerOptions.target;
          }
        } catch (e) {
          projectLogger.warn('Failed to parse tsconfig.json', { error: e });
        }
      }

      // Check for requirements.txt (Python)
      if (path === 'requirements.txt') {
        programming_languages.add('python');
        const dependencies = content.split('\n').filter(line => line.trim());
        tech_stack.python_packages = dependencies;

        if (dependencies.some(dep => dep.includes('django'))) {
          project_type = 'web-app';
        } else if (dependencies.some(dep => dep.includes('flask') || dep.includes('fastapi'))) {
          project_type = 'api-service';
        }
      }

      // Check for Cargo.toml (Rust)
      if (path === 'Cargo.toml') {
        programming_languages.add('rust');
        const cargoContent = content.toLowerCase();
        if (cargoContent.includes('axum')) {
          project_type = 'api-service';
        } else if (cargoContent.includes('yew')) {
          project_type = 'web-app';
        } else {
          project_type = 'cli-tool';
        }
      }

      // Check for go.mod (Go)
      if (path === 'go.mod') {
        programming_languages.add('go');
        project_type = content.includes('github.com/gin-gonic') ? 'api-service' : 'cli-tool';
      }
    }

    // Determine project type if not set
    if (project_type === 'other') {
      if (programming_languages.has('typescript') || programming_languages.has('javascript')) {
        project_type = 'cli-tool'; // Default for JS/TS
      } else if (programming_languages.has('python')) {
        project_type = 'cli-tool'; // Default for Python
      }
    }

    return {
      tech_stack,
      project_type,
      programming_languages: Array.from(programming_languages),
      build_system,
      test_framework,
    };
  }

  /**
   * Calculate context hash from tech stack
   */
  calculateContextHash(tech_stack: Record<string, unknown>): string {
    const hashInput = JSON.stringify(tech_stack, Object.keys(tech_stack).sort());
    return crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Create or update project context
   */
  async createOrUpdateProjectContext(
    userId: string,
    projectName: string,
    files: Array<{ path: string; content: string }>,
    description?: string
  ): Promise<ProjectContext> {
    projectLogger.info('Creating/updating project context', {
      userId,
      projectName,
      fileCount: files.length,
    });

    // Detect tech stack
    const techInfo = await this.detectTechStack(files);
    const contextHash = this.calculateContextHash(techInfo.tech_stack);

    return await this.db.transaction(async (client) => {
      // Check if project context exists
      const existingContextResult = await client.query<ProjectContext>(
        'SELECT * FROM project_contexts WHERE user_id = $1 AND project_name = $2',
        [userId, projectName]
      );
      const existingContext = existingContextResult.rows;

      let projectContext: ProjectContext;

      if (existingContext.length > 0) {
        // Update existing context
        const result = await client.query<ProjectContext>(
          `UPDATE project_contexts
           SET description = $3, tech_stack = $4, project_type = $5,
               programming_languages = $6, build_system = $7, test_framework = $8,
               last_modified_at = NOW(), is_active = true, context_hash = $9
           WHERE user_id = $1 AND project_name = $2
           RETURNING *`,
          [
            userId,
            projectName,
            description || null,
            JSON.stringify(techInfo.tech_stack),
            techInfo.project_type,
            JSON.stringify(techInfo.programming_languages),
            techInfo.build_system || null,
            techInfo.test_framework || null,
            contextHash,
          ]
        );
        projectContext = result.rows[0]!;
        projectLogger.info('Project context updated', { projectId: projectContext.id });
      } else {
        // Create new context
        const result = await client.query<ProjectContext>(
          `INSERT INTO project_contexts
           (user_id, project_name, description, tech_stack, project_type,
            programming_languages, build_system, test_framework, context_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            userId,
            projectName,
            description || null,
            JSON.stringify(techInfo.tech_stack),
            techInfo.project_type,
            JSON.stringify(techInfo.programming_languages),
            techInfo.build_system || null,
            techInfo.test_framework || null,
            contextHash,
          ]
        );
        projectContext = result.rows[0]!;
        projectLogger.info('Project context created', { projectId: projectContext.id });
      }

      return projectContext;
    });
  }

  /**
   * Create project context snapshot
   */
  async createSnapshot(
    projectContextId: string,
    files: Array<{ path: string; content: string }>,
    snapshotReason: 'auto' | 'manual' | 'tech-change' | 'major-update' | 'dependency-change' = 'auto'
  ): Promise<ProjectContextSnapshot> {
    projectLogger.info('Creating project snapshot', {
      projectContextId,
      fileCount: files.length,
      reason: snapshotReason,
    });

    // Get latest version for this project context
    const versionResult = await this.db.query<{ max_version: number }>(
      'SELECT COALESCE(MAX(snapshot_version), 0) as max_version FROM project_context_snapshots WHERE project_context_id = $1',
      [projectContextId]
    );

    const nextVersion = (versionResult[0]?.max_version || 0) + 1;

    // Build file tree and key files
    const fileTree: Record<string, unknown> = {};
    const keyFiles: Array<{ path: string; type: string; content?: string }> = [];

    for (const file of files) {
      const { path, content } = file;
      const ext = path.split('.').pop()?.toLowerCase();

      // Add to file tree
      fileTree[path] = {
        size: content.length,
        type: ext || 'unknown',
        last_modified: new Date().toISOString(),
      };

      // Mark key files
      const isKeyFile = ['package.json', 'tsconfig.json', 'requirements.txt', 'Cargo.toml', 'go.mod',
                         'README.md', '.gitignore', 'Dockerfile', 'docker-compose.yml'].includes(path);

      if (isKeyFile || ext === 'md' || (ext === 'json' && path.includes('config'))) {
        keyFiles.push({
          path,
          type: ext || 'unknown',
          content: content.length > 10000 ? content.substring(0, 10000) + '...' : content, // Truncate large files
        });
      }
    }

    // Detect dependencies from package.json or similar
    let dependencies: Record<string, unknown> = {};
    let devDependencies: Record<string, unknown> = {};

    for (const file of files) {
      if (file.path === 'package.json') {
        try {
          const packageData = JSON.parse(file.content);
          dependencies = packageData.dependencies || {};
          devDependencies = packageData.devDependencies || {};
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    // Create snapshot
    const snapshot = await this.db.query<ProjectContextSnapshot>(
      `INSERT INTO project_context_snapshots
       (project_context_id, snapshot_version, file_tree, key_files,
        dependencies, dev_dependencies, snapshot_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        projectContextId,
        nextVersion,
        JSON.stringify(fileTree),
        JSON.stringify(keyFiles),
        JSON.stringify(dependencies),
        JSON.stringify(devDependencies),
        snapshotReason,
        'auto',
      ]
    );

    projectLogger.info('Project snapshot created', {
      snapshotId: snapshot[0].id,
      version: nextVersion,
      reason: snapshotReason,
    });

    return snapshot[0];
  }

  /**
   * Get project context by name and user
   */
  async getProjectContext(userId: string, projectName: string): Promise<ProjectContext | null> {
    const result = await this.db.query<ProjectContext>(
      'SELECT * FROM project_contexts WHERE user_id = $1 AND project_name = $2 AND is_active = true',
      [userId, projectName]
    );

    return result.length > 0 ? result[0] : null;
  }

  /**
   * List project contexts for a user
   */
  async listProjectContexts(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ contexts: ProjectContext[]; total: number }> {
    const contexts = await this.db.query<ProjectContext>(
      `SELECT * FROM project_contexts
       WHERE user_id = $1 AND is_active = true
       ORDER BY last_modified_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const totalResult = await this.db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM project_contexts WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    return {
      contexts,
      total: totalResult[0]?.count || 0,
    };
  }

  /**
   * Get latest snapshot for a project context
   */
  async getLatestSnapshot(projectContextId: string): Promise<ProjectContextSnapshot | null> {
    const result = await this.db.query<ProjectContextSnapshot>(
      `SELECT * FROM project_context_snapshots
       WHERE project_context_id = $1
       ORDER BY snapshot_version DESC
       LIMIT 1`,
      [projectContextId]
    );

    return result.length > 0 ? result[0] : null;
  }
}
