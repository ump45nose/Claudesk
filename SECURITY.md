# Security Policy

Claudesk bridges browser requests into a locally running Claude Desktop process. Treat every remotely exposed method as privileged and keep the deployment behind HTTPS and strong authentication.

## Supported versions

Security fixes are applied to the current `main` branch. Older commits and locally modified IPC allowlists are not supported.

## Reporting a vulnerability

Use the repository's **Security** tab to open a private GitHub Security Advisory. Do not publish an Issue containing:

- Gateway API keys or request headers;
- `.env`, managed settings, developer settings, MCP configuration, or logs;
- session transcripts, uploaded files, trace files, or heap snapshots;
- public hostnames, private IP addresses, authentication cookies, or Authelia tokens.

Include the affected commit, enabled feature flags, the smallest reproducible request, expected behavior, and observed behavior. Redact all credentials and personal data.

## Deployment boundary

- Ports `15820` and `15821` have no built-in user authentication.
- Direct ports must remain on a trusted LAN/Tailnet or be bound to loopback.
- Internet access must pass through TLS and an authentication layer such as Authelia.
- `CLAUDE_REMOTE_GATEWAY_SETTINGS`, `CLAUDE_REMOTE_DEVELOPER_ACTIONS`, `CLAUDE_REMOTE_INFRASTRUCTURE_ACTIONS`, `CLAUDE_REMOTE_CODE_ACTIONS`, and `COWORK_BRIDGE_ALLOW_DESTRUCTIVE` expand the remote attack surface and are disabled by default.
- The Gateway API Key should remain in the Desktop container and must never be embedded in browser code, screenshots, logs, or repository files.

## Out of scope

Vulnerabilities in Claude Desktop, Electron, QEMU, Docker, the configured inference Gateway, reverse proxy, or authentication provider should also be reported to their respective maintainers. A Claudesk report is still appropriate when its bridge weakens or bypasses one of those products' boundaries.
