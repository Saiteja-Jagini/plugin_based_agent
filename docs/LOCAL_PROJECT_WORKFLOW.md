# Connect a local repository, customize skills and write tests

Version 0.4.0, verified on 2026-10-13 with Node 24 and Codex CLI 0.158.0 installed.

## Earlier setup diagnosis (before connection)

`D:\Downloads\coznt` had no `.lumora-agent/connection.json` when inspected. The plugin was enabled globally, but no service was reachable on `http://127.0.0.1:4318`. Either condition prevents new prompts from appearing in this dashboard. The existing service database contains project `my-app`; its developer-like account `09` has the **observer** role, which cannot submit events. Do not use an observer credential for Codex capture.

The changes were verified using isolated service and repository fixtures. No Coznt application files were edited. Coznt has since been connected and its project-hook adapter updated to 0.4.0. Native capture from your next interactive CLI conversation needs review/trust of those changed hooks.

## 1. Install the updated plugin once

Version 0.4.0 is already installed and enabled on this machine. The implementation produced `dist/lumora-governance-0.4.0` and updated the local marketplace catalog to that package. The following commands are for installation on another setup or reinstalling; on this machine continue to step 2. From PowerShell:

```powershell
cd D:\Downloads\plugin_based_agent
codex.cmd plugin marketplace add "D:\Downloads\plugin_based_agent\dist"
codex.cmd plugin add lumora-governance@lumora-local
```

Skip marketplace registration if it is already registered. Check the installed version is 0.4.0. If an older version is retained, remove/add only this plugin using the CLI. Restart Codex and review/trust the hooks in `/hooks`. Trust is controlled by Codex and cannot be established by `connect`. See [OpenAI's hook packaging and trust documentation](https://developers.openai.com/plugins/build/plugins).

Use one hook route. If this product's project-local hooks are already installed, run `node src/cli.ts uninstall --root "<repository>"` before enabling its global plugin hooks. Other hook registrations are preserved. Do not enable two copies of the same capture hook.

For a fresh build on another checkout, run `npm.cmd ci --ignore-scripts`, `npm.cmd run build`, then `node src/cli.ts package --out dist/lumora-governance-0.4.0`. Packaging refuses to overwrite an existing directory; the supplied package is already built in this workspace.

## 2. Start the service and create a project

**Terminal A**, from the plugin directory, creates a distinct project for Coznt and starts the service:

```powershell
cd D:\Downloads\plugin_based_agent
node src/cli.ts init --project coznt --name "Coznt" --user manager --data .lumora-agent/service
node src/cli.ts serve --data .lumora-agent/service
```

Save the administrator token printed by `init`. It is shown once. Leave `serve` running. If `coznt` already exists, skip `init` and use its existing administrator credential. If a service already listens on 4318, use that service and its data directory rather than starting a second one.

Open `http://127.0.0.1:4318` and sign in with that project's administrator token. In **Team access**, issue an **agent** credential for yourself and copy it. Administrators can also capture, but an agent credential gives the developer only the access needed. Observers can view logs but cannot capture them.

If you want to reuse the existing `my-app` project instead, skip `init`, start the same service directory, sign in using your saved `my-app` administrator credential, issue an agent credential, and use `--project my-app` below. Do not use the demonstration credential with a real service project.

## 3. Connect Coznt and launch Codex

**Terminal B**:

```powershell
cd D:\Downloads\plugin_based_agent
$env:COZNT_AGENT_TOKEN = "<agent credential from Team access>"
node src/cli.ts connect --root "D:\Downloads\coznt" --project coznt --token-env COZNT_AGENT_TOKEN
node src/cli.ts doctor --root "D:\Downloads\coznt"
node src/cli.ts skills --root "D:\Downloads\coznt"
cd D:\Downloads\coznt
codex.cmd --no-daemon
```

The connection command writes metadata and downloads the project's skills. It never puts the credential into `connection.json`. Add `.lumora-agent/` to the target repository's local Git exclude rules. Decide whether to commit the repository's `.agents/skills/` instructions for team sharing or keep them local.

`--no-daemon` is supported by the inspected CLI and avoids reusing a previously started shared server while diagnosing environment inheritance. Set the credential in the same terminal **before** launching Codex. A new terminal needs the variable again. For another CLI version, check `codex --help` before using this option.

In Codex, open `/hooks` and review/trust the plugin's definitions. Submit a new prompt such as `Explain this repository's test setup. Do not change files.` Then open **Prompt & event logs** in the dashboard, clear filters and select `UserPromptSubmit`. Live updates poll every three seconds while the page is visible. Loading older events pauses live updates so the page does not jump.

If a connection already exists, do not run `connect` again: inspect `doctor`, use its `tokenEnv`, and run `sync` if needed. A connection is scoped to that repository; an independent nested Git repository needs its own connection.

## 4. Create and edit skills in the dashboard

Sign in as a project administrator and open **Project skills**. Click **Create skill**, enter a name, description and instructions, then **Save skill**. Names are lowercase with hyphens; new names get a `project-` prefix unless already namespaced. To change a published skill, click **Edit skill**. The edit form preserves the complete SKILL.md, including frontmatter and any additional metadata. Keep its name unchanged and its description nonempty.

Every save publishes a new immutable project release and retains other skills. An editor opened before another administrator publishes cannot overwrite that newer release: the save reports a conflict and keeps your draft so you can copy it before reopening.

With the updated runtime and trusted hooks, **SessionStart and UserPromptSubmit** fetch the latest release before Codex continues. You can also run:

```powershell
cd D:\Downloads\plugin_based_agent
node src/cli.ts sync --root "D:\Downloads\coznt"
```

The files land under `D:\Downloads\coznt\.agents\skills\<skill-name>\SKILL.md`. Changes are checked on the next prompt or explicit sync; there is no background watcher while Codex is idle. Saving does not start tests or interrupt an in-progress turn. For a newly created skill, explicitly ask Codex to read that file, or start a fresh session for skill discovery.

**Repository synchronization** shows the last report for each repository and capture credential: its user, short repository identifier, timestamp and file status. If it says the latest release is pending, send a new prompt or run sync. A report is historical evidence, not proof the repository is currently online. No status appears until the updated runtime reports. Local instruction contents are not uploaded: reports contain hashes and status metadata.

You can still edit local files in your editor. If only the local file changed, it stays active. If both the published and local files changed, sync leaves the local file intact and shows a conflict in the dashboard. Administrators choose:

- **Keep local**: retain that repository's local instructions for this published version. A later published change raises a new conflict.
- **Use published**: replace the file on the next prompt/sync, first saving the previous file under `.lumora-agent/skill-backups/`.

Choices are tied to the reported local and published hashes. Further edits invalidate a pending choice and require review again. Decisions apply only to the reporting repository and credential, not every checkout. An offline service leaves existing files intact and prompt capture still queues locally when the hook has its credential.

The optional external Lumora adapter remains authoritative when configured: this dashboard edits the pilot service's catalog, not the external platform's catalog.

For existing project-hook installations, update their runtime registration after building the new package:

```powershell
node src/cli.ts install --root "D:\Downloads\coznt" --package "D:\Downloads\plugin_based_agent\dist\lumora-governance-0.4.0"
```

Restart Codex and review the changed commands in `/hooks`. Use one active capture route; avoid enabling bundled hooks and the project adapter together. Restart a service running the old code against its existing data directory. The additive migration preserves existing credentials, releases and logs.

## 5. Ask Codex to write tests

First choose a feature or defect and explain the expected behavior. For planning only:

> Read .agents/skills/project-testing/SKILL.md and the repository rules. Inspect the authentication flow, identify the existing test framework and propose tests for valid login, invalid input, denied access and expired sessions. Do not implement yet.

When ready:

> Implement the proposed tests using .agents/skills/project-testing/SKILL.md. Reuse this repository's existing framework and fixtures. Run the relevant checks and report changed files, exact commands, pass/fail/skip results and remaining gaps. Use only a disposable test environment for database-backed tests.

Codex should inspect manifests, test configuration, existing tests and CI before choosing commands. It should cover normal behavior, boundaries, error paths and relevant isolation, then run targeted tests followed by required broader checks. If no runner exists, it should explain the gap and propose a setup before adding dependencies. Connecting alone does not generate or execute a suite, and captured prompts are not proof that tests passed.

## 6. Diagnose missing prompts

Run from the plugin directory with the capture credential set:

```powershell
node src/cli.ts doctor --root "D:\Downloads\coznt"
node src/cli.ts flush --root "D:\Downloads\coznt"
```

| Diagnostic | Meaning and next action |
| --- | --- |
| `connected: false` | Run `connect` for this exact path. |
| Missing credential | Set the reported `tokenEnv` before starting Codex. |
| `service unreachable` | Start the service using the correct data directory and URL. |
| `HTTP 401` | Credential is invalid/revoked; obtain a valid project credential. |
| Observer identity | Use an agent credential for capture. |
| No `lastPromptInvocation` | Updated hook has not run here. Check plugin version, `/hooks`, trust, root and host environment. Old runtimes do not write these receipts. |
| Invocation says credential missing | The prompt was not captured; restart Codex with the environment set and send a new prompt. |
| `lastPromptCaptured`, queue pending | Capture is durable but delivery is pending. Restore service/authentication and flush with the original credential. |
| `lastPromptDelivered`, prompt absent in view | Verify the dashboard project and user, clear filters and enable live updates. |

Administrators/observers see project events; agents see their own events. The CLI's current environment is not proof of another running process's environment. Receipt timestamps are historical; compare them with your new prompt. Events are never reassigned to a different credential. Connection does not import old Codex conversations, and `flush` cannot recover prompts that never reached the hook.

## 7. Repeat for another local project

Keep one service running and one global plugin installation. Create a different project ID, issue that project's agent credential, then replace the repository path, project ID and token variable in step 3. For example, use project `weather-api`, path `D:\Projects\weather-api`, and `WEATHER_AGENT_TOKEN`. Edit that repository's own skills. Its logs, policies, credentials and local overrides remain separate from Coznt.
