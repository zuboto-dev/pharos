# Security

## Reporting a vulnerability

Please do not post exploit details, credentials, project databases, or private logs in a public
issue. Use **Security → Report a vulnerability** on the repository if that option is available.
Otherwise, contact a maintainer using the private contact method on their public profile. If
none is listed, open an issue asking for a private security contact without disclosing details.

In your private report, include the affected commit or version, steps to reproduce with synthetic
data, the expected impact, and any suggested fix. Allow time to investigate before public
disclosure. Security fixes target the current main branch; older snapshots do not have a
separate maintenance policy.

## Local trust model

Pharos v0.1 is a single-user local application. It has no user authentication or tenant isolation.
The HTTP server binds to `127.0.0.1` and checks local hosts and origins. Keep both the API/MCP
server and web app on your own machine; do not expose them through public tunnels or reverse
proxies. A local process or connected MCP client can read and modify your project data.

The optional answering agent receives project context and runs with your operating-system
permissions. Only configure agent commands you trust. `PHAROS_AGENT_COMMAND=off` disables
automatic answering; connected MCP clients remain independent of that setting.

The SQLite database contains project data and revision history, including earlier versions of
changed or deleted data. Agent logs can also contain project context. Keep databases, their
SQLite sidecar files, backups, and logs private. Use synthetic data for bug reports and fixtures.
