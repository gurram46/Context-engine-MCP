import Fastify from 'fastify';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { ZodError } from 'zod';
import { DatabaseConnection } from '../database/connection.js';
import { SessionManager } from '../business/session-manager.js';
import { validateSaveContext, validateResumeContext, validateListContexts } from '../utils/validation.js';
import { createLogger } from '../utils/logger.js';
import type { ServerConfig } from '../types/index.js';

dotenv.config();

const demoPort = parseInt(process.env.DEMO_PORT || '8085', 10);
const demoHost = process.env.DEMO_HOST || '127.0.0.1';
const demoToken = process.env.DEMO_AUTH_TOKEN || 'demo-token';
const demoAuthMode = (process.env.DEMO_AUTH_MODE || 'token').toLowerCase();
const demoUsername = process.env.DEMO_USERNAME || 'demo-user';

const databaseConfig = {
  url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/context_engine_core',
  poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
  timeout: parseInt(process.env.DATABASE_TIMEOUT || '30000', 10),
};

const serverConfig: ServerConfig = {
  port: demoPort,
  host: demoHost,
  environment: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
  logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  enableHttps: false,
  httpsKeyPath: undefined,
  httpsCertPath: undefined,
  trustProxy: false,
  trustProxyIps: [],
};

const logger = createLogger(serverConfig);

const app = Fastify({ logger: false });

const db = new DatabaseConnection(databaseConfig);
const sessionManager = new SessionManager(db);

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

async function ensureDemoUser(): Promise<{ id: string; tokenHash: string }> {
  const tokenHash = hashToken(demoToken);

  const existing = await db.query<{ id: string; auth_token: string }>(
    'SELECT id, auth_token FROM users WHERE username = $1',
    [demoUsername]
  );

  if (existing.length > 0) {
    const user = existing[0];
    if (user.auth_token !== tokenHash) {
      await db.query('UPDATE users SET auth_token = $1 WHERE id = $2', [tokenHash, user.id]);
    }
    return { id: user.id, tokenHash };
  }

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO users (username, auth_token, status)
     VALUES ($1, $2, 'active')
     RETURNING id`,
    [demoUsername, tokenHash]
  );

  return { id: inserted[0].id, tokenHash };
}

function extractToken(requestToken?: string | string[]): string | null {
  if (!requestToken) return null;
  if (Array.isArray(requestToken)) {
    return extractToken(requestToken[0]);
  }
  const value = requestToken.trim();
  if (value.startsWith('Bearer ')) {
    return value.slice('Bearer '.length).trim();
  }
  return value;
}

app.post('/context/save', async (request, reply) => {
  try {
    const authHeader = request.headers['authorization'];
    const providedToken = extractToken(authHeader ?? undefined) || demoToken;

    if (demoAuthMode === 'token' && providedToken !== demoToken) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' });
    }

    const input = validateSaveContext({ ...(request.body as Record<string, unknown>), auth_token: providedToken });
    const result = await sessionManager.saveSession(input, demoUser.id);
    return reply.status(200).send(result);
  } catch (error) {
    logger.error('context.save failed', { error: (error as Error).message });
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: error.errors });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  }
});

app.post('/context/resume', async (request, reply) => {
  try {
    const authHeader = request.headers['authorization'];
    const providedToken = extractToken(authHeader ?? undefined) || demoToken;

    if (demoAuthMode === 'token' && providedToken !== demoToken) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' });
    }

    const input = validateResumeContext({ ...(request.body as Record<string, unknown>), auth_token: providedToken });
    const result = await sessionManager.resumeSession(input, demoUser.id);
    return reply.status(200).send(result);
  } catch (error) {
    logger.error('context.resume failed', { error: (error as Error).message });
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: error.errors });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  }
});

app.post('/context/list', async (request, reply) => {
  try {
    const authHeader = request.headers['authorization'];
    const providedToken = extractToken(authHeader ?? undefined) || demoToken;

    if (demoAuthMode === 'token' && providedToken !== demoToken) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' });
    }

    const input = validateListContexts({ ...(request.body as Record<string, unknown>), auth_token: providedToken });
    const result = await sessionManager.listSessions(input, demoUser.id);
    return reply.status(200).send(result);
  } catch (error) {
    logger.error('context.list failed', { error: (error as Error).message });
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: error.errors });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  }
});

app.get('/health', async (_request, reply) => {
  const health = await db.healthCheck();
  return reply.status(200).send({ status: health.status, details: health.details });
});

let demoUser: { id: string; tokenHash: string };

async function start() {
  await db.initialize();
  demoUser = await ensureDemoUser();
  await app.listen({ port: demoPort, host: demoHost });
  logger.info(`Context Engine demo server running on http://${demoHost}:${demoPort}`);
}

start().catch((error) => {
  logger.error('Failed to start demo server', { error: (error as Error).message });
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down demo server');
  await app.close();
  await db.close();
  process.exit(0);
});
