---
name: project-review
description: Review changes in the current local repository for defects, violations of its own architecture and missing verification. Use for code review or flaw analysis across languages and frameworks; apply only this project's documented rules.
---

# Review the connected project

Before applying a bundled copy of this skill, check the connected repository's `.agents/skills/project-review/SKILL.md`. If a distinct local copy exists, read and use its current instructions for this repository. Local edits survive sync. Do not recursively reload the same file; user instructions and higher-priority rules still apply.

1. Establish the repository root and current diff. Read applicable `AGENTS.md`, architecture documentation, manifests and nearby code. Preserve user changes. Lumora is the platform managing the connection; the target may be any project.
2. Identify this project's actual boundaries, data models, authentication, persistence and external calls. Trace changed behavior through callers and tests. Do not assume Angular, Next.js, Zod, Drizzle, a central AI function or a specific migration directory.
3. Apply documented project requirements. Platform `sourceRules` are literal-text, path-prefix review hints, not an AST analysis or runtime proof. Do not infer a ban merely from a stack or an interface declaration. Cite the source of any claimed architecture requirement.
4. Prioritize reproducible correctness failures, authorization gaps when applicable, cross-project data exposure, destructive test setup and missing regression coverage. Read adjacent code before reporting a candidate as a defect.
5. For each finding provide severity, exact file and line, triggering condition, observed or expected consequence, and a concrete correction. Separate confirmed defects from uncertain candidates and identify tests needed to resolve uncertainty.
6. Report executed checks, outcomes and remaining limits. A clean static scan with no configured rules means no candidates were found by those checks; it is not an exhaustive review or project certification.

Use repository-supported tools and existing conventions. Do not execute destructive setup, installs or network-dependent commands merely because a manifest lists them. Follow user authorization and project policy.
