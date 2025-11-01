# Known Limitations

This file mirrors the current blockers that affect the Context Engine open-core package. It is intended to give contributors the same context as the private deployment team.

## MCP Client Support

- **Warp**: The only MCP host confirmed to load the bridge and send traffic to the server. All integration tests run through Warp.
- **Claude Code / Codex / Kilocode / Cursor**: Appear to run in sandboxes that only allow vendor-operated MCP endpoints. The handshake never reaches our server, so there is nothing we can patch on our side. External coordination with each vendor is required before these clients can be supported.

## Backend Issues

- `SessionManager.retrieveFullSession` still fails when legacy `files` rows lack `file_id`. The bridge falls back to `context.list`, but full resume responses remain unreliable.
- Warp logs show `Body Timeout Error` messages when the connection sits idle. Behaviour is benign but noisy.
- Automated integration tests for the resume path are not in place yet.

## Distribution Challenges

- Authentication and token-issuance flows remain private. Open-core adopters must implement their own auth boundary or link back to the private repo.
- Without Claude Code or Codex support the original “rate-limit bypass” product thesis is not validated. Contributors should treat Warp support as alpha quality until additional clients are unlocked.

## Recommended Focus Areas

1. Finish the SQL fix for resume queries and add integration coverage.
2. Reduce transport noise (keep-alive handling) so logs surface real errors.
3. Engage with MCP client vendors or pursue alternative distribution channels (e.g., browser extensions) if sandbox restrictions persist.

Last updated: 2025-10-31.
