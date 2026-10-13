# Each repository owns its rules

Lumora manages projects; its Angular/Next.js, Drizzle, Zod and AI patterns are not requirements for managed repositories. Capture, skill delivery and policy evaluation are reusable.

## Repository context

`node src/cli.ts profile --root PATH` reads manifests and lists instruction-file candidates without credentials or code execution. SessionStart includes compact context. Skills direct the agent to read scoped `AGENTS.md`, documentation, existing tests and actual runner configuration.

Detection recognizes JavaScript/TypeScript packages and common Angular/React/Next/Vue/Express/test dependencies; Python, Rust, Go, JVM, C#, Ruby and PHP manifests. Eligible package script names are reported, never executed. Unknown stacks still work for capture and generic policy but need manual tooling discovery.

Limits: four nested directory levels, 200 visited directories, 300 KB per package.json; generated/hidden folders, symlinks and independent nested Git repositories are excluded. This is not a complete dependency graph. Workspace package-manager inheritance may need manual examination.

## Default controls

- Recognized destructive database resets: blocked by default, configurable per project.
- Explicit edits outside the connected root, secret files, and managed governance files: checked.
- DB-push restriction: off for new projects; optional for projects requiring committed migrations.
- Source rules: empty. No global ban on interfaces, direct provider SDKs or database libraries.
- Stop reminder: requests actual verification outcomes, never manufactures them.

Policies refresh at SessionStart. Failed refresh retains the cached policy with a warning. Existing projects retain saved policy until an administrator changes it. Text checks are not a sandbox or proof that indirect shell execution is safe.

## Configure source rules

With the connected project's administrator credential, export policy in PowerShell:

```powershell
node src/cli.ts policy --root "<connected repository>" | Set-Content -Encoding utf8 .lumora-agent/policy-draft.json
```

Increment `version` by exactly one and add an agreed rule to `sourceRules`, for example:

```json
{
  "id": "ui-data-boundary",
  "pathPrefix": "frontend/src/",
  "forbiddenText": "@/database/",
  "allowedPathPrefixes": ["frontend/src/server/"],
  "message": "This project's UI accesses data through its documented service layer."
}
```

This is an example, not a default. Derive requirements from repository documentation or its owner. Path prefixes are case-sensitive forward-slash paths relative to the connected root, not globs. End directory prefixes with `/`; empty prefix matches every path. Text matches are literal, case-sensitive and per-line. Matches are advisory warnings: comments and partial patches can produce false positives. `reviewArchitecture: false` disables these hints.

```powershell
node src/cli.ts policy --root "<connected repository>" --file .lumora-agent/policy-draft.json
node src/cli.ts review --root "<connected repository>" --out .lumora-agent/project-review.json
```

Updates require admin role and are audited. Dashboard boolean updates preserve source rules and display their descriptions. Review uses current platform policy with credentials; otherwise it explicitly reports cached/fallback policy. Review from the connected root for correct policy-relative paths.

Static review scans selected common source/config extensions and recognized destructive Playwright setup. It cannot find every defect in every language. No configured source rules and no findings does not establish correctness. Use the review/testing skills and project tools for substantive analysis and execution.

## Skill ownership

Each project has its own approved release. Generic skills can be shared; custom skills must reference the target project's workflow. Hashes detect content changes, not appropriate instructions; administrators review releases before publishing. Sync preserves unowned and modified files and migrates unchanged receipt-owned legacy `lumora-*` files when the new release omits them.
