import { z } from 'zod';
import type { SaveContextInput, ResumeContextInput, ListContextsInput } from '@/types';

// Input validation schemas using Zod
export const SaveContextSchema = z.object({
  session_name: z.string()
    .min(1, 'Session name is required')
    .max(100, 'Session name must be less than 100 characters')
    .regex(/^[a-zA-Z0-9._-\s]+$/, 'Session name can only contain letters, numbers, dots, hyphens, underscores, and spaces'),

  project_name: z.string()
    .min(1, 'Project name is required')
    .max(100, 'Project name must be less than 100 characters')
    .regex(/^[a-zA-Z0-9._-\s]+$/, 'Project name can only contain letters, numbers, dots, hyphens, underscores, and spaces'),

  files: z.array(z.object({
    path: z.string()
      .min(1, 'File path is required')
      .max(500, 'File path must be less than 500 characters')
      .regex(/^[a-zA-Z0-9/._-]+$/, 'File path contains invalid characters'),

    content: z.string()
      .max(1000000, 'File content too large (max 1MB)'), // Will be further validated by line count
  })).max(50, 'Too many files (max 50 per session)')
    .default([]),

  conversation: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(10000, 'Message content too large (max 10KB)'),
  })).max(100, 'Too many conversation messages (max 100)'),

  metadata: z.record(z.unknown()).optional().default({}),
  auth_token: z.string()
    .min(20, 'Authentication token must be at least 20 characters')
    .max(100, 'Authentication token too long')
    .regex(/^ce-[a-f0-9]+$/, 'Authentication token must start with "ce-" followed by hex characters'), // Authentication token for security
  user_id: z.string().optional(), // Added after authentication
});

export const ResumeContextSchema = z.object({
  session_name: z.string()
    .min(1, 'Session name is required')
    .max(100, 'Session name must be less than 100 characters'),

  project_name: z.string()
    .max(100, 'Project name must be less than 100 characters')
    .optional(),

  file_path: z.string()
    .max(500, 'File path must be less than 500 characters')
    .optional(),

  auth_token: z.string()
    .min(20, 'Authentication token must be at least 20 characters')
    .max(100, 'Authentication token too long')
    .regex(/^ce-[a-f0-9]+$/, 'Authentication token must start with "ce-" followed by hex characters'), // Authentication token for security
  user_id: z.string().optional(), // Added after authentication
});

export const ListContextsSchema = z.object({
  project_name: z.string()
    .max(100, 'Project name must be less than 100 characters')
    .optional(),

  file_path: z.string()
    .max(500, 'File path must be less than 500 characters')
    .optional(),

  limit: z.number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .optional().default(20),

  offset: z.number()
    .int('Offset must be an integer')
    .min(0, 'Offset cannot be negative')
    .optional().default(0),

  auth_token: z.string()
    .min(20, 'Authentication token must be at least 20 characters')
    .max(100, 'Authentication token too long')
    .regex(/^ce-[a-f0-9]+$/, 'Authentication token must start with "ce-" followed by hex characters'), // Authentication token for security
  user_id: z.string().optional(), // Added after authentication
});

// File validation utilities
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class FileValidator {
  private maxFileSizeKB: number;
  private maxLinesPerFile: number;
  private allowedFileTypes: string[];

  constructor(maxFileSizeKB: number, maxLinesPerFile: number, allowedFileTypes: string[]) {
    this.maxFileSizeKB = maxFileSizeKB;
    this.maxLinesPerFile = maxLinesPerFile;
    this.allowedFileTypes = allowedFileTypes;
  }

  validateFile(filePath: string, content: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file size
    const fileSizeKB = Buffer.byteLength(content, 'utf8') / 1024;
    if (fileSizeKB > this.maxFileSizeKB) {
      errors.push(`File too large: ${fileSizeKB.toFixed(1)}KB (max ${this.maxFileSizeKB}KB)`);
    }

    // Check line count
    const lineCount = content.split('\n').length;
    if (lineCount > this.maxLinesPerFile) {
      errors.push(`Too many lines: ${lineCount} (max ${this.maxLinesPerFile})`);
    }

    // Check file extension
    const fileExtension = this.getFileExtension(filePath);
    if (fileExtension && !this.allowedFileTypes.includes(fileExtension)) {
      warnings.push(`File type not allowed: ${fileExtension}`);
    }

    // Check for path traversal
    if (this.containsPathTraversal(filePath)) {
      errors.push('Invalid file path: path traversal not allowed');
    }

    // Check for empty files
    if (content.trim().length === 0) {
      warnings.push('File is empty');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1]!.toLowerCase()}` : '';
  }

  private containsPathTraversal(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return normalizedPath.includes('../') ||
           normalizedPath.includes('..\\') ||
           normalizedPath.startsWith('/') ||
           normalizedPath.includes('~');
  }
}

// Session validation utilities
export class SessionValidator {
  private maxSessionTokens: number;
  private fileValidator: FileValidator;

  constructor(maxSessionTokens: number, fileValidator: FileValidator) {
    this.maxSessionTokens = maxSessionTokens;
    this.fileValidator = fileValidator;
  }

  validateSession(input: SaveContextInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate individual files
    input.files.forEach((file, index) => {
      const validation = this.fileValidator.validateFile(file.path, file.content);
      if (!validation.valid) {
        errors.push(`File ${index + 1} (${file.path}): ${validation.errors.join(', ')}`);
      }
      warnings.push(...validation.warnings.map(w => `File ${index + 1} (${file.path}): ${w}`));
    });

    // Validate total session size (rough token estimation)
    const totalTokens = this.estimateTokens(input);
    if (totalTokens > this.maxSessionTokens) {
      errors.push(`Session too large: ~${totalTokens} tokens (max ${this.maxSessionTokens})`);
    }

    // Check for duplicate file paths
    const filePaths = input.files.map(f => f.path);
    const uniquePaths = new Set(filePaths);
    if (filePaths.length !== uniquePaths.size) {
      errors.push('Duplicate file paths in session');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private estimateTokens(input: SaveContextInput): number {
    // Rough estimation: ~4 characters per token
    const fileTokens = input.files.reduce((sum, file) =>
      sum + file.content.length, 0
    ) / 4;

    const conversationTokens = input.conversation.reduce((sum, msg) =>
      sum + msg.content.length, 0
    ) / 4;

    return Math.floor(fileTokens + conversationTokens);
  }
}

// Export validation functions
export const validateSaveContext = (input: unknown): SaveContextInput => {
  return SaveContextSchema.parse(input);
};

export const validateResumeContext = (input: unknown): ResumeContextInput => {
  const parsed = ResumeContextSchema.parse(input);
  return {
    session_name: parsed.session_name,
    project_name: parsed.project_name,
    file_path: parsed.file_path,
    auth_token: parsed.auth_token,
    user_id: parsed.user_id,
  };
};

export const validateListContexts = (input: unknown): ListContextsInput => {
  const parsed = ListContextsSchema.parse(input);
  const result: ListContextsInput = {
    limit: parsed.limit,
    offset: parsed.offset,
    auth_token: parsed.auth_token,
  };

  if (parsed.project_name !== undefined) {
    result.project_name = parsed.project_name;
  }
  if (parsed.file_path !== undefined) {
    result.file_path = parsed.file_path;
  }
  if (parsed.user_id !== undefined) {
    result.user_id = parsed.user_id;
  }

  return result;
};
