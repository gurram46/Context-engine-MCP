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

For the full set of blockers and suggested next steps, see [`docs/known-limitations.md`](docs/known-limitations.md) in the private deployment repository.

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
    tools/
    types/
    utils/
  package.json
  tsconfig.json
```

## Contributing

Issues and pull requests are welcome for the open-core logic. Please do not submit changes that require deployment secrets or internal infrastructure; those belong in the private repository.

## License

Released under the MIT license.
