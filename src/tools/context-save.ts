import { z } from 'zod';
import type { SaveContextInput, SaveContextOutput, ContextEngineError } from '@/types';
import { SessionManager } from '@/business/session-manager';
import { validateSaveContext } from '@/utils/validation';
import { createMcpLogger } from '@/utils/logger';

const mcpLogger = createMcpLogger();

export const contextSaveTool = {
  name: 'context.save',
  description: `Save the current coding session so it can be resumed later (even from another AI tool).

Use this tool whenever the user says things like:
- "Save this session" or "Save this as <name>"
- "Remember this conversation"
- "Let's continue this later"

When you call this tool you should gather the current working context:
- session_name: short name the user can refer to later (e.g. "bug-fix", "auth-flow")
- project_name: name of the overall project/workspace (use whatever label has been used in conversation)
- files: the key files currently being discussed. Include full content so Context Engine can restore state.
- conversation: relevant turns from this chat so resuming picks up with the same instructions/questions.
- metadata: (optional) tags, descriptions, status, ticket numbers, etc.

Example:
User: "Save this as bug-fix"
→ Call context.save with session_name="bug-fix", project_name from context, files/conversation populated from the conversation history.
` ,
  inputSchema: z.object({
    session_name: z.string().describe('Short, user-friendly name for the session (e.g., "bug-fix", "refactor-auth"). Ask the user if they did not provide one.'),
    project_name: z.string().describe('Name of the project/workspace this session belongs to. Derive from conversation if possible.'),
    files: z.array(z.object({
      path: z.string().describe('File path relative to the project root (e.g., src/auth.ts)'),
      content: z.string().describe('Full contents of the file at the time of saving.'),
    })).describe('List of the key files discussed in this session. Include full content so the session can be reconstructed.'),
    conversation: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']).describe('Who sent the message'),
      content: z.string().describe('Message text'),
    })).describe('Relevant conversation turns to remember. Include at least the latest instructions/questions.'),
    metadata: z.record(z.unknown()).optional().describe('Optional structured metadata such as tags, ticket IDs, branch names, etc.'),
    auth_token: z.string().describe('Authentication token. This is injected automatically from client configuration—do not ask the user for it.'),
  }),

  handler: async (input: unknown, sessionManager: SessionManager): Promise<SaveContextOutput | ContextEngineError> => {
    try {
      mcpLogger.info('Context save tool called with 3-layer context', { tool: 'context.save' });

      // Validate input
      const validatedInput = validateSaveContext(input);

      // Extract user_id from authenticated input (provided by MCP server after token validation)
      const userId = validatedInput.user_id;

      if (!userId) {
        throw new Error('User authentication failed: missing user_id');
      }

      mcpLogger.info('Input validation passed', {
        sessionName: validatedInput.session_name,
        projectName: validatedInput.project_name,
        fileCount: validatedInput.files.length,
        userId: userId,
      });

      // Save session with 3-layer context
      const result = await sessionManager.saveSession(validatedInput, userId);

      mcpLogger.info('Session saved successfully with 3-layer context', {
        sessionId: result.session_id,
        status: result.status,
        version: result.version,
        projectContextId: result.project_context_id,
      });

      return result;

    } catch (error) {
      mcpLogger.error('Context save failed', {
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

      if ((error as Error).message.includes('duplicate key')) {
        return {
          code: 'DUPLICATE_SESSION',
          message: 'Session with this name already exists',
          details: { suggestion: 'Try using a different session name or version' },
        };
      }

      if ((error as Error).message.includes('too large')) {
        return {
          code: 'SIZE_LIMIT_EXCEEDED',
          message: 'Session exceeds size limits',
          details: { suggestion: 'Remove some files or reduce conversation length' },
        };
      }

      return {
        code: 'INTERNAL_ERROR',
        message: 'Failed to save session',
        details: { error: (error as Error).message },
      };
    }
  },
};
