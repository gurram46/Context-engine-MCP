import { z } from 'zod';
import type { ResumeContextInput, ResumeContextOutput, AmbiguousMatch, ContextEngineError } from '@/types';
import { SessionManager } from '@/business/session-manager';
import { validateResumeContext } from '@/utils/validation';
import { createMcpLogger } from '@/utils/logger';

const mcpLogger = createMcpLogger();

export const contextResumeTool = {
  name: 'context.resume',
  description: `Resume a previously saved coding session.

Use this tool when the user asks to continue work they saved earlier, e.g.:
- "Resume <name>"
- "Continue the <name> session"
- "Load what I was working on for <feature>"

It retrieves the stored files, conversation history, and metadata so you can seamlessly pick up the thread.
If multiple sessions match, return the matches so the user can choose.
` ,
  inputSchema: z.object({
    session_name: z.string().describe('Name (or partial name) of the session to resume (e.g., "bug-fix").'),
    project_name: z.string().optional().describe('Optional project filter when the user has many similarly named sessions.'),
    file_path: z.string().optional().describe('Optional file path filter if the user references a specific file.'),
    auth_token: z.string().describe('Authentication token (injected by the MCP client). Do not ask the user for it.'),
  }),

  handler: async (input: unknown, sessionManager: SessionManager): Promise<ResumeContextOutput | { matches: AmbiguousMatch[] } | ContextEngineError> => {
    try {
      mcpLogger.info('Context resume tool called', { tool: 'context.resume' });

      // Validate input
      const validatedInput = validateResumeContext(input);

      // Extract user_id from authenticated input (provided by MCP server after token validation)
      const userId = validatedInput.user_id;

      if (!userId) {
        throw new Error('User authentication failed: missing user_id');
      }

      mcpLogger.info('Input validation passed', {
        sessionName: validatedInput.session_name,
        projectName: validatedInput.project_name,
        filePath: validatedInput.file_path,
        userId: userId,
      });

      // Resume session with user scoping
      const result = await sessionManager.resumeSession(validatedInput, userId);

      // Check if result contains matches (ambiguous case)
      if ('matches' in result) {
        mcpLogger.info('Multiple matches found', {
          sessionName: validatedInput.session_name,
          matchCount: result.matches.length,
        });

        return {
          matches: result.matches.map(match => ({
            ...match,
            suggestion: match.project_name
              ? `Try: "${match.session_name}" from project "${match.project_name}"`
              : `Try: "${match.session_name}"`,
          })),
        };
      }

      mcpLogger.info('Session resumed successfully', {
        sessionId: result.session_id,
        sessionName: result.session_name,
        projectName: result.project_name,
        version: result.version,
        fileCount: result.files.length,
      });

      return result;

    } catch (error) {
      mcpLogger.error('Context resume failed', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      // Convert to standardized error format
      if (error instanceof z.ZodError) {
        return {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input provided',
          details: {
            errors: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        };
      }

      if ((error as Error).message.includes('not found')) {
        return {
          code: 'SESSION_NOT_FOUND',
          message: 'No matching sessions found',
          details: {
            sessionName: (input as any)?.session_name,
            suggestion: 'Try a different search term, exact session name, or provide project filters.',
          },
        };
      }

      return {
        code: 'INTERNAL_ERROR',
        message: 'Failed to resume session',
        details: { error: (error as Error).message },
      };
    }
  },
};
