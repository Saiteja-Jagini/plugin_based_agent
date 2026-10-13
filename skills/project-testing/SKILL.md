---
name: project-testing
description: Plan, write and run tests using the current repository's own framework and rules. Use for regression coverage, failure investigation and verification evidence in any connected local project.
---

# Test the current project

1. Read applicable `AGENTS.md`, manifests, test configuration, existing tests and CI workflows. Identify package/workspace boundaries, tool versions, runners, setup requirements and the behavior under change. Lumora manages this connection; its implementation stack does not dictate the target's tests.
2. Reuse this project's test framework and conventions. If no runner exists, explain the gap and propose a suitable setup based on the project before introducing dependencies. Do not invent npm, pytest or other commands based solely on language detection.
3. Map requirements and likely defects to meaningful tests: normal behavior, boundary inputs, error paths, state changes and relevant authorization/isolation. Scope testing to the change. Avoid tests that merely restate implementation details.
4. Inspect setup before execution. Confirm destructive database operations target an authorized disposable test environment; do not assume a `test` script is safe. Use the project's documented fixtures and mocking strategy. Avoid real credentials and production state.
5. Write tests alongside existing tests, run targeted checks first, and diagnose failures using actual output. Run the required broader checks when appropriate. Do not fabricate results or treat hook delivery as test execution.
6. Report files changed, commands actually run with working directories, pass/fail/skip results, and unverified behavior. Where feasible demonstrate the regression fails before the fix and passes after it.

This skill guides the coding agent. The hook runtime records events and checks policy; it does not automatically generate or execute a complete test suite when a repository is connected.
