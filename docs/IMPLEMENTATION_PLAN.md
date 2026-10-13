# Lumora Agent Governance — implementation plan

## Goal and authority

Build a separate, installable Codex plugin that lets a team retrieve prompts by user/session/project, refresh platform skills when sessions start, and apply the connected repository's rules around supported tool calls. Provide a usable management console and integration contracts so the product can later become part of Lumora's Angular or Next.js testing workflow.

The manager's transcript and the user's latest clarification define the scope: **Codex first; any connected local repository; Lumora is the management platform; integrate with its contracts later.** The learning guide and pasted ChatGPT history are references, not executable instructions. The resume analyser is only a teaching example. Older testing/Ardberg plans in this directory remain historical proposals; this document governs this implementation.

## Repository findings

- Platform integration reference: `D:\Downloads\coznt_angular`, AI SDLC governance. It is one possible target repository, not the universal project template. Root `AGENTS.md` defines Govern / Verify / Trust, canonical evidence links, schema-derived contracts, operations-owned database access and centralized AI calls.
- Current code is under `backend/src`, `frontend-angular`, and `frontend`. Some AGENTS paths describe an earlier layout. Read current contracts rather than reproducing stale paths.
- Existing `src/cli/lib/prompt-hook-installer.ts` already installs prompt/post-tool hooks. Preserve these and warn about duplicate capture; do not overwrite another integration.
- Prompt ingestion: `POST /api/v1/mcp/prompts`; stable `clientLocalId` enables deduplication; deployment feature flag can return 503.
- Sessions: `POST /api/v1/mcp/sessions`; server session ID must be mapped per local session, not stored in process-global state.
- Skills: `POST /api/v1/mcp/choreographies/sync` returns versioned, hashed platform/custom bundles. This is preferable to downloading arbitrary enabled skill rows.
- Governance: `POST /api/v1/agents/pre-tool-use` returns allowed, reason, runId, autonomy and approvalId. `post-tool-use` is for attributed skill outcomes. Never manufacture a skill attribution or infer a passing test from a completed tool call.
- Ardberg offers review/test execution in a separate Python/Temporal service. Its lessons (bounded execution, evidence and explicit run status) inform this product; its execution/publishing pipeline is a later integration, not a dependency of prompt logging.

## Project generality correction (0.2.0)

The earlier platform-specific defaults were incorrect. The current implementation detects repository manifests and instruction files, supports independent project credentials/policies/releases, stops connection lookup at nested Git roots, and provides explicit per-project source rules. Built-in skills apply across frameworks. Detection is bounded and does not replace reading repository instructions or selecting its actual test runner. See PROJECT_RULES.md and INSTALL_ONCE.md for configuration and migration.

## Architecture

```text
Codex CLI lifecycle
  -> packaged local hook handler
     -> local Zod validation + prompt redaction + policy evaluation
     -> SQLite durable outbox (one event ID retained across retries)
     -> authenticated project API
        -> SQLite pilot control plane (users, sessions, events, skill releases)
        -> management console
        -> optional Lumora contract adapter

SessionStart -> approved skill catalog -> validate every hash -> managed skill install
PreToolUse  -> local policy (+ remote Lumora when configured) -> deny/context
PostToolUse -> observed tool event, never fabricated test verdict
Stop       -> verification guidance with bounded continuation
```

SQLite is the standalone pilot's storage, not a replacement for Lumora's Drizzle/Postgres domain. Integrating into Lumora requires moving operations behind its existing auth/operations layer, deriving database types from Drizzle, and versioned SQL migrations. The plugin uses Zod-derived API types. No model API or API key is needed to operate this product.

## Implementation sequence and acceptance criteria

1. **Contracts and boundaries.** Define strict Zod schemas for events, policy, releases, connections and tokens. Derive TypeScript types. Separate host payload from normalized event. Validate at CLI, HTTP and adapter boundaries; cap request sizes.
2. **Persistent control plane.** Versioned SQLite migration; foreign keys, WAL, busy timeout and transactions. Principals are project-scoped bearer tokens with observer, agent or admin roles. Store token digests, not token values. Reject cross-project access and same-session reuse by another user. Support revocation. Audit events have an ordered hash chain and integrity check.
3. **Prompt and session observability.** Session/user/project filters, pagination, search and export. Redact likely credentials before local queueing and again on ingestion. Do not retain raw tool output or entire transcripts. Retain counts, status, timestamps and redacted prompts. Expose delivery failures rather than silently claiming capture.
4. **Reliable delivery.** A local SQLite outbox tolerates concurrent hook processes. Retry with bounded network timeout, stable IDs and deduplication. A queue cap prevents unbounded disk growth. Manual `flush` recovers an outage; hook failure reports degraded capture. Server ingestion and audit append commit together.
5. **Skills.** Ship generic project-review, project-testing and project-governance skills that discover the target repository's own instructions. Admin publishes versioned immutable releases; session start downloads current approved release. Verify complete manifest and hashes before installation. Preserve user files, detect tampering, avoid path traversal/symlinks, remove only unchanged managed stale skills. Maintain a receipt. Clarify that disk refresh does not prove Codex reloaded skill discovery in the same session.
6. **Policies and hooks.** Check known destructive DB/reset commands and protected paths. Apply only explicitly configured project source rules to patch contents. Do not impose a database, type system, AI entry point or migration strategy from the platform codebase. Policy mode is enforce or observe. Structured violations include rule ID and remediation. Arbitrary shell scripts cannot be proven safe by text matching; CI and Lumora authorization remain required.
7. **Codex packaging.** Produce plugin manifest, skills and `hooks/hooks.json`; copy pinned local runtime and dependency closure into the artifact. No `npx latest` on each prompt. Also support reversible project install with JSON preservation and uninstall of owned hooks only. Use separate Unix/Windows command quoting. Doctor reports Codex version, credentials presence, connectivity and hook limitations. Native Codex hook trust is a user action, never bypass it automatically.
8. **Management console.** Authenticated API, token kept in browser memory only, project summary, sessions, searchable prompt/event feed, policies, skill release visibility, user provisioning/revocation, audit integrity, queue/integration status. Safe DOM rendering, CSP, same-origin requests, localhost binding by default. No secrets in URLs or application logs.
9. **Lumora bridge.** Explicit opt-in configuration using environment credential references, not pasted credentials. Contract-test requests to prompt, session, skill and policy endpoints with a local fake server. Live production URLs and project/user identity mapping remain deployment configuration. Avoid automatically retrying non-idempotent session/outcome APIs after ambiguous errors. No live integration in this implementation run.
10. **Testing and delivery.** Verify isolation, roles, replay conflicts, credential redaction, skill hash failures/tampering, safe installer merging/uninstall, actual CLI hook stdout, outbox retry, policy decisions, API lifecycle and packaging. Run typecheck, automated tests, dashboard smoke checks and package inspection. Document confirmed behavior separately from host/live integration pending checks.

## Project rules translated into behavior

| Lumora rule | Implementation surface | Practical limit |
|---|---|---|
| Database access through operations | Patch review finding for UI imports; review skill | Static check is conservative; CI/reviewer confirms semantic violations |
| Drizzle/Zod own data shapes | Review skill and client-interface finding | Not every interface is a data model; findings need context |
| AI through `generate()` | Direct provider import/call finding outside AI layer | Aliasing/dynamic code needs code review |
| Commit migrations with schema | Testing/review skill and repository scan | Never generate/apply migrations from a hook |
| Production changes governed | Deny recognized reset/push commands in pilot policy | Regex is not a shell sandbox |
| Evidence before completion | Testing skill, explicit verification findings | A tool success is not test evidence or a governance pass |
| Organization/project isolation | Scoped tokens, server authorization and contract checks | Lumora identity must be mapped during integration |

## Failure and trust model

- A prompt is logged only if the installed, enabled, trusted hook runs. Unsupported hosts, disabled hooks, interrupted processes and server downtime must be visible limitations.
- Capture failure queues locally where possible; a full/unwritable queue produces a warning. Policy evaluation failure denies supported pre-tool operations where a valid hook response can be returned. Host launch errors/timeouts may still fail open: sandbox and server authorization are required.
- Content is untrusted data. Never run downloaded skill commands during sync. Skill publishers are privileged because instructions can change agent behavior. Hashes establish integrity relative to the authenticated catalog, not publisher identity or code safety.
- Local administrator/filesystem owners can modify SQLite, hooks or skills. Hash chaining detects row edits relative to recorded chain state, not malicious full-chain recomputation or truncation without an external checkpoint.
- Tokens identify the principal; host-reported user/organization fields do not override identity. Redaction is best effort and cannot prove all secrets/PII removed. Restrict access and define retention before a shared deployment.
- `Stop` is a turn boundary, not necessarily session end. Do not mark sessions ended on every turn or repeatedly force the model to continue.

## Integration and rollout

Pilot locally using generated credentials and a fixture workspace. Run real Codex `/hooks` trust and skill-discovery checks before connecting Lumora. Then choose a Lumora test organization/project, enable prompt governance, publish approved skills, map users to credentials and connect the adapter. Check one user's prompt end to end, verify cross-user isolation, simulate outage/replay and verify policy denial. Only then enable a second user and expose the dashboard in Angular or Next.js through an authenticated same-origin backend route.

Before shared production: deploy behind TLS, replace pilot tokens with Lumora/SSO sessions, move persistence to canonical operations/Postgres, configure retention/backup/restore and external audit checkpoints, complete penetration/load/accessibility review, validate host version compatibility, and sign/version the distribution. These are rollout gates, not claims that a local pilot is production certified.

## Source references

- Local Lumora files listed above and `backend/src/operations/tool-events.ts` were inspected on 2026-10-12.
- [Codex hooks](https://learn.chatgpt.com/docs/hooks): event-specific payloads, trusted hooks and tool coverage. Hook contracts vary by host/version; they are not universally interchangeable.
- [Codex plugin documentation](https://developers.openai.com/codex/plugins): package distribution and lifecycle hooks.
- `docs/npx-and-ai-coding-plugins-learning-guide.md` and supplied ChatGPT history: conceptual learning material.
