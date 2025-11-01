# Context Engine Core

Open-source core for Context Engine. This package contains the database schema, session/project management logic, and MCP tool handlers that power the private deployment. Authentication, environment configuration, and deployment scripts live in the private repository.

## What Is Included

- `src/business`: Session and project context managers
- `src/database`: Schema definition, migrations, and pooled connection helper
- `src/tools`: MCP `context.save`, `context.resume`, and `context.list` handlers
- `src/types`: Shared type definitions
- `src/utils`: Validation and logging helpers

## What Is Not Included

- Token generation and validation services
- Fastify server, CLI utilities, or deployment scripts
- Environment configuration or secrets

## Status and Known Limitations

The code compiles to a reusable library, but distribution is still constrained by MCP host policies:

- Warp is the only client confirmed to load Context Engine today.
- Claude Code, Codex, Kilocode, and similar IDE MCP integrations appear to block third-party endpoints in their sandboxes, so this server never receives their requests.
- Resume queries still need a SQL fix to handle legacy rows that lack `file_id` values (see `SessionManager.retrieveFullSession`).

For the full set of blockers and suggested next steps, see [`docs/known-limitations.md`](docs/known-limitations.md).

## Getting Started

```bash
# install dependencies
yarn install  # or npm install

# type checking
npm run typecheck

# build the library (outputs to dist/)
npm run build
```

Consumers can then import the managers and tool handlers:

```ts
import { SessionManager, ProjectManager } from 'context-engine-core';
import { DatabaseConnection } from 'context-engine-core';

const db = new DatabaseConnection({
  url: process.env.DATABASE_URL!,
  poolSize: 20,
  timeout: 30000,
});

const sessionManager = new SessionManager(db);
```

## Repository Layout

```
context-engine-core/
  src/
    business/
    database/
      migrations/
    tools/
    types/
    utils/
    demo/
  package.json
  tsconfig.json
```

## Demo Server (Local Testing)

The public package ships with a minimal Fastify server so contributors can exercise the core logic without the private authentication layer. The demo server uses a single demo token and user account.

1. Copy the environment template and adjust as needed:
   ```bash
   cp .env.example .env
   ```
   - `DEMO_AUTH_TOKEN` defaults to `demo-token`. All requests must include `Authorization: Bearer demo-token` unless you set `DEMO_AUTH_MODE=none`.
   - `DATABASE_URL` points to a local PostgreSQL instance by default.

2. Run the migrations:
   ```bash
   npm run demo:migrate
   ```

3. Start the demo server:
   ```bash
   npm run demo:server
   ```
   The server listens on `http://127.0.0.1:8085` by default.

4. Try the endpoints:
   ```bash
   curl -X POST http://127.0.0.1:8085/context/save \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer demo-token" \
     -d '{
       "session_name": "demo-session",
       "project_name": "demo-project",
       "files": [{"path": "README.md", "content": "# Demo"}],
       "conversation": [{"role": "user", "content": "Initial instructions"}],
       "metadata": {"tags": ["demo"]}
     }'
   ```

## Contributing

Issues and pull requests are welcome for the open-core logic. Please do not submit changes that require deployment secrets or internal infrastructure; those belong in the private repository.

## License

Released under the MIT license.
