import { z } from 'zod';
import type { ListContextsInput, ListContextsOutput, ContextEngineError } from '@/types';
import { SessionManager } from '@/business/session-manager';
import { validateListContexts } from '@/utils/validation';
import { createMcpLogger } from '@/utils/logger';

const mcpLogger = createMcpLogger();

export const contextListTool = {
  name: 'context.list',
  description: `List saved Context Engine sessions for the current user.

Use this when the user asks questions like:
- "What sessions do I have?"
- "Show my saved sessions"
- "What was I working on?"

You can optionally filter by project name, file path, or paginate through results.
` ,
  inputSchema: z.object({
    project_name: z.string().optional().describe('Optional project name filter (supports partial matching).'),
    file_path: z.string().optional().describe('Optional file path filter to show sessions touching a specific file.'),
    limit: z.number().min(1).max(100).optional().default(20).describe('Maximum number of results to return (default 20).'),
    offset: z.number().min(0).optional().default(0).describe('Number of results to skip for pagination (default 0).'),
    auth_token: z.string().describe('Authentication token (supplied automatically by the MCP client).'),
  }),

  handler: async (input: unknown, sessionManager: SessionManager): Promise<ListContextsOutput | ContextEngineError> => {
    try {
      mcpLogger.info('Context list tool called', { tool: 'context.list' });

      // Validate input
      const validatedInput = validateListContexts(input);

      // Extract user_id from authenticated input (provided by MCP server after token validation)
      const userId = validatedInput.user_id;

      if (!userId) {
        throw new Error('User authentication failed: missing user_id');
      }

      mcpLogger.info('Input validation passed', {
        projectName: validatedInput.project_name,
        filePath: validatedInput.file_path,
        limit: validatedInput.limit,
        offset: validatedInput.offset,
        userId: userId,
      });

      // List sessions with user scoping
      const result = await sessionManager.listSessions(validatedInput, userId);

      mcpLogger.info('Sessions listed successfully', {
        returnedCount: result.sessions.length,
        totalCount: result.total,
        hasMore: result.offset + result.limit < result.total,
      });

      return result;

    } catch (error) {
      mcpLogger.error('Context list failed', {
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

      return {
        code: 'INTERNAL_ERROR',
        message: 'Failed to list sessions',
        details: { error: (error as Error).message },
      };
    }
  },
};
