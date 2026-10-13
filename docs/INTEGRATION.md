# Integration contracts and rollout

The plugin supports arbitrary local repositories. Lumora is the management platform, and each target has independent credentials, skills and policy. The application is deliberately independent of Angular and Next.js. Both frontends can later use the same service boundary. The present UI is an authenticated local console; it is not an embedded ChatGPT MCP app. No live Lumora endpoint has been contacted.

## Pilot HTTP contract

All `/api/projects/:projectId/*` routes require a bearer token. The authenticated token owns a single project; request data cannot select another tenant. `GET /api/me` returns the authenticated principal. `GET /health` is unauthenticated and contains no project information.

| Route | Method | Role / behavior |
|---|---|---|
| `summary` | GET | Agent sees own event counts; observer/admin see project counts |
| `events` | POST | Agent/admin; strict event schema; session ownership and event-ID conflict checks |
| `events` | GET | Search `q`, `kind`, `session`, `user`; descending `before` cursor; `limit` capped at 200 |
| `sessions` | GET | Up to 200 recent sessions; agent sees own only |
| `policy` | GET / PUT | All can read; admin updates must increment version exactly once |
| `skills` | GET / POST | All can read; admin publishes verified immutable content and activates release |
| `principals` | GET / POST | Admin lists metadata and issues one-time credentials |
| `principals/:id` | DELETE | Admin revokes; cannot revoke the current credential |
| `audit` | GET | Observer/admin checks stored audit-chain integrity |

Validation failures return 400, authentication 401, role/scope violations 403, replay/version conflicts 409, body size 413 and request limit 429. The request limit is 1,200 authenticated requests per credential per minute and is process-local. There is no shared rate limiter in the pilot. Maximum HTTP request body is 2 MB. The server rejects cross-origin browser requests and non-loopback Host headers. It does not use cookies for authentication.

The API's Zod schemas are in `src/contracts.ts`; database operations are in `src/store.ts`, never the browser. Migration `001_initial.sql` owns the pilot SQLite schema. When integrated with Lumora, adapt these operations to the canonical authenticated backend and Drizzle schemas instead of creating parallel governance/evidence primitives.

## Lumora adapter

`src/lumora.ts` was derived from the checked-out backend handlers, not hypothetical endpoints:

| Method | Actual Lumora endpoint | Integration behavior |
|---|---|---|
| `openSession` | `POST /api/v1/mcp/sessions` | Contract implemented/tested; not automatically retried or wired into the local session ledger |
| `prompt` | `POST /api/v1/mcp/prompts` | CODEX source, user role, stable clientLocalId; optional real server session ID |
| `skills` | `POST /api/v1/mcp/choreographies/sync` | Effective project platform/custom content; verified before installation |
| `preTool` | `POST /api/v1/agents/pre-tool-use` | Honors allowed=false; explicit registered integration skill slug required |

Credential behavior mirrors Lumora's client: API key alone uses Bearer; a user session uses Bearer plus `X-Lumora-Api-Key`. A configured missing user-session credential fails rather than falling back to service attribution. Do not use a shared service key and assume it identifies individual developers.

Example optional connection section, to add **only when starting live integration**:

```json
{
  "lumora": {
    "url": "http://127.0.0.1:3028",
    "projectId": "actual-lumora-project-id",
    "apiKeyEnv": "LUMORA_API_KEY",
    "sessionTokenEnv": "LUMORA_SESSION_TOKEN",
    "skillSlug": "registered-plugin-integration-skill"
  }
}
```

This object extends the existing `.lumora-agent/connection.json`, not a replacement for its version/project/server/tokenEnv fields. The URL is an example from the local backend configuration; verify the deployment you will actually use.

When enabled, SessionStart gets skills from Lumora and local project policy from the pilot service. PreToolUse also calls Lumora and denies if policy cannot be verified. The configured slug denotes the explicit integration actor; it does not establish that a downloaded skill was automatically invoked by the model. Do not send arbitrary tool completions to the skill outcome ledger as successful skill invocations.

`node src/cli.ts bridge --root <project>` explicitly delivers the authenticated user's captured prompts to Lumora. It uses stable event IDs and a local delivery receipt, so interrupted delivery can safely retry against Lumora prompt deduplication. The bridge stops on an error and resumes on the next invocation. Prompt governance must be enabled on the Lumora deployment. It does not forward another user's prompts and does not auto-create remote sessions or fabricated outcomes.

Remote session mapping, live credential ownership, post-tool attributed skill outcomes, approved test-result submission and evidence attachment need their own integration acceptance pass. There is deliberately no automatic write into Lumora's test-run/governance tables in the pilot.

## Codex acceptance pass

1. In an isolated connected repository, install exactly one hook source and open `/hooks` to trust it.
2. Start a new session. Check SessionStart in the dashboard, the receipt hash on disk and actual discovery of project-review, project-testing and project-governance.
3. Submit a harmless unique prompt. Confirm one event with the correct authenticated user and session.
4. Ask for a harmless operation that matches a denied test policy in the isolated fixture. Confirm the host itself blocks the call, rather than merely showing the handler's JSON.
5. Stop the pilot server, submit a harmless prompt, restart and flush. Verify one delivered event and no changed user attribution.
6. Add a second user and verify each agent token cannot view another user's activity or submit into their session.
7. Enable real Lumora integration only for a designated test organization/project. Verify source, identity, duplicate capture ownership and remote denial semantics.

These checks depend on native Codex and live deployment setup; passing direct handler tests does not substitute for them. The installed CLI reported 0.158.0 during development. Official hook contracts can evolve; revalidate your deployed host/version before rollout.

## Angular / Next.js embedding in the Lumora platform

Add a testing/governance view under the existing project navigation. Reuse native UI components and the application's authenticated data layer. Map the local console's resource contract to existing operations; maintain one canonical prompt/session/evidence record, not two independently authoritative stores. Resolve queue ownership: only one component may forward each prompt. Keep all secrets and authorization decisions server-side.

The following requirements apply when modifying the Lumora platform repository itself, not to projects managed by the plugin. Introduce no new kind-specific governance tables/routes. Keep governance records, autonomy denials and test evidence distinct according to Lumora's AGENTS.md. Use the canonical `evidence_links` operation for test-run proof; completion must not be inferred from a plugin stop event. A later Ardberg adapter should supply actual pinned-revision execution results and preserve failed/blocked/not-run distinctions.
