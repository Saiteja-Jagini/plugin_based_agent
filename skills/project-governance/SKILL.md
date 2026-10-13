---
name: project-governance
description: Diagnose connected Codex project sessions, prompt capture, project skill refresh and policy denials. Use for this plugin's setup or connection issues in any local repository, regardless of language or framework.
---

# Project governance

Lumora is the management platform, not an assumption about the repository being edited. This plugin serves independent connected projects. Never impose the Lumora platform codebase's architecture on another project.

1. Identify the current repository and nearest `.lumora-agent/connection.json`. A nested independent Git repository needs its own connection. Read applicable `AGENTS.md` and repository documentation; respect nested scopes. Do not display credentials or connection environment values.
2. Confirm the platform project ID and configured `tokenEnv`. The host process must inherit that variable. A connection file or installed plugin alone does not prove authentication or event delivery. For PowerShell, set the credential in the same terminal before starting Codex. Never copy credentials into source or tracked configuration.
3. Inspect package manifests and existing tests to understand this project. Use the CLI `profile --root PATH` when available; detection is bounded and advisory. Unknown stacks remain supported for capture and policies but need manual runner discovery.
4. Diagnose missing credential, revoked credential, unreachable service, pending outbox and policy denial separately. `doctor`, `status`, and `flush` provide different evidence. Do not bypass enforcement to repair a connection.
5. SessionStart refreshes policy and the approved project skill release. Verify sync receipts before claiming freshness. Preserve modified or unmanaged skills. Platform authors must publish a new immutable release version when instructions change. Source rules and approved skills are scoped by platform project ID.
6. Describe what is installed, authenticated, captured, delivered and actually tested separately. A captured command or prompt is not proof a test passed. Respect host permissions and explicit user authorization; surface the specific applicable policy if blocked.

One global plugin install serves many repositories; each needs its own connection and project-scoped credential. Use distinct token environment variable names when multiple projects share a host process. Unconnected repositories produce no hook capture.
