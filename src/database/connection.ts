import pg from 'pg';
const { Pool } = pg;
type PoolClient = pg.PoolClient;
import type { DatabaseConfig } from '@/types';
import { createDatabaseLogger } from '@/utils/logger';
import { readFileSync } from 'fs';
import path from 'path';

const dbLogger = createDatabaseLogger();

const resolveSslConfig = (): pg.PoolConfig['ssl'] | undefined => {
  const skipHostnameCheck = process.env.DATABASE_SSL_CHECK_HOSTNAME === 'false';

  const buildSslConfig = (ca: string): pg.PoolConfig['ssl'] => {
    const sslOptions: any = { ca, rejectUnauthorized: true };
    if (skipHostnameCheck) {
      sslOptions.checkServerIdentity = () => undefined;
      dbLogger.warn('DATABASE_SSL_CHECK_HOSTNAME set to false - TLS hostname verification disabled');
    }
    return sslOptions;
  };

  const caString = process.env.DATABASE_SSL_CA;
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;

  if (caString) {
    return buildSslConfig(caString);
  }

  if (caFile) {
    try {
      const resolvedPath = path.resolve(caFile);
      const ca = readFileSync(resolvedPath, 'utf8');
      dbLogger.info('Loaded database CA certificate', { path: resolvedPath });
      return buildSslConfig(ca);
    } catch (error) {
      dbLogger.error('Failed to read database CA certificate file', {
        path: caFile,
        error: (error as Error).message,
      });
    }
  }

  if (rejectUnauthorized === 'false') {
    dbLogger.warn('DATABASE_SSL_REJECT_UNAUTHORIZED set to false - TLS certificates will not be validated');
    return { rejectUnauthorized: false };
  }

  if (skipHostnameCheck) {
    dbLogger.warn('DATABASE_SSL_CHECK_HOSTNAME set to false but no CA provided - TLS hostname verification disabled without certificate pinning');
    return { rejectUnauthorized: false, checkServerIdentity: () => undefined } as any;
  }

  return undefined;
};

export class DatabaseConnection {
  private pool: pg.Pool;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    const ssl = resolveSslConfig();
    this.pool = new pg.Pool({
      connectionString: config.url,
      max: config.poolSize,
      connectionTimeoutMillis: config.timeout,
      idleTimeoutMillis: 30000,
      allowExitOnIdle: false,
      ...(ssl ? { ssl } : {}),
    });

    // Handle pool errors
    this.pool.on('error', (err: Error) => {
      dbLogger.error('Database pool error', { error: err.message, stack: err.stack });
    });

    this.pool.on('connect', () => {
      dbLogger.info('New database connection established');
    });

    this.pool.on('remove', () => {
      dbLogger.info('Database connection removed');
    });
  }

  async initialize(): Promise<void> {
    try {
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      dbLogger.info('Database connection pool initialized successfully', {
        poolSize: this.config.poolSize,
        timeout: this.config.timeout,
      });
    } catch (error) {
      dbLogger.error('Failed to initialize database connection', { error: (error as Error).message });
      throw error;
    }
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params as any[]) as pg.QueryResult<T>;
      const duration = Date.now() - start;

      dbLogger.info('Database query completed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        rowCount: result.rowCount,
      });

      return result.rows;
    } catch (error) {
      const duration = Date.now() - start;
      dbLogger.error('Database query failed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Query that returns the full result object (for backward compatibility)
  async queryFull<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params as any[]) as pg.QueryResult<T>;
      const duration = Date.now() - start;

      dbLogger.info('Database query completed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        rowCount: result.rowCount,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      dbLogger.error('Database query failed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    const start = Date.now();

    try {
      await client.query('BEGIN');
      dbLogger.info('Transaction started');

      const result = await callback(client);

      await client.query('COMMIT');
      const duration = Date.now() - start;
      dbLogger.info('Transaction committed', { duration: `${duration}ms` });

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const duration = Date.now() - start;
      dbLogger.error('Transaction rolled back', {
        duration: `${duration}ms`,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy', details: Record<string, unknown> }> {
    try {
      const start = Date.now();
      const result = await this.query('SELECT NOW() as now, version() as version');
      const duration = Date.now() - start;

      const poolStats = {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount,
      };

      return {
        status: 'healthy',
        details: {
          queryTime: `${duration}ms`,
          timestamp: (result[0] as any)?.now,
          version: (result[0] as any)?.version,
          poolStats,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    dbLogger.info('Database connection pool closed');
  }

  // Migration helpers
  async runMigrations(migrationSQL: string): Promise<void> {
    dbLogger.info('Running database migrations');
    try {
      await this.query(migrationSQL);
      dbLogger.info('Database migrations completed successfully');
    } catch (error) {
      dbLogger.error('Database migration failed', { error: (error as Error).message });
      throw error;
    }
  }

  // Schema validation
  async validateSchema(): Promise<boolean> {
    try {
      // Check if required tables exist
      const tablesQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      `;
      const tables = await this.query<{ table_name: string }>(tablesQuery);
      const tableNames = tables.map(t => t.table_name);

      const requiredTables = ['sessions', 'files', 'conversations', 'summaries'];
      const missingTables = requiredTables.filter(table => !tableNames.includes(table));

      if (missingTables.length > 0) {
        dbLogger.error('Missing required database tables', { missingTables });
        return false;
      }

      dbLogger.info('Database schema validation passed');
      return true;
    } catch (error) {
      dbLogger.error('Database schema validation failed', { error: (error as Error).message });
      return false;
    }
  }
}

// Singleton instance
let dbInstance: DatabaseConnection | null = null;

export const getDatabase = (config?: DatabaseConfig): DatabaseConnection => {
  if (!dbInstance) {
    if (!config) {
      throw new Error('Database configuration required for first initialization');
    }
    dbInstance = new DatabaseConnection(config);
  }
  return dbInstance;
};

// Export for backward compatibility
export const getPool = (config?: DatabaseConfig): DatabaseConnection => {
  return getDatabase(config);
};

export const initializeDatabase = async (config: DatabaseConfig): Promise<DatabaseConnection> => {
  const db = getDatabase(config);
  await db.initialize();
  return db;
};
