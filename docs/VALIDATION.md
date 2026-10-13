# Validation record â€” 2026-10-12

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

