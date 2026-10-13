# Install once, connect each repository

Lumora is the platform. This plugin works with any connected local repository. The stable package ID remains `lumora-governance` for upgrade compatibility; the skills are `project-governance`, `project-review`, and `project-testing`.

## Install or update the local package

The catalog at `dist/.agents/plugins/marketplace.json` points to `dist/lumora-governance-0.2.0`. Keep this directory in place.

```powershell
codex.cmd plugin marketplace add "D:\Downloads\plugin_based_agent\dist"
codex.cmd plugin add lumora-governance@lumora-local
```

For an already registered local marketplace, rerun the second command after updating its catalog/package. Git marketplace upgrade is for Git sources. Check the reported installed version; if the host retains the previous version, use its remove/add workflow for this plugin. Restart Codex, verify the enabled package and review/trust changed hooks via `/hooks`. The current conversation may retain old skill descriptions until restarted.

Choose one hook installation route. If previously using project-local hooks, remove only this product's entries before enabling global plugin hooks:

```powershell
node src/cli.ts uninstall --root "<repository path>"
```

## Connect a project

From the product directory, create a separate project in the local pilot service:

```powershell
node src/cli.ts init --project weather-api --name "Weather API" --user manager
node src/cli.ts serve
```

`init` prints the administrator credential once. Save it securely. Use it in the dashboard at `http://127.0.0.1:4318` to issue a developer credential. If the service already runs against this data directory, do not start another on the same port. Use a different project ID per independent repository. The optional live Lumora adapter later maps these to platform projects.

In the PowerShell terminal that will launch Codex:

```powershell
cd D:\Downloads\plugin_based_agent
$env:WEATHER_AGENT_TOKEN = "<developer credential for weather-api>"
node src/cli.ts profile --root "D:\Projects\weather-api"
node src/cli.ts connect --root "D:\Projects\weather-api" --project weather-api --token-env WEATHER_AGENT_TOKEN
node src/cli.ts sync --root "D:\Projects\weather-api"
node src/cli.ts doctor --root "D:\Projects\weather-api"
cd D:\Projects\weather-api
codex.cmd
```

Use the actual path and ID. Add `.lumora-agent/` to the repository's local ignore rules before capture. `connect` saves metadata, never credentials, and preserves existing connections. A new terminal needs its own environment credential; variables in the plugin development terminal are not automatically available elsewhere.

Repeat connection setup for each project, not plugin installation. Use distinct `--token-env` names when multiple projects share a host process. Connection lookup walks upward, stopping at Git boundaries; independent nested repositories require separate connections. Hooks are inactive in unconnected repositories.

## Upgrade existing project skills and policy

Updating the plugin cache does not replace the platform's approved skill release. Existing projects may still publish the old Lumora-specific `1.0.0` release. With the project's administrator credential in its configured token environment variable:

```powershell
node src/cli.ts publish --root "<connected repository>" --skills skills --version 2.0.0
node src/cli.ts sync --root "<connected repository>"
```

New `init` projects seed generic skills at release `2.0.0`. Versions are immutable; choose a new version if that one already exists with different content. Sync removes only unchanged, receipt-owned old skill files. Modified or unowned files require review. A live Lumora skill source must also have its approved release updated on Lumora.

Existing saved policies retain their settings, including `blockDatabasePush: true`. Administrators can change them in Policy controls or through the CLI. New projects default to no DB-push restriction and no project-specific source rules. See [Project rules](PROJECT_RULES.md).

The testing skill helps Codex write and run appropriate tests when requested. Connecting alone does not execute a complete test suite or guarantee all defects will be found.

Reference: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins).
