# Lumora Testing: native workspace, Ardberg engine, and ChatGPT plugin

Implementation plan, 12 October 2026.

## 1. Product decision and scope

Build **Lumora Testing**, a testing and PR-verification capability owned by Lumora. It has three clients: a native Angular workspace inside Lumora, a ChatGPT plugin with an interactive MCP App, and an optional Codex skill/local integration. All clients use the same authorized Lumora operations, execution records, and evidence.

Reuse Ardberg's Python execution/review engine behind Lumora. Keep its existing Temporal orchestration initially. Bring the engine into the Lumora source/deployment structure as a private service after establishing a versioned adapter. Build the native Angular experience around the current product rather than embedding Ardberg's entire Next.js dashboard.

This is the recommended interpretation of “keep the testing tool inside Lumora”: one product, one account/project context, one evidence system, with an independently deployed execution service. A ChatGPT plugin is an additional interface to that product; it does not run repository tests inside a chat panel.

Primary workflow:

```text
Lumora Angular workspace       ChatGPT MCP App       Codex skill
            \                      |                    /
             -> Lumora authorized testing operations <-
                         |
             execution records + contracts + outbox
                         |
                 private Ardberg service
                         |
                   Temporal workers
                         |
             disposable repository test environments
                         |
        native checks + focused probes + generated test patches
                         |
          results / findings / artifacts / evidence links
                         |
             same state visible to all three clients
```

No implementation, deployment, account linking, test execution, or database changes were performed for this plan. It is based on source/configuration inspection. Business requirements and host capabilities still have explicit acceptance gates; no plan can guarantee all defects will be found.

## 2. How this updates the earlier plan

The [earlier framework plan](LUMORA_TESTING_FRAMEWORK_IMPLEMENTATION_PLAN.md) remains useful for Lumora test coverage, baseline checks, reporting semantics, and CI. This plan supersedes its initial architecture where it proposed building a new standalone runner from scratch. Ardberg already contains substantial runner/orchestration functionality worth adapting.

The learning guide contributes skills, hooks, MCP, plugin packaging, and NPX concepts. Your video summary contributes the idea of a native-feeling ChatGPT UI. The inspected repositories determine what to reuse and what remains missing. The original video URL was not provided; the implementation assumptions about ChatGPT were checked against current official documentation rather than inferred from the summary alone.

Current OpenAI documentation describes sidebar apps, conversation panels, settings, deep links, selected-context interactions, and onboarding. Support varies by host/account; check the target hosts before promising every surface. [Plugin extensions](https://developers.openai.com/plugins/build/extensions).

## 3. Inspection record and actual repository context

| Repository | Location | Inspected revision | State |
|---|---|---|---|
| Lumora | `D:\Downloads\coznt_angular` | `7356dbf` | Existing dirty files; lockfile deleted locally |
| Ardberg | `D:\Downloads\ardberg_framework` | `7cf7643` | `git status --short` returned no changes |
| Guide/plans | `D:\Downloads\plugin_based_agent` | Planning workspace | Holds guide and implementation artifacts |

Lumora's existing modifications are `backend/src/automations/skills/code-generator-skill/SKILL.md`, `frontend-angular/tsconfig.app.json`, and deleted `pnpm-lock.yaml`. Preserve these changes; resolve the dependency state deliberately before creating a reproducible baseline.

### Lumora: available building blocks

| Area | Actual implementation | Use in this design |
|---|---|---|
| Product UI | Angular 22, TypeScript, Spartan/PrimeNG/Tailwind | Native testing pages and project navigation |
| Other UI | Next.js frontend also exists | Determine support scope; do not create a third full dashboard |
| Backend | TypeScript, Node HTTP server, operations layer | Public authorization and business operations |
| Data | PostgreSQL, Drizzle, Zod, shared contracts | Canonical product records and typed APIs |
| Identity | Better Auth, role/project/organization logic | User identity, tenant isolation, capabilities |
| Existing queue | pg-boss in current code | Delivery/outbox triggers; not a duplicate Temporal workflow |
| Test results | `test_runs` with passed/failed/errored/skipped | Preserve as measured suite-result records |
| Evidence | Existing `evidence_links` operations | Link results to plan artifacts and governance |
| MCP | Local stdio server and tool registry | Reuse tool business functions; add a hosted transport safely |
| Existing testing tools | `generate_tests`, `update_test_result` | Reconcile contracts; avoid parallel result APIs |
| Existing PR review | `pr-summary-review.ts` | Coordinate triggers/publication so two bots do not conflict |
| Verification | Vitest, Angular test builder, Playwright, `pnpm verify` | Baseline checks and reusable generated tests |

Sources: [package](../coznt_angular/package.json), [Angular package](../coznt_angular/frontend-angular/package.json), [test-run schema](../coznt_angular/backend/src/db/schema/test-run.ts), [evidence operations](../coznt_angular/backend/src/operations/evidence.ts), [MCP entry](../coznt_angular/src/mcp/bin.ts), [MCP session](../coznt_angular/src/mcp/session.ts), [PR review task](../coznt_angular/backend/src/automations/tasks/pr-summary-review.ts).

### Ardberg: available building blocks

| Area | Actual implementation | Reuse decision |
|---|---|---|
| API | FastAPI, Python, Pydantic | Private engine adapter, with added service authentication |
| Workflow | Temporal + LangGraph | Preserve execution semantics and replay compatibility |
| Persistence | SQLAlchemy; run/event/artifact records | Internal engine state, not the public tenant authority |
| Repository intake | GitHub App; pinned head/base; PR context | Reuse source pinning behind Lumora repository permissions |
| Baseline | Explicit `.ardberg/setup.json`; conservative fallback | Preserve model-independent setup/native checks |
| Review | Expected behaviors, code critique, runtime planning | Reuse as review mode |
| Execution | Disposable Docker, PostgreSQL fixtures, browser/HTTP/script probes | Adapt and harden for hosted multi-tenant use |
| Test generation | Existing explicit `testing` workflow | Preserve patch generation as a distinct mode |
| Evidence | Confirmed/potential/unverified findings; optional base comparison | Preserve separation of facts and inferred concerns |
| Artifacts | Durable binary/text records with local restoration | Reuse semantics; move public artifact ownership to an adapter |
| UI | Next.js, React, workflow visualization, interactive preview | Reuse UX concepts; translate into Angular and a small MCP UI |
| Model calls | Python OpenAI structured output client | Replace integration boundary with Lumora's governed model gateway |

Sources: [Ardberg README](../ardberg_framework/README.md), [dependencies](../ardberg_framework/backend/requirements.txt), [baseline](../ardberg_framework/backend/app/baseline.py), [setup recipe](../ardberg_framework/backend/app/setup_recipe.py), [review](../ardberg_framework/backend/app/review.py), [workflow](../ardberg_framework/backend/app/workflow.py), [runtime](../ardberg_framework/backend/app/review_runner.py), [generation](../ardberg_framework/backend/app/agents.py), [artifacts](../ardberg_framework/backend/app/artifacts.py), [model client](../ardberg_framework/backend/app/llm.py).

Observed Ardberg limits include batches of at most three requirements per model request, two planning requests in flight, a 12-focused-probe cap, and explicit unverified gaps when work cannot be completed. Preserve these as configurable bounded limits, not claims of complete PR coverage. Baseline execution in `baseline.py` is authoritative even where older README passages describe earlier behavior.

## 4. Gaps that must be addressed before integration

1. **Ardberg's API is currently local and has no multi-user authentication.** Its run model has no Lumora organization/project fields. It cannot be exposed directly as a public plugin backend.
2. **Lumora MCP is currently stdio.** `session.ts` uses process-global state. Do not share that mutable state between hosted users or conversations.
3. **ChatGPT access requires a reachable MCP transport.** A local Windows path or NPX command does not make a hosted ChatGPT client able to reach the service.
4. **Existing result linkage differs across layers.** `update_test_result` accepts `planId`, while storage validates `projectTaskId`; add a contract regression test and one normalization boundary.
5. **`generate_tests` delegates to a registered `test-author` skill.** That is not evidence that a file-generation/execution service is already integrated.
6. **Lumora browser configuration is stale.** It refers to missing recruitment-flow specs. Its global setup resets data and continues after errors. Replace the path used by the new harness with isolated current-product setup.
7. **The local lockfile is missing.** Reproducible dependency installation is blocked until the intended lockfile state is settled.
8. **Runtime compatibility needs work.** Ardberg's runner image uses Playwright 1.63.0; Lumora declares `@playwright/test ^1.59.1`. Resolve actual versions and match browsers to packages; never overwrite project dependencies to hide incompatibility.
9. **Temporal images use `latest` in Ardberg Compose.** Pin deployment images/digests and test replay before production rollout.
10. **Publication defaults differ from the intended embedded workflow.** Ardberg defaults `publish_to_github` to true. The integrated initial default will be false, with explicit project policy and user intent for external publishing.
11. **Existing documentation is partly outdated.** Lumora's current worker imports pg-boss; older text says pgmq. Requirements must come from approved specifications and verified behavior, not blindly copied docs.
12. **Ardberg preview is a local trusted-code feature.** Public preview hosting requires a distinct isolation/origin/auth design; it is deferred from the first release.

These are integration gaps observed in source. They are not a claim that all product functionality has been tested or that every listed issue is a demonstrated runtime vulnerability.

## 5. Supported product modes

Expose three explicit modes with clear meanings:

| Mode | What runs | Output | Writes to repository |
|---|---|---|---|
| Baseline verification | Existing tests, type checks, builds | Measured suite results and setup gaps | None |
| PR review | Baseline + requirements/code analysis + focused probes | Evidence-bound findings and unverified areas | None |
| Generate tests | Requirements + existing coverage + generated tests + validation | Test-only patch, results, uncovered cases | Only through a later explicit apply/PR action |

Ardberg currently has `critique` and `testing` workflows. Baseline-only is a proposed new service operation extracted from the existing baseline branch. Do not advertise it as a current API mode until implemented.

A review's temporary runtime probe is not automatically a durable regression test. Offer “Create regression test from this finding” as a separate action that enters generation mode, validates the assertion, and returns a reviewable test patch.

Two outcomes must remain separate: **execution completion** and **verification verdict**. Completed execution can contain failing tests or unverified requirements. A passed baseline does not prove a PR's new behavior is correct.

## 6. User journeys

### Inside Lumora

1. Open a project and choose Testing.
2. Select a registered repository and PR/commit; display immutable head/base revisions.
3. Choose baseline, review, or generate-tests mode.
4. Add optional expected behavior or choose an existing `test_plan` artifact.
5. See requirements, setup recipe, required services, run limits, and source-data processing disclosure.
6. Start the execution. Display stage progress, independently progressing baseline work, and remaining gaps.
7. Open findings, test results, logs, traces/screenshots, generated patch, and linked evidence.
8. Retry the same pinned source as a new attempt, or start a new execution for a newer commit.
9. Apply/export a validated test patch or publish a report only through the separately authorized action.

### Inside ChatGPT

1. Connect Lumora through account linking.
2. Choose an accessible organization/project in the plugin's onboarding UI.
3. Ask, for example: “Review PR 42 for this project and show the failures.”
4. The model calls the same authorized preparation/start/read operations as the native UI.
5. A compact run panel shows progress, scope, verdict, and findings.
6. Selecting a finding provides bounded model-visible context so “Explain this” refers to the correct run/finding.
7. Open detailed evidence or the native Lumora execution page when needed.

The panel may live beside a conversation or in a sidebar surface where supported. Durable results remain on Lumora's server when the conversation or panel closes. MCP Apps UI is rendered in a sandboxed iframe and communicates through the host bridge; “native feel” does not mean arbitrary code runs inside ChatGPT itself. [MCP UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

### Inside Codex

A skill can retrieve an authorized test plan, inspect a local checkout, write tests, and run the existing local checks. It must label local uncommitted-source results separately from an execution on a pinned remote commit. Optional result upload uses a dedicated scoped ingestion operation and preserves the provenance distinction.

## 7. Architecture decisions and ownership

| Concern | Owner | Rule |
|---|---|---|
| User/org/project/repository permissions | Lumora backend | Never inferred by the model or widget |
| Public execution identity | Lumora | Stable ID used by native UI, MCP, and reports |
| Long-running workflow | Ardberg/Temporal | One workflow owner per execution attempt |
| Dispatch reliability | Lumora transactional outbox | Retry submit with a stable idempotency key |
| Source snapshot | Source adapter + verified repository binding | Pin commit before execution; record checksums |
| Sandbox lifecycle | Dedicated runner infrastructure | Application backend does not execute PR code |
| Business result/evidence | Lumora operations | Reuse `test_runs` and evidence links |
| Internal workflow history | Temporal/engine database | Not directly exposed as a public tenant API |
| Model access | Lumora governed generation gateway | Existing model routing/audit rules apply |
| Public tool transport | Authenticated HTTP MCP gateway | Request-scoped principal and context |
| UI | Angular + compact MCP App | Share contracts and presentation models |

Keep Python/Temporal initially because porting the engine would expand risk and duplicate existing behavior. A later TypeScript rewrite needs its own parity/migration case. Keep pg-boss for Lumora triggers/outbox delivery if suitable; do not coordinate the same stages in both pg-boss and Temporal.

## 8. Proposed source layout inside Lumora

These are proposed paths, not files already created:

```text
coznt_angular/
  packages/contracts/src/testing/
    schemas.ts
    index.ts
  packages/testing-view-models/
    src/
  backend/src/
    db/schema/testing/
    operations/testing/
      executions.ts
      attempts.ts
      findings.ts
      artifacts.ts
      policies.ts
      result-ingestion.ts
    routes/testing.ts
    lib/testing-engine/
      client.ts
      contracts.ts
      reconcile.ts
    automations/tasks/
      dispatch-testing-execution.ts
      reconcile-testing-execution.ts
    automations/agents/testing/
      <task>/definition.ts
      <task>/prompt.ts
  frontend-angular/src/app/
    core/api/testing.ts
    features/testing/
      testing-page.ts
      new-execution-page.ts
      execution-detail-page.ts
      findings-panel.ts
      evidence-viewer.ts
      test-patch-viewer.ts
      testing-settings-page.ts
  services/testing-engine/
    app/                         # adapted Ardberg Python modules
    tests/
    requirements.txt
    contract/                    # generated versioned boundary schemas
  services/testing-runner/
    Dockerfile
    profiles/
  src/mcp/
    tools/testing/
    context.ts                   # request/session scoped context
    http/                        # or a separate gateway package if isolation is cleaner
  plugins/lumora-testing/
    plugin.json
    skills/test-lumora/SKILL.md
    web/                         # compact MCP App HTML/TS/CSS bundle
    resources/
  scripts/testing/
  deploy/testing/
  docs/testing/
```

Import engine source through a reviewed commit retaining provenance and license notices; do not copy `.env`, `.data`, local caches, credentials, node_modules, or generated runs. Preserve Ardberg's original repository as a reference during parity testing. Inspect ownership/license before redistributing copied code.

Keep one canonical schema definition for the service boundary in shared contracts. Derive TypeScript from Zod and generate a versioned JSON schema/client representation for Python. Native engine models may remain Pydantic, but round-trip contract tests must prevent independent field drift. Database types remain derived from Drizzle.

## 9. Data model and migrations

Reuse existing `test_plan` artifacts for strategy and requirements, `test_runs` for actual suite measurements, and `evidence_links` for proof attachment. Add execution-oriented records because `test_runs` currently cannot represent queued, running, retrying, cancelled, or partially reviewed work.

Proposed minimum records:

| Record | Essential fields |
|---|---|
| `testing_executions` | ID, org/project/repository IDs, initiator/source, mode, PR/ref, pinned head/base SHA, plan ID, input snapshot, policy/config hashes, timestamps |
| `testing_attempts` | ID, execution ID, attempt number, workflow ID, lifecycle state, stage, verdict, cancellation request, heartbeat/deadline, engine version, error category |
| `testing_events` | Execution/attempt, sequence, event type, stage, status, bounded payload, event time, received time |
| `testing_findings` | Execution/attempt, stable fingerprint, requirement ID, classification, severity/confidence, source location, expected/observed, evidence references, triage state |
| `testing_artifacts` | Execution/attempt, media type, storage key, size, digest, sensitivity class, retention, provenance |
| Existing `test_runs` | Associate execution/attempt and suite identity; keep measurement counts/status separate |

Store patch manifests and validated patch files as typed artifacts unless query requirements justify a dedicated table. Store user policy/preferences through existing settings patterns if available; add a new primitive only where necessary.

Input snapshots include requirement/plan revision, selected recipe and its source revision, registered repository ID, resolved SHAs, framework versions, source scope, and data-processing/publishing policy. Do not store long-lived credentials there.

Constraints: organization ownership on every public record; unique `(execution_id, attempt_number)`; unique engine workflow mapping; unique `(attempt_id, event_sequence)`; unique suite-result ingestion key; foreign-key relationships consistent with organization/project; indexed project/time/status lookups.

Normalize `planId` to the currently stored `projectTaskId` at one documented API boundary. Preserve existing clients and add migration/contract tests. Never treat a plan FK alone as a substitute for the canonical evidence link.

Create versioned Drizzle migrations with backward-compatible nullable fields first. Backfill safely, validate constraints, then enable dependent features. Run schema-drift checks that detect both tracked diffs and new untracked migration files. Do not rewrite historical results to look like they were produced by the new engine.

## 10. Lifecycle, verdicts, retries, and idempotency

Proposed attempt lifecycle:

```text
queued -> preparing -> running -> assessing -> completed
    \         \          \           \-> errored
     \--------- cancellation_requested -> cancelled
```

Stages are granular events, not additional competing state machines. Record baseline and focused-review sub-outcomes independently.

Verdicts: `passed`, `failed`, `inconclusive`, `not_applicable`. Also retain scope coverage and required-suite status. `completed` is not a verdict. A missing report, required zero-test discovery, unavailable fixture, or failed planner cannot produce an unqualified pass.

Retry creates an immutable new attempt on the same pinned source. Previous artifacts remain available. Replanning is explicit and records a new plan hash. A newer PR head creates a new execution. Only the current attempt may update the execution's displayed summary, using optimistic concurrency/version checks.

Public start calls require an idempotency key or server-issued preparation token. Submit transaction: create execution + outbox message atomically, then dispatch outside the HTTP request. Engine workflow ID includes the stable execution/attempt IDs; repeated delivery cannot start duplicate work.

Events use monotonically increasing attempt-local sequence numbers, deduplicated ingestion, and resumable reads. Worker callbacks are authenticated and bound to attempt identity. A reconciler detects dropped callbacks and refreshes state; clients can reconnect without losing progress.

Cancellation is a request with its own acknowledged state. Propagate it to Temporal and child processes, capture available evidence, and clean owned resources. Ignore late completion from a superseded/cancelled attempt unless it is retained as historical evidence. Define timeout/retry budgets by stage; never retry source publication blindly.

## 11. Public HTTP API and private engine contract

Proposed Lumora API, following the existing route conventions:

| Operation | Proposed endpoint | Behavior |
|---|---|---|
| Capabilities/settings | `GET /api/v1/projects/:id/testing/capabilities` | Allowed modes, repositories, limits, permissions |
| Prepare scope | `POST /api/v1/projects/:id/testing/prepare` | Resolve source/requirements, return immutable preparation ID |
| Start | `POST /api/v1/projects/:id/testing/executions` | Validate prepared scope; return 202 + execution ID |
| List | `GET /api/v1/projects/:id/testing/executions` | Cursor pagination and filters |
| Read | `GET /api/v1/testing/executions/:id` | Authoritative summary and available actions |
| Events | `GET /api/v1/testing/executions/:id/events?after=...` | Cursor reads; native SSE optional |
| Findings | `GET /api/v1/testing/executions/:id/findings` | Paginated evidence-backed findings |
| Artifact | `GET /api/v1/testing/artifacts/:id` | Auth check then controlled download |
| Cancel/retry | `POST /api/v1/testing/executions/:id/cancel` or `/retry` | Idempotent action/new attempt |
| Triage | `PATCH /api/v1/testing/findings/:id` | Audit disposition; preserve original evidence |
| Export/apply patch | Distinct execution patch endpoints | Separate artifact download from repository mutation |

Use existing operation/authorization infrastructure and one CRUD boundary per primitive. Route handlers stay thin. Do not create separate storage paths for requests originating in ChatGPT.

Private engine API must implement submit, status, events, artifact retrieval, cancellation, and retry/resume. Use service credentials with explicit issuer/audience, short lifetime, and narrow task claims; do not forward the end user's token as an all-purpose engine credential. Validate method/body size, identifiers, schema version, and deadlines.

Before every action, Lumora verifies membership, capability, repository binding, source permission, plan ownership, and project policy. The engine verifies its service contract and job ownership. Org IDs submitted by a widget or model are selection inputs, never authentication evidence.

Errors have stable machine codes such as `SOURCE_UNAVAILABLE`, `SETUP_BLOCKED`, `SCHEMA_MISMATCH`, `AUTH_REQUIRED`, `FORBIDDEN`, `CONFLICT`, `ENGINE_UNAVAILABLE`, and `QUOTA_EXCEEDED`, with user-safe messages and correlation IDs.

## 12. Adapting Ardberg without losing its useful behavior

Preserve these invariants from the inspected engine:

- Pin source before baseline or AI analysis.
- Start baseline work independently of model-dependent planning.
- Run later independent checks even when another check fails.
- Keep actual setup/native results when a model call fails.
- Preserve explicit unsupported/blocked/unverified outcomes.
- Compare base and head only when fixtures and observations are comparable.
- Keep source analysis, runtime observation, and manual observation separately attributed.
- Release containers and temporary services on success, error, and cancellation.
- Retain prior attempts rather than overwriting their evidence.

Build adapters in this order: execution identity/context; authenticated service API; source/GitHub access; requirements/context; governed model calls; events; artifact storage; result publication; cancellation/reconciliation.

Ardberg currently calls `responses.parse` directly from `llm.py`. For integrated runs, route fixed, registered testing tasks through a private Lumora generation operation that uses its existing `generate()` path. Maintain prompts, output schemas, token usage, cost limits, retries, and attribution there. The engine submits a registered task ID and bounded context; it cannot choose arbitrary credentials, endpoints, or unrestricted output schemas. Keep deterministic baseline execution independent of this gateway.

Keep Temporal workflow changes versioned and replay-test representative histories. Avoid moving non-deterministic network calls into workflow code. Persist run IDs/checkpoints before external actions. Reconcile current deployment bootstrap/create-table behavior with explicit production migrations.

## 13. Source access, requirements, and context construction

Resolve repositories through Lumora's registered repository and integration records. Permit only configured GitHub hosts initially. Validate PR belongs to the selected repository; enforce installation/user access and fork policy. Avoid unrestricted user-supplied download URLs.

Fetch archives/git objects at exact SHAs through a trusted source broker. Verify extraction paths, symlinks, archive size, and source identity. Credentials used to fetch source must not appear in the checkout or sandbox environment. Private package access requires a separate scoped dependency mechanism, not reuse of GitHub/model secrets.

Context assembly records: PR description and commits; user intent; approved project artifacts; plan/test-plan revision; changed files and traced callers; discovered test configurations; setup recipe. Include content hashes and source locations. Bound file sizes and model input budgets, exclude secrets/generated directories, and state truncation as a coverage limit.

A requirement inferred only from implementation is a hypothesis until corroborated. Record conflicts between code, tests, and older documents. Missing requirements should leave the affected behavior unverified while independent cases proceed.

For the initial Lumora target, author and validate `.ardberg/setup.json` with its actual commands. Treat the PR-supplied recipe as executable untrusted source: project policy controls whether changed setup commands can run, and only sandboxed runners execute them.

## 14. Lumora execution recipe and test layers

Baseline commands already exist:

| Layer | Existing command |
|---|---|
| Backend types | `pnpm type-check:backend` |
| Backend tests | `pnpm test:backend` |
| Root tests | `pnpm test` |
| Angular build | `pnpm build:angular` |
| Angular tests | `pnpm test:angular` |
| Backend ownership | `pnpm verify:backend-ownership` |

Add explicit discovery for tests beside MCP source; existing root/backend includes do not cover them. Track whether a file is selected, excluded intentionally, or orphaned. Avoid duplicating aggregate `pnpm verify` after identical constituent checks.

Use a pinned supported Node/pnpm runtime and validated lockfile. Keep Angular tests under its actual Angular builder rather than forcing direct generic Vitest invocation. Teach generation adapters about TestBed, HTTP testing, shared contracts, Angular spec paths, and monorepo working directories. A generic “JavaScript module” adapter does not automatically understand Angular compilation.

Use structured reporters and preserve exit codes, setup errors, skipped tests, retries, and missing output. Report line/branch/function coverage separately and with denominators; no fabricated combined percentage across overlapping suites.

For integration/browser checks: provision a disposable PostgreSQL instance with the schema/operational mode accepted by Lumora; apply committed migrations; seed test roles and two organizations; start backend and Angular on dedicated ports; configure the proxy; wait for readiness. Start the worker only for tests needing asynchronous effects.

The existing Angular dev server uses port 3000 and proxies to backend 3028. Provide a test profile rather than assuming these ports are free or pointing at owned processes. The root `start` starts Next.js, so it is not the Angular test-server entry. Avoid development scripts that stop unrelated local processes.

Replace the old E2E setup path for new runs. Never invoke its general data reset against an unspecified database. Database identity and an ownership marker must both match before cleanup.

First regression feature: authentication/session expiry/project access. Expand to projects, plan transitions, governance gates, tenant boundaries, evidence, integrations, worker behavior, CLI/MCP, SSR, and URL-state behavior according to the previous plan's risk matrix.

## 15. Runner isolation, dependencies, and resource limits

PR source, package install scripts, generated test code, and setup recipes are executable inputs. Run them on dedicated execution hosts separated from Lumora's application/database infrastructure.

Preserve Ardberg's CPU/memory/PID limits, dropped capabilities, and no-new-privileges settings, then validate the complete boundary. A Docker container is not by itself a sufficient isolation claim for arbitrary hostile tenants. Choose hardened dedicated workers or stronger sandbox isolation according to the repositories admitted to the service.

Required controls:

- No Docker socket, host credential directories, production database URLs, OAuth refresh tokens, GitHub App keys, or model keys inside repository containers.
- Fetch source outside the container; provide only the checked source snapshot and generated short-lived test fixture credentials.
- Separate dependency installation from execution networking. Permit only required package registries during installation where feasible, then use an isolated service network. Record any bounded repair that temporarily needs installation access.
- Scope package caches by appropriate trust boundary; validate integrity and prevent PR jobs from poisoning globally trusted caches.
- Set exact runner images/digests, supported runtime versions, per-step timeout, total deadline, disk/artifact limits, CPU/memory/PID caps, and tenant concurrency quotas.
- Use an unprivileged execution user where supported; test browser compatibility rather than silently granting broad privileges.
- Track every container, network, volume, process, and lease by execution/attempt ID. Cleanup only owned resources.
- Run a sweeper for expired leases and interrupted jobs; test recovery after worker/API/host restart.
- Restrict outbound requests and validate redirects/DNS targets to prevent probes from reaching metadata services or unrelated internal endpoints.

Ardberg's repair agent must remain bounded and evidence-based. In the hosted integration, disable automatic repair initially or allow only reviewed dependency-repair actions; it cannot expand tenant/network permissions. Save repair commands and outputs as evidence. A repair that changes the tested dependency set must be visible in reproducibility metadata.

Compatibility acceptance is especially important for Lumora: migration extensions, Node 24 Windows wrapper behavior versus Linux image behavior, pnpm 11.9.0, Angular 22 compilation, and project Playwright/browser versions must be tested together.

## 16. Findings, test results, and evidence integrity

Use these classifications consistently in both UIs and model tools:

| Classification | Evidence needed |
|---|---|
| Confirmed behavior failure | Observed runtime contradiction of an evidenced expectation |
| Observed regression | Comparable base pass/behavior and head failure/change under equivalent conditions |
| Potential issue | Source-supported concern without confirming runtime observation |
| Unverified requirement | Insufficient source, fixture, runtime, or planning capacity |
| Test defect | Assertion, selector, fixture, or generated test is incorrect |
| Infrastructure/configuration failure | Setup or execution environment failed |
| Coverage gap | Required behavior has no adequate executed test/probe |
| Flaky behavior | Inconsistent repeated outcomes retained explicitly |

Each finding includes requirement/source reference, pinned SHA, affected file/line, expected versus observed result, reproduction, confidence, severity, artifact IDs, and traceable probe/test identity. Keep human triage as a separate disposition; dismissing a finding must not rewrite raw evidence.

Use actual runner output for counts and verdict aggregation. Neither a ChatGPT tool argument nor an LLM report is trusted execution evidence. The existing model-callable `update_test_result` surface requires special care: externally reported/local results must carry a provenance class and may not satisfy strict governance gates as if signed by the managed runner.

Proposed provenance levels: managed CI/engine result, authenticated local upload, imported third-party report, human observation, and model-only assessment. Policies decide what satisfies a gate. At ingestion, verify result manifest, attempt/job identity, schema, counts, artifact hashes, and source snapshot. Server-side ingestion must bind these values to issued jobs rather than accepting arbitrary success claims.

Do not make a testing failure automatically count as an AI invocation incident: an agent successfully finding a product bug is a successful analysis operation. Track invocation health separately from target-product test verdict before updating Lumora's skill-outcome/autonomy ledger.

Persist measured suites through existing test-run operations and attach `test_run` evidence explicitly to the correct `test_plan`. A critique with no executed suite must not invent a test-run count; attach a real report through an existing supported evidence type or explicitly extend the schema after review.

Report outputs: concise summary, structured result manifest, findings, test-case/requirement matrix, raw runner reports, coverage scoped to its denominator, logs, browser artifacts, generated patch, and machine-readable execution history. Expose total reviewed versus unverified scope, including the probe cap.

## 17. Artifact storage, downloads, and retention

Ardberg currently stores bytes in its database and restores missing local copies. Preserve durability, but introduce a storage adapter with object storage for larger immutable traces/screenshots/patches and metadata in Lumora.

Do not reuse Lumora's project requirement-artifact tables as a binary log/trace bucket; they serve approved documents and have different lifecycle/visibility semantics.

Artifact workflow: upload to a temporary attempt-scoped object key, validate size/type/checksum, write authorized metadata, finalize the object, then expose an artifact ID. Failed partial uploads are cleaned by a retention job. No arbitrary filesystem path is accepted from clients.

Downloads check current organization/project permission on every request before issuing a short-lived scoped download or streaming through the backend. URLs must not embed long-lived credentials. Revoke/expire access after unlinking or policy changes. Model-visible results contain safe source URLs and small summaries, not entire raw logs or browser auth state.

Treat HTML, traces, SVG, and content produced by a tested repository as untrusted. Use safe attachment delivery or a separate restricted viewer origin; do not execute it in Lumora's authenticated application origin. Redact cookies, tokens, secret-looking environment values, and sensitive test data. Redaction failure blocks publication of that artifact rather than silently leaking it.

Set project retention defaults, storage quota, maximum artifact size, audit retention, and deletion semantics. Example starting values are 14 days for ordinary PR artifacts and 30 days for release evidence, adjusted by the team. Preserve minimal hashes/provenance where allowed after bulk-artifact expiry and display expired evidence honestly.

## 18. Native Angular testing workspace

Proposed navigation is `/projects/:id/testing`, with execution detail at `/projects/:id/testing/executions/:executionId`. Keep existing plans and governance primitives canonical. Existing `/projects/:id/test-cases` currently redirects to plans; retain compatibility and decide whether to add a link into Testing rather than breaking old URLs.

Pages and states:

| Surface | Required content and behavior |
|---|---|
| Overview | Recent executions, repository/PR/mode/status filters, baseline health, unverified scope, Start action |
| New execution | Repository/PR picker, pinned revisions, mode, linked plan, intent, recipe readiness, permissions and limits |
| Execution detail | Summary, actual stages, baseline versus focused results, findings, test cases, evidence, generated patch |
| Finding detail | Expected/observed, source reference, reproduction, trace/screenshot, disposition, generate-regression-test action |
| Patch view | File diff, requirements covered, validation result, download, separate apply/PR action |
| Settings | Allowed modes/targets, quotas, retention, source/model data policy, publication policy, setup recipe status |

Implement empty/loading/error/disconnected/cancel-requested/partial-completion states. Unauthorized users see permitted read-only information; backend authorization remains authoritative even if UI buttons are hidden. Sync filter/selected execution with the URL, support direct reload/back/forward, and preserve keyboard focus.

Start with a chronological stage timeline and clear parallel baseline indicator. Reuse Ardberg's event/node semantics to add an optional read-only flow diagram later. Do not port React Flow components directly into Angular or make a workflow designer a prerequisite.

Reuse existing Lumora navigation, accessibility patterns, theme, and components. Build typed API services from shared contracts. Add component tests for status mapping, stale events, filters, errors, permissions, cancellation, and patch actions; add browser coverage for the complete journey.

## 19. Hosted MCP gateway and tool catalog

Add a Streamable HTTP transport to a dedicated gateway or a well-separated backend module. Keep the existing stdio transport for local clients. Expose only testing-related operations in the ChatGPT plugin initially instead of the entire Lumora registry.

The current `createCozntMcpServer()` reads configuration once and relies on `session.ts` globals. Refactor business handlers to accept an explicit invocation context: authenticated principal, org/project scope, request ID, connection/session ID, and policy. Scope mutable context per connection/request, never per shared process. Every handler revalidates resource access even when a previous tool selected a project.

Proposed tool names below are design contracts, not currently implemented APIs:

| Tool | Purpose | Mutation classification |
|---|---|---|
| `get_testing_profile` | Accessible identity, organizations, capabilities | Read |
| `list_testing_projects` | Search projects/repository bindings | Read |
| `prepare_testing_execution` | Resolve and persist a pinned scope/preparation | Write; bounded preparation |
| `start_testing_execution` | Start approved baseline/review/generation | Write; consumes compute |
| `list_testing_executions` | History with cursor/filter | Read |
| `get_testing_execution` | Summary, current attempt, verdict and UI resource | Read |
| `get_testing_events` | Bounded incremental progress | Read |
| `list_testing_findings` | Structured findings and requirements coverage | Read |
| `get_testing_evidence` | Authorized evidence summary/download reference | Read |
| `cancel_testing_execution` | Cancel owned/authorized active execution | Write; interrupts work |
| `retry_testing_execution` | New attempt on pinned source | Write; consumes compute |
| `generate_regression_tests` | Generate test patch for selected requirement/finding | Write; separate from applying patch |
| `export_testing_patch` | Download an existing patch | Read |

Keep repository writes/report publishing in distinct tools only after those features are implemented and authorized. Do not expose `run_shell`, arbitrary SQL, unrestricted filesystem access, or user-chosen callback URLs through the public plugin.

All tools need strict input/output schemas, descriptions of actual effects, pagination/size limits, structured errors, and correct read-only/destructive/open-world hints. Annotation hints do not enforce permissions. Prefer bounded registered-repository operations over arbitrary internet targets. [MCP server guidance](https://developers.openai.com/plugins/build/mcp-server).

Long work returns immediately with execution/attempt IDs, lifecycle state, safe display URL, and next polling guidance. Do not keep one MCP call open for an entire test run. Poll incrementally with backoff and stop on terminal state or closed UI; model-side polling is bounded. The workflow continues durably without an open conversation.

Tool response separation: `structuredContent` contains bounded model/UI-visible state; text gives a short accurate summary; UI-only metadata can contain presentation details but never secrets. Include record revision so clients reject stale updates. Read tools remain useful when the UI is unavailable.

## 20. OAuth, identity, and tenant boundaries

Use an OAuth 2.1-compatible authorization-code flow with PKCE for remote user linking. Publish protected-resource/authorization-server metadata, validate issuer/audience/expiry/scopes, and return appropriate auth challenges. Use the callback/registration configuration shown for the actual ChatGPT connection rather than guessing redirect URLs. [Official authentication guidance](https://developers.openai.com/plugins/build/auth).

Lumora's existing browser login and GitHub OAuth connection do not automatically make it an MCP authorization server. First assess whether the deployed identity provider supports the required protocol; otherwise add a maintained authorization component that maps authenticated identities into Lumora. Do not implement custom cryptography or expose project API keys in widget JavaScript.

Proposed scopes: `testing:read`, `testing:run`, `testing:cancel`, `testing:generate`, and later `testing:publish`. Scope alone does not grant access to every project. Resolve current membership and project capability on every read/write/download and when dispatching delayed jobs.

Separate four identities: ChatGPT's MCP user token; Lumora-to-engine service identity; engine/source-broker GitHub authorization; sandbox-generated fixture identity. Never substitute one for another or pass them through indiscriminately.

Required cases: expired token, revoked link, removed membership, project archived, inaccessible repository, changed role during a queued run, cross-org execution/artifact ID, guessed plan ID, duplicate action, and stale selected UI context. On unlinking, revoke credentials and stop future access; active executions follow an explicit retention/cancellation policy visible to administrators.

Cookie-authenticated native write routes also require the project's CSRF/origin protections. The widget uses the authenticated MCP bridge; do not depend on cross-site access to Lumora browser cookies.

## 21. ChatGPT MCP App and extension behavior

Build a small TypeScript HTML/CSS widget bundle for run summaries, findings, and evidence selection. Share DTOs and view-model/status functions with Lumora, while rendering native Lumora pages in Angular. This avoids copying the entire Angular or Ardberg React dashboard into a chat widget.

Register a versioned UI resource, for example `ui://lumora-testing/execution-v1.html`, associate it with result tools using the documented UI resource metadata, and use the MCP Apps bridge for tool calls and context updates. Declare minimal CSP domains and a component origin; confirm requirements with the exact SDK version used. [Plugin API reference](https://developers.openai.com/plugins/reference).

MVP widget views:

1. Account/project selection when context is absent.
2. Prepared scope: repository, PR, pinned revisions, mode, requirement summary, limits.
3. Running execution: stage, baseline results, elapsed time, cancel availability.
4. Results: verdict plus scope, findings, unverified cases, test counts where measured.
5. Finding detail: reproduction, evidence preview, Explain selection, Open in Lumora.

After the inline widget works, add sidebar home, conversation panel, plugin settings, onboarding, and deep links on supported hosts. Capability-detect each optional extension and retain the inline/text fallback. Composer mentions are a later convenience; their availability is host-dependent. The documented extensions provide a foundation, not a guarantee that an arbitrary account can use every surface.

Selection example:

```json
{
  "projectId": "project_123",
  "executionId": "execution_456",
  "attemptId": "attempt_2",
  "findingId": "finding_789",
  "recordVersion": 8,
  "selectionSummary": "Session-expiry redirect assertion failed"
}
```

Use `ui/update-model-context` to make the selected record known to the model. The server still authorizes and reloads that record; selection data is not proof of ownership. Clear or refresh context when switching account/project/attempt. Store only presentation state locally; execution data and settings live on the server. [MCP App state guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

Test close/reopen, two simultaneous conversations, stale selection, reconnect, token expiry, theme/size changes, keyboard navigation, and missing extension capabilities. A report viewed in ChatGPT and Lumora must refer to the same execution/attempt and evidence.

Do not embed an arbitrary tested application's interactive preview into ChatGPT. First release links to authorized report/evidence views. Hosted preview isolation is a later feature requiring its own per-execution origin, short-lived access, network policy, cleanup, and review.

## 22. Plugin packaging, skills, hooks, and NPX

The remote plugin includes MCP configuration, descriptive metadata, onboarding/workflow skills, and UI resources served by its backend. Use the current supported plugin manifest and validate against the target host. A plugin-creator tool can scaffold packaging if available; it does not implement this backend or test engine. No plugin-creator skill was exposed in this session, so this plan assumes manual scaffolding is available. [Plugin packaging](https://developers.openai.com/plugins/build/plugins).

Create these focused skills only as needed:

- `review-lumora-change`: resolve scope, prepare/start review, interpret evidence and gaps.
- `test-lumora`: inspect requirements and existing tests, generate a bounded patch, validate, report.
- `explain-testing-finding`: retrieve the selected finding and explain only supported conclusions.

Use existing Lumora project rules and approved artifacts as context. Keep broad mandatory behavior in server-side policy and CI, not solely in skill text.

Local Codex hooks may remind users of stale test evidence or trigger fast checks where supported. Hosted ChatGPT does not depend on local filesystem hooks. Do not copy Claude hook schemas from the guide without checking Codex support. Full browser/database suites remain explicit execution jobs, not a hook after every edit.

NPX is optional for a versioned local helper/stdio launcher. It is not required to serve the remote MCP App and does not create the hosted UI by itself. Do not create another installer where Lumora's current CLI packaging can support the needed command. Pin release versions, inspect tarballs, and keep network package installation out of high-frequency hooks.

Test plugin metadata changes, MCP schema changes, and UI bundle versions through the actual host connection refresh/scan process. Keep installed/published artifacts reproducible and provide an uninstall/rollback procedure.

## 23. GitHub triggers, publication, and generated-test changes

Use Lumora's existing repository integration and verified webhook ingress as the product entry point. Avoid enabling Ardberg's independent public webhook for the same repository in parallel without an explicit ownership decision.

Webhook work: signature verification, delivery deduplication, repository/installation-to-project mapping, PR/head pinning, fork policy, project trigger policy, source-access validation, and outbox enqueue. New head means new execution. Superseded executions can remain visible but cannot overwrite the current head's status/comment.

Coordinate with the existing PR summary reviewer: keep a distinct check/report type and shared trigger policy; do not silently replace its output or post duplicate summaries.

Separate these actions and policies:

- Fetch source to perform an authorized review.
- Record results/evidence inside Lumora.
- Publish a GitHub check or PR comment.
- Commit generated test files or open a PR.

Initial integrated default is internal results only. Publication/application is disabled until explicitly enabled for the project and invoked with appropriate authority. This differs from Ardberg's existing default and must be enforced by the adapter, not just the UI checkbox.

Patch application must verify exact expected base/head, test-only allowed paths, no secret/config/production-code modification, no path traversal, no overwrite of unrelated user work, and recorded validation. Conflicts return a reviewable error; no force push. Generated tests must not be skipped/weakened to obtain green output. Snapshot changes require meaningful review.

If writing a new commit causes another webhook, use provenance labels and deduplication to prevent an endless generate/publish/review loop. External operations are idempotent against a stable publication identity and verify the current head before updating check state.

## 24. Deployment and operations

Deploy the following logical components; small internal pilots can colocate trusted services, but runner isolation remains separate:

| Component | Exposure | Scaling/health |
|---|---|---|
| Lumora frontend/backend | Existing product ingress | Existing health/readiness plus testing dependency status |
| MCP gateway | Authenticated HTTPS or approved private connectivity | Fast requests; isolated sessions; tool/error telemetry |
| Engine API | Private network only | Submit/read/cancel; no public dashboard endpoints |
| Temporal + engine workers | Private network | Task queues, workflow replay/version compatibility |
| Runner hosts | Isolated infrastructure | Per-tenant/job quotas, leases, resource cleanup |
| Data/objects | Private storage | Backups, retention, encryption, controlled artifact access |
| Model/source gateways | Private service endpoints | Quotas, short-lived credentials, audit |

For local development, services may use localhost/Compose with separate ports and test data. Use a controlled tunnel or other documented private connection only for the MCP endpoint when testing ChatGPT; do not expose the unauthenticated Ardberg API, Docker daemon, database, or Temporal UI.

For public plugin distribution, use the official supported reachable HTTPS deployment path. Private connectivity and public submission are different deployment cases. Keep auth and tenant checks identical in development and production apart from explicitly seeded test identities. [MCP deployment guidance](https://developers.openai.com/plugins/build/mcp-server).

Provision separate secrets for model access, source integration, OAuth, engine service identity, database, and storage. Rotate credentials, restrict service roles, and document revocation. Use a secret manager appropriate to the deployment rather than copying developer `.env` files.

Observability: carry correlation/execution/attempt/workflow IDs through request logs, model usage, engine events, and runner logs. Track queue latency, setup failures, execution duration, model cost, artifact size, flaky outcomes, cancellations, timeout rate, orphaned resources, ingestion lag, auth failures, and cross-tenant denials. Redact before exporting logs.

Alert on stuck executions, stale heartbeats, repeated setup failures, missing terminal events, storage failures, excessive model spend, and failed cleanup. Provide operator actions for retry/reconcile/cancel with audit. A global/project kill switch disables new executions and writes while keeping historical results readable.

Backup and restore must cover product execution records, engine workflow state, and artifact references consistently. Test restore on a non-production environment. Run IDs and evidence URLs must remain stable after restore or identify missing evidence explicitly.

## 25. Verification strategy for the integration

No production credentials are needed for ordinary unit/contract CI. Mock source/model integrations; use isolated DB/container fixtures for service tests. Real ChatGPT account-linking/UI acceptance is a separate deployment test.

| Layer | Required verification |
|---|---|
| Shared contracts | JSON/Zod/Pydantic round trips; schema evolution; invalid/unknown fields |
| Authorization | Two organizations, multiple roles, removed access, guessed run/artifact IDs, scope mismatch |
| Execution API | Duplicate starts, engine unavailable, dispatch retry, cancellation, timeout, stale update |
| Event ingestion | Repeated/out-of-order events, missing sequence, wrong attempt, forged callbacks, reconciliation |
| Results | Missing/invalid reporter output, zero discovery, partial suites, flaky retries, unsupported coverage |
| Evidence | Correct plan binding, `planId` translation, result/evidence atomicity, duplicate ingestion |
| Engine parity | Baseline survives model failure; source pinned; probes limited; blocked cases retained |
| Sandboxes | Cleanup after each failure path; no production secrets; incompatible runtime; network restrictions |
| Model gateway | Fixed tasks/schemas, refusal/timeout/rate limit, token budget, no arbitrary endpoint/schema |
| Angular | States, filters, URL navigation, permissions, accessible interactions, reconnect |
| MCP | Initialization, discovery, strict tool schemas, auth challenges, concurrent users, response sizing |
| MCP UI | Valid resource/CSP, bridge calls, selected context, account switch, unsupported-host fallback |
| Generated patches | Path rules, conflicts, stale SHA, no production changes, genuine assertions |
| GitHub | Signature/deduplication, fork policy, superseded head, publication disabled, loop prevention |
| Deployment | Health/readiness, image compatibility, Temporal replay, upgrade/rollback, restore |

Retain Ardberg's existing Python tests and manual runner smoke fixtures. Tests found in source are not assumed passing; establish a fresh baseline after pinning compatible dependencies. Lumora's existing Vitest/Angular checks must continue to run through its normal CI.

Add seeded controlled defects in fixture repositories: passing native suite but missing PR behavior; valid code with broken setup; source concern disproved by runtime; true base/head regression; generated test compile error; missing auth fixture; duplicate webhook; cancelled job with late event. Validate the exact displayed classification and gate outcome for each.

## 26. CI and quality gates

Keep Lumora's existing branch policy and schema-drift checks. Add jobs for shared contracts, backend testing operations, Angular testing UI, engine Python tests, gateway/widget build, integration smoke, and isolated runner end-to-end fixtures.

Test versions from lockfiles/pinned requirements and runner image digests. Detect orphaned tests. Upload normalized results and failure artifacts even when a job fails. A successful report upload must not make a failing/incomplete execution pass.

Use a required aggregate gate that knows which suites are mandatory for changed areas. Start with full relevant suites; introduce affected-test selection only with a validated dependency map and fallback to full checks. Changes to shared contracts, execution/auth, setup recipes, or result validation require broader coverage.

Separate untrusted PR execution from trusted publication jobs. Do not expose secrets to fork code or run a privileged workflow that checks out arbitrary PR code with publication credentials. Generated tests committed after review run normally without Codex or ChatGPT in CI.

## 27. Phased implementation backlog

### Phase 0 — baseline and contract decisions

Tasks: preserve both repositories; resolve Lumora lockfile intent; inventory actual tests/configuration; run reviewed safe existing checks; identify current Ardberg behavior versus stale docs; choose supported hosts; confirm approved requirements and source-processing policy; record engine/source import provenance.

Deliverables: baseline reports, compatibility matrix, execution-mode decision, architecture decision, initial data/API schema.

Exit: existing failures and infrastructure blockers are recorded; one pinned Lumora checkout can be prepared without touching a developer database.

### Phase 1 — private Ardberg adapter

Tasks: import/version engine source; implement service authentication and execution IDs; disable default GitHub publication; isolate source/model credentials; expose idempotent submit/read/events/cancel; validate existing engine tests and one disposable fixture run.

Deliverables: private service contract, container build, parity fixtures, cancellation/cleanup test.

Exit: backend can start one baseline/review attempt and retrieve durable evidence without a ChatGPT UI.

### Phase 2 — Lumora operations and persistence

Tasks: add migrations/contracts; authorized execution CRUD; outbox dispatch; event ingestion/reconciliation; findings/artifact metadata; normalize result/plan fields; attach suite evidence; implement provenance/gate rules.

Deliverables: versioned API, tenant tests, ingestion/idempotency tests, result/evidence linkage.

Exit: two test organizations can run independently and cannot access each other's records or artifacts.

### Phase 3 — native Angular workflow

Tasks: project Testing navigation; creation and execution pages; live events/polling; finding/evidence/patch viewers; settings and empty/error states; first browser journey.

Deliverables: working native feature with backend integration.

Exit: a user selects a PR, starts verification, sees accurate results, and retries/cancels from Lumora.

### Phase 4 — current-project testing and generated patches

Tasks: Lumora setup recipe; compatible runtimes; isolated database fixtures; current Playwright suite; authentication/project-access example; Angular-aware generation adapter; patch validation and export.

Deliverables: one complete requirement-to-generated-test-to-run-to-evidence demonstration.

Exit: tests fail for a controlled relevant defect, pass after the fixture fix, and rerun without AI generation.

### Phase 5 — authenticated hosted MCP

Tasks: request-scoped MCP context; narrow testing tool registry; OAuth discovery/token verification; strict schemas; async start/read/cancel; UI resource registration; tool-only host tests.

Deliverables: staging MCP endpoint and contract/auth/concurrency tests.

Exit: ChatGPT can securely retrieve a run and initiate an authorized attempt; concurrent accounts remain isolated.

### Phase 6 — MCP App and extensions

Tasks: compact widget; selected-context updates; account/project onboarding; deep links; capability-detected panels/sidebar/settings; accessibility; unsupported-host fallback; private-user trial.

Deliverables: working ChatGPT plugin that displays the same results as Lumora.

Exit: selecting a finding and asking “explain this” resolves the correct authorized evidence; closing/reopening preserves the server-side result.

### Phase 7 — operational readiness and controlled release

Tasks: quotas/retention; workload isolation validation; report/patch publication policy; tracing/alerts; Temporal replay; CI; install documentation; restore/rollback exercises; second-developer trial.

Deliverables: versioned release, operational runbook, adoption metrics, explicit feature flags.

Exit: clean installation, reproducible run, correct cross-surface evidence, and tested rollback.

Suggested planning range after baseline: a native proof of integration in roughly 5–10 engineering days; a secure multi-user native-plus-ChatGPT release in approximately 5–8 engineering weeks for one experienced engineer, depending on existing failures, auth readiness, deployment, and requirements. These are estimates, not guarantees. Prefer milestone acceptance over calendar promises.

## 28. Exact first implementation slice

Start with **one baseline execution visible inside Lumora**, using a fixed commit and internal-only results. This proves the adapter and evidence pipeline before adding AI or plugin presentation complexity.

1. Establish a runnable pinned Lumora fixture with its intended lockfile and environment.
2. Define the minimal execution/attempt/result contracts and authenticated engine request.
3. Add baseline-only service support extracted from Ardberg's existing independent baseline branch.
4. Add an authorized Lumora create/read execution operation and durable dispatch.
5. Run backend/root/Angular checks in the disposable environment; capture real structured results.
6. Ingest measured suites into `test_runs` with correct plan/evidence linkage and provenance.
7. Add one Angular execution-detail view showing stage, result, and logs.
8. Demonstrate success, test failure, and setup failure as three different outcomes.
9. Expose that same read operation through MCP and a simple result widget.
10. Expand to review mode and generated tests after this vertical slice passes.

Do not start by copying Ardberg's UI or writing a manifest alone. The useful first deliverable is a verified execution that all later interfaces can access.

## 29. Completion criteria and rollout

- [ ] Lumora owns identity, authorization, project context, and execution IDs.
- [ ] Ardberg runs as an authenticated private service with tenant-aware job attribution.
- [ ] Existing engine behavior is preserved by parity tests.
- [ ] Source and requirements are pinned/versioned and visible in every report.
- [ ] Baseline checks continue independently when AI planning fails.
- [ ] Review probes and persistent generated tests are distinguished.
- [ ] Test execution is isolated from product services and credentials.
- [ ] Results/evidence are validated, durable, and correctly linked to plans.
- [ ] Model-only claims cannot satisfy managed-run governance gates.
- [ ] Native Angular UI handles progress, partial failures, cancellation, retry, and permissions.
- [ ] Hosted MCP has request-scoped state and verified OAuth/tenant isolation.
- [ ] ChatGPT widget displays the same execution and supports accurate selected context.
- [ ] Unsupported extensions fall back to usable tool/text/inline behavior.
- [ ] Publication and repository writes are separate authorized actions.
- [ ] CI runs committed tests and retains evidence without autonomous test generation.
- [ ] Artifact redaction, expiry, access revocation, and cleanup are verified.
- [ ] Temporal upgrades, backups, restore, and rollback are exercised.
- [ ] Another developer can install, operate, troubleshoot, and remove the integration.

Roll out behind separate flags for native testing, engine modes, ChatGPT read access, ChatGPT execution, generated patches, and external publication. Start with an internal test organization. Expand read access before write/compute access. Preserve read-only access to historical evidence when disabling new executions.

Rollback: disable new execution dispatch; allow safe draining or cancel active jobs; restore compatible API/engine/UI images; keep additive schema and historical evidence; reconcile incomplete outbox/events. Do not destroy execution history or databases as part of application rollback.

## 30. Section 9.6 checklist applied to this integration

The guide's five checks become concrete engineering work:

1. **Manifests/scripts:** inspect Lumora plugin tools, engine wrappers, recipe commands, runner images, and generated patches; disclose every action's effect.
2. **Pinned dependencies:** restore intended lockfile state, retain pinned Python requirements, pin Temporal/runner images, and align browser packages/binaries.
3. **Network/data movement:** document source/PR/evidence sent to model services; separate source fetch, package installation, execution, and publication access.
4. **File/data scope:** restrict sandboxes/artifacts to the authorized project/attempt; no unrestricted host files, development databases, or cross-tenant records.
5. **Maintainers/releases:** assign owners for plugin, engine, auth, CI, and package releases; review updates and retain signed/versioned provenance as appropriate.

Five-line assessment of the current integration starting point:

> Ardberg provides useful isolated execution and evidence handling, but its current local API is not authenticated for multiple users.
> Lumora has useful project/result APIs, but its stdio MCP session state must be refactored before shared hosted use.
> Reproducibility needs the deleted Lumora lockfile resolved and deployment/browser versions pinned and tested together.
> Source, model input, artifacts, and GitHub writes need explicit project-scoped policies and separate credentials.
> A private authenticated engine plus Lumora authorization, evidence validation, and staged plugin rollout is the proposed path to deployment.

## 31. Remaining decisions and evidence limits

These decisions can be closed during Phase 0 while implementation of independent contracts/fixtures proceeds:

| Decision | Recommended starting point |
|---|---|
| Native versus ChatGPT delivery | Native operations/UI first, then the same operations through MCP |
| Engine ownership | Versioned private Python/Temporal service housed with Lumora |
| Public installation | Internal/private trial first; public directory only if later required |
| Auth provider | Assess current deployment's OAuth issuer capability; use maintained supported implementation |
| First feature | Authentication/session/project-access behavior |
| Publication | Internal results only by default |
| Preview | Defer externally hosted interactive preview |
| Model access | Lumora governed task gateway; baseline remains model-independent |
| Local versus remote source | Pinned repository execution first; local checkout uploads clearly attributed later |
| Retention/cost | Per-project configured budgets and retention with conservative defaults |

Account-specific ChatGPT extension availability, repository runtime readiness, installed package resolutions, engine test pass rates, and deployment credentials were not verified by executing the applications. They remain explicit implementation checks. The existing projects and this plan provide a concrete starting point, not a claim of a finished plugin.
