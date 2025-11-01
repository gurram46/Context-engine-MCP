import dotenv from 'dotenv';
import { DatabaseConnection } from '../database/connection.js';
import {
  ADD_EXTENSIONS_SQL,
  CREATE_TABLES_SQL,
  CREATE_PROJECT_CONTEXTS_SQL,
  CREATE_PROJECT_CONTEXT_SNAPSHOTS_SQL,
  UPDATE_SESSIONS_FOR_SNAPSHOTS_SQL,
  CREATE_SNAPSHOT_TRIGGER_SQL,
  CREATE_SMART_CONTEXT_TABLES_SQL,
  ADD_PERFORMANCE_INDEXES_SQL,
} from '../database/schema.js';

dotenv.config();

const databaseConfig = {
  url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/context_engine_core',
  poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
  timeout: parseInt(process.env.DATABASE_TIMEOUT || '30000', 10),
};

const statements = [
  ADD_EXTENSIONS_SQL,
  CREATE_TABLES_SQL,
  CREATE_PROJECT_CONTEXTS_SQL,
  CREATE_PROJECT_CONTEXT_SNAPSHOTS_SQL,
  UPDATE_SESSIONS_FOR_SNAPSHOTS_SQL,
  CREATE_SNAPSHOT_TRIGGER_SQL,
  CREATE_SMART_CONTEXT_TABLES_SQL,
  ADD_PERFORMANCE_INDEXES_SQL,
];

async function main() {
  const db = new DatabaseConnection(databaseConfig);
  await db.initialize();

  for (const statement of statements) {
    const sql = statement?.trim();
    if (!sql) continue;
    await db.runMigrations(sql);
  }

  await db.close();
  console.log('Database migrations completed.');
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
