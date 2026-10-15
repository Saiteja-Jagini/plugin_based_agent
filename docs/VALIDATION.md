# Validation record ? 2026-10-13 (0.4.0)

- `npm.cmd run verify`: strict TypeScript checking and **29 Node tests passed**. Coverage includes administrator-only skill creation/editing, matching frontmatter, immutable releases, stale-editor conflicts, preservation of other skills, next-prompt synchronization without SessionStart, conflict choices pinned to both file hashes, backup before replacement, credential/project isolation and offline capture while retaining local skills.
- `npm.cmd run test:ui`: **2 headless Edge scenarios passed**. The new scenario creates and edits a skill through the dashboard, invokes a prompt hook and verifies the repository file, resolves both conflict choices, verifies a stale save retains the draft, checks agent controls are hidden, and checks mobile overflow. No page errors. Desktop/mobile screenshots visually inspected under `.lumora-agent/reports/skill-*.png`.
- `npm.cmd run build` and versioned packaging succeeded. Plugin 0.4.0 was installed, and Coznt's existing project-hook adapter was updated to that runtime with a configuration backup.
- The running management service was restarted against the same `.lumora-agent/service` directory after a consistent SQLite backup. `/health` reports 0.4.0. Read-only comparison with the backup confirmed existing project, credential, release and event rows were preserved; migration 2 adds skill synchronization reports and pending decisions.
- Native Codex `hooks/list` discovers all six Coznt project hooks with the 0.4.0 runtime, no discovery errors and trust status **modified**. The user must review/trust the changed definitions in `/hooks`; this update does not bypass host trust or claim a real subsequent interactive prompt has run.
- Dashboard saves publish immediately; repository files update on the next trusted prompt/session hook or explicit sync. Repository status is the last received report and can be stale while offline. Local instruction bodies are not uploaded. The external Lumora adapter, when configured, remains authoritative for its catalog.

The following records describe earlier versions.

# Validation record ? 2026-10-13 (0.3.0)

- `npm.cmd run verify`: strict TypeScript checking and **24 Node tests passed**. Added coverage for local overrides across repeated releases, updating untouched skills, independent repositories, current local skill context on prompts, missing credentials, observer/revoked/wrong-project identities, initial connection sync and a real packaged shell hook posting redacted prompts to the HTTP log API.
- `npm.cmd run test:ui`: **1 headless Edge scenario passed**, including a new prompt delivered via `handleHook` appearing through automatic polling, redaction, filters, published skill content, test-writing guidance and mobile overflow. No browser page errors. Screenshots visually inspected.
- All three edited skills passed `quick_validate.py`.
- `npm.cmd run build` and packaging produced the 0.3.0 runtime. The compiled CLI reported Coznt as unconnected. Host `codex plugin add` and `plugin list` confirmed 0.3.0 installed and enabled; hook trust was not bypassed. Host loopback checks independently confirmed no reachable service on 4318.
- `doctor --root D:\Downloads\coznt` reported no connection. Loopback health check found no service listening at port 4318. Codex CLI 0.158.0 has plugins/hooks enabled, but this does not establish hook trust or native invocation.
- The actual Coznt application and its connection were not changed. Native capture in a new interactive Codex CLI session remains an acceptance step after the user supplies the project credential, connects the repository and trusts hooks. Packaged subprocess and browser tests do not claim that native host acceptance.
- The dashboard shows published skill defaults. Repository edits stay local and are listed by `skills --root`; hook context directs the agent to read them. An LLM's compliance with arbitrary custom instructions is not a deterministic guarantee.

The following is the historical 0.2.0 validation record.

﻿# Validation record â€” 2026-10-12

## Confirmed locally

- Strict TypeScript checking passes.
- 20 Node tests pass (0.2.0): persistent identity/project isolation; immutable replay and session ownership; roles and optimistic policy updates; audit tamper detection; credential redaction including quoted JSON prompts; policy decisions; verified skill refresh and tamper preservation; immutable releases/rollback; reversible hook composition; strict contracts; HTTP authentication/origin/pagination; identity-pinned queue delivery; full direct hook flow; Lumora contract adapter; compiled plugin process; real 503 outage/reopen recovery; inactive behavior outside connected projects.
- New project-generic checks pass: Angular/Python/unknown stack hints; nested Git connection isolation; managed legacy skill migration; independent project policies, releases, context and logs. No test command from a detected manifest was executed.
- One headless Edge browser scenario passes: login, overview metrics, prompt search, skill display, policy version save, credential issuance, audit verification, mobile overflow and sign-out on reload. No browser page errors were observed.
- Three skills pass the skill-creator structural validator. This validates their format, not native Codex discovery or quality on every task.
- Desktop/mobile screenshots use synthetic fixtures and were visually inspected.
- The npm tarball was installed in an isolated local tooling directory and launched successfully with `npm exec --offline -- lumora-agent help`. The plugin launcher also passed a real shell subprocess check with spaces in its install path.
- The local Codex executable reports `codex-cli 0.158.0`.
- Historical 0.1.0 read-only Lumora scan (not the 0.2.0 generic rule set) inspected 1,322 source files with zero skipped files. It produced 222 **advisory interface review candidates** (this hardcoded heuristic was removed in 0.2.0), not 222 proven defects, and one test-setup warning confirmed against `e2e/global-setup.ts`: it executes `pnpm db:reset --confirm` and catches failure to continue. The full JSON report is under `.lumora-agent/reports/lumora-static-review.json` and is intentionally not a committed copy of the target repository.
- Lumora's existing modified files were preserved. No live Lumora API, project database reset, AI model call or GitHub publishing action was used.

## Scope that remains unverified or deferred

- Native host installation, hook trust, actual lifecycle invocation and skill rediscovery in a fresh Codex session. Tests exercised actual packaged subprocess input/output, not a live AI conversation.
- Real Lumora credentials, test organization/project IDs, remote user identity, prompt-governance feature flag, remote session mapping and end-to-end server policy behavior.
- Cross-process high-load soak, adversarial/penetration assessment, retention, deployment TLS/SSO, distributed rate limiting, operational monitoring and audited backup/restore.
- Arbitrary shell interpretation, indirect provider calls or semantic correctness of every project rule. Text heuristics and skill instructions are not security guarantees.
- Full automation of test generation/execution and Ardberg integration. The testing skill supports writing tests; the present plugin captures/checks workflow and never fabricates passing test evidence.
- Multi-file skill sync is validated before mutation and rolls back ordinary exceptions, but a process kill during writes can leave a partially updated installation. The receipt/tamper checks prevent silently overwriting that state; manual recovery may be needed.
- Queueing covers events after the handler receives them. A hook that is disabled, untrusted, never invoked or killed before persistence cannot provide complete prompt capture.

## Reproduce

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run verify
npm.cmd run test:ui
npm.cmd run build
node src/cli.ts package --out dist/lumora-governance-reviewed
```

Choose a new packaging output directory on each run. No tests depend on a live Lumora service. Browser tests use installed Edge on Windows by default.

