# NPX, MCP, Hooks and Plugins for AI Coding Agents (Claude Code and Codex CLI)
### A complete learning guide for a junior developer: one-day course and reference

---

## 0. HOW TO USE THIS DOCUMENT (instructions for the AI assistant reading it)

You are acting as a patient mentor for a **junior developer** learning how AI coding agents are extended. This document is your knowledge base. When the learner asks questions:

1. Answer from this document first. Explain in plain language, then show a small example.
2. Teach step by step. Never dump everything at once. Ask the learner what they have tried.
3. Use the **Day Plan (Section 2)** as the default curriculum if the learner says "teach me" or "start".
4. Use the **Exercises (Section 11)** for hands-on practice. Have the learner run things and report results, and help them debug.
5. Use the **Quiz (Section 14)** when they say "test me".
6. This area changes fast. Facts here are marked **[Verified]** (checked against official documentation at time of writing, October 2026), **[Community]** (from community write-ups, so double-check), or **[Check]** (likely true but the learner should confirm in official docs or with `--help`). Tell the learner to verify anything marked **[Community]** or **[Check]** before relying on it, and prefer the official docs when they disagree with this file.
7. Be honest when you don't know. Do not invent flags, config keys, or event names.
8. Safety first: remind the learner to practice in a throwaway sandbox folder or repo, never on production code, secrets, or databases.

Official documentation entry points:
- Claude Code docs: `https://code.claude.com/docs` (hooks reference at `/en/hooks`, plugins reference at `/en/plugins-reference`, a docs index at `/llms.txt`)
- Codex CLI docs: OpenAI developer docs (`developers.openai.com/codex/...`). Codex pages for hooks, subagents and AGENTS.md exist there.
- MCP specification and server list: `modelcontextprotocol.io`

---

## 1. THE BIG PICTURE (read this first)

### 1.1 The most important correction

**NPX does not manipulate files in your IDE.** NPX is a tool that *downloads and runs a command-line program* from the npm registry (or from your project). Whatever that program does, it does with *your user's permissions*. If the program writes files (like `create-next-app` does), then files appear. NPX is just the launcher.

So where does "AI touching files in my IDE" come from? From three separate things:

| Mechanism | Who touches the files | Where NPX fits |
|---|---|---|
| The agent's **built-in tools** (read file, edit file, run shell command) | The AI agent (Claude Code / Codex) | Not involved |
| **MCP servers** (extra tools the agent can call) | The MCP server program | Very often launched *with* `npx` |
| **Hooks** (scripts that run on agent events) | Your own script | Scripts often call `npx prettier`, `npx eslint`, etc. |

Mental model: **The agent is the brain, tools are its hands, MCP is a plug socket for extra hands, hooks are guard rails and automation around the hands, plugins are a box that ships all of it to other people. NPX is a way to start some of the hands.**

### 1.2 The layers of customization (lightest to heaviest)

1. **Instruction files**: `CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex). Plain-text rules the model reads. It *should* follow them, but it is not guaranteed.
2. **Skills**: folders with a `SKILL.md` describing a repeatable workflow the agent can load when relevant.
3. **MCP servers**: external tools and data sources (filesystem, databases, browsers, issue trackers).
4. **Subagents**: specialized helper agents with their own instructions.
5. **Hooks**: scripts that run automatically at lifecycle events. These are **deterministic**: they run every time, regardless of what the model "remembers".
6. **Plugins**: an installable package that bundles skills, agents, hooks, MCP servers, and more.

**Golden rule:** use **hooks for anything that must always happen**; use **instruction files for anything the model should merely know**. [Verified: this framing is widely used and consistent with the official docs.]

---

## 2. THE ONE-DAY PLAN (about 7 hours plus breaks)

| Time | Block | Goal |
|---|---|---|
| 0:00–0:45 | 1. NPX basics | Understand what `npx` does and its risks |
| 0:45–1:30 | 2. The extension map | Know the 6 layers and when to use each |
| 1:30–2:30 | 3. MCP via NPX | Give an agent extra tools; see files get created |
| 2:30–3:30 | Lunch / break | |
| 3:30–5:00 | 4. Hooks | Write 4 working hooks |
| 5:00–6:30 | 5. Build a plugin | Package hooks + skill + MCP |
| 6:30–7:00 | 6. Share and secure | Marketplaces and a security checklist |
| 7:00–7:45 | Capstone | A plugin for a Next.js/Node/Postgres project |

Stuck? Do the exercises in Section 11 in order and ask the AI mentor to review your results.

---

## 3. NPX FUNDAMENTALS

### 3.1 What it is

- `npm` is the package manager and registry for JavaScript/Node.
- `npx` ("npm execute") **runs a package's executable**. If it is already installed locally in the project (`node_modules/.bin`), npx uses that. If not, it downloads it into a cache and runs it. [Verified: standard npm behavior.]
- `npx` ships with Node.js/npm. Check with `node -v` and `npx -v`.

### 3.2 Common usage

```bash
npx cowsay "hello"                      # run a one-off tool
npx create-next-app@latest my-app       # scaffold a project (this tool writes files)
npx prettier --check .                  # run a locally installed tool, or fetch it
npx -y some-package                     # -y / --yes: skip the "OK to install?" prompt
npx some-package@1.2.3                  # pin an exact version (recommended for safety)
npx --no-install prettier --write file  # only use what's installed; never download [Check flag name with `npx --help` on your npm version]
```

### 3.3 What happens under the hood

1. npx looks for the command in your project's `node_modules/.bin` and your PATH.
2. If missing, it fetches the package from the registry into a cache folder.
3. It runs the package's declared binary with the arguments you gave.
4. The program runs **with your full user permissions**: it can read, write, delete files you can, and use the network.

### 3.4 Why this matters for AI tooling

Many MCP servers and helper scripts are distributed as npm packages, so config files say things like `"command": "npx", "args": ["-y", "some-mcp-server"]`. That means *every time the agent starts that server, you are downloading and running third-party code*.

### 3.5 Security rules for NPX

- **Pin versions** (`pkg@1.2.3`) in shared configs. `@latest` or unpinned means the code can change under you.
- Only run packages from authors/organizations you trust. Check the npm page, download counts, repository, and maintainers.
- Beware **typosquatting** (a malicious package with a name almost identical to a popular one).
- `-y` removes the safety prompt. Use it only for packages you've already vetted, and especially in automated configs.
- Scope file access: when a tool asks for allowed directories, give the smallest folder possible.
- Never put secrets in command-line arguments in committed configs.

### 3.6 Hands-on mini-lab (see also Exercise 1)

```bash
mkdir npx-lab && cd npx-lab
npx cowsay "hello"                  # nothing is written to disk in your project
npx create-next-app@latest demo     # a folder with many files appears
```
Question to answer: *who created those files: npx, your IDE, or the package's code?* (Answer: the package's code. Your IDE just shows the changes.)

---

## 4. HOW AI CODING AGENTS ACTUALLY WORK WITH FILES

An agent such as Claude Code or Codex CLI runs a loop:

1. You give a task.
2. The model decides to call a **tool** (read a file, edit a file, run a shell command, call an MCP tool).
3. The tool runs, the result goes back to the model.
4. Repeat until done.

Where hooks plug in: **before** a tool runs, **after** it runs, when you submit a prompt, when the session starts or ends, when the agent finishes responding, and so on.

Where MCP plugs in: it adds **more tools** to step 2.

Where instruction files plug in: they are text loaded into the model's context at the beginning of the session.

Where IDEs plug in: IDE extensions (for example, a VS Code extension) show diffs, selections and open files, and they host the same agent. The agent edits the files on disk; the IDE displays the changes. [Verified: sessions started from the VS Code extension use the same hooks and config system; note that you can't pass CLI flags there, which is one reason hooks are useful.]

---

## 5. INSTRUCTION FILES

### 5.1 Claude Code: `CLAUDE.md`
Project rules, conventions, commands to run tests, architecture notes. Loaded automatically. Keep it short and specific.

### 5.2 Codex CLI: `AGENTS.md`
- `AGENTS.md` = project instructions (typically committed to git).
- `~/.codex/AGENTS.md` = global defaults for every repo.
- Each directory can contribute one file: `AGENTS.override.md` if present, else `AGENTS.md`. Codex concatenates them from the repo root down to the current directory. [Verified from the Codex CLI reference.]
- `AGENTS.override.md` is a good place for **local, uncommitted** overrides. [Community]
- Very long files may get truncated, so keep it concise. [Community]

### 5.3 What belongs in an instruction file
- How to run, build, test, and lint
- Coding conventions and architecture rules
- "Never do X" rules (but remember: these are *requests*. For guarantees, use hooks.)

### 5.4 Example snippet (adapt it)
```markdown
# Project rules
- Stack: Next.js (React), Node.js API, Postgres. 3 tiers: frontend / backend / database.
- Before adding a new API call, search for an existing one and extend it so it is reusable.
- Database schema changes need explicit human approval and a full written spec first.
- Run `npm run lint` and `npx tsc --noEmit` before finishing a task.
```

---

## 6. MCP (MODEL CONTEXT PROTOCOL) AND NPX

### 6.1 What MCP is
An open standard for connecting AI agents to external tools and data. An **MCP server** exposes tools (functions the model can call), and sometimes resources and prompts. The agent is the **MCP client**.

### 6.2 Two transport styles
- **stdio**: the agent *launches the server as a child process* on your machine and talks over standard input/output. This is where `npx` appears: the launch command is `npx -y some-package`.
- **HTTP (remote)**: the agent connects to a URL. Often uses OAuth login.

### 6.3 Adding an NPX-launched server

Codex CLI [Verified from the Codex CLI reference]:
```bash
codex mcp add my-server -- npx my-mcp-server     # stdio
codex mcp add remote --url https://example.com/mcp   # HTTP
codex mcp list
codex mcp login my-server       # OAuth, opens a browser
```
Inside Codex, `/mcp` lists configured MCP tools.

Codex config file form (`~/.codex/config.toml` or project `.codex/config.toml`, trusted projects only for the project file) [Verified: config file locations; Check: exact key names against current docs]:
```toml
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem@<pinned-version>", "/absolute/path/to/sandbox"]
```

Claude Code [Check exact syntax with `claude mcp --help`]:
```bash
claude mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem@<pinned-version> /absolute/path/to/sandbox
claude mcp list
```
Or a project-level `.mcp.json`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem@<pinned-version>", "/absolute/path/to/sandbox"]
    }
  }
}
```
(Package names and versions change over time. Look up the current name and a trusted version on npm before using.)

### 6.4 "Filesystem" MCP servers and your IDE's files
A filesystem MCP server gives the agent tools like list, read, write, and search files, **restricted to the directories you pass as arguments**. This is a clear demonstration of "NPX launching something that manipulates files": npx starts the server; the server's code (called by the agent) reads and writes files; your IDE then shows the new content.

### 6.5 MCP safety
- Give the **smallest** directory scope and the least privilege.
- Treat each MCP server as third-party code with your permissions.
- Beware **prompt injection**: text inside files, web pages, or tool results can contain instructions that try to hijack the agent. Don't give broad file or shell access to an agent that also reads untrusted content without guardrails (permissions, hooks).
- Pin versions; review the source for anything that can write files, run commands, or reach the network.

---

## 7. SKILLS AND SUBAGENTS

### 7.1 Skills
- A skill is a folder containing a `SKILL.md` (a markdown file with a short name and description in front-matter, plus instructions) and optionally helper files.
- The agent can load a skill when the task matches its description. In Claude Code plugins, skills live under `skills/<skill-name>/SKILL.md` and also become `/name` shortcuts. [Verified]
- Good for: "how we write API handlers", "how to review a PR", "how we design DB changes".

### 7.2 Subagents
- Specialized agents with focused instructions. In Claude Code plugins they live in an `agents/` folder and appear in the `/agents` interface. [Verified]
- In Codex they are TOML files, for example `.codex/agents/security-reviewer.toml` with fields like sandbox mode and developer instructions. [Community, Check]
- Security note: in Claude Code, **plugin-shipped agents cannot define `hooks`, `mcpServers`, or `permissionMode`**. [Verified]

---

## 8. HOOKS (THE DETERMINISTIC LAYER)

### 8.1 Definition
Hooks are user-defined **shell commands, HTTP endpoints, or LLM prompts** that execute automatically at specific points in the agent's lifecycle. [Verified]

When an event fires and the *matcher* matches, the agent passes **JSON context** to your handler. For command hooks, that JSON arrives on **stdin**. [Verified]

### 8.2 Event cadences (Claude Code) [Verified]
- **Once per session:** `SessionStart`, `SessionEnd`
- **Once per turn:** `UserPromptSubmit`, `Stop`, `StopFailure`
- **On every tool call:** `PreToolUse`, `PostToolUse`

Other documented events include `Notification` (when the agent sends a notification) and `Setup` (when started with certain init flags). Community references count roughly **30 events** as of mid-2026 (including things like subagent and compaction-related events). Don't memorize them all; check the official hooks reference for the current list. [Verified count source: community references; Check the official list]

Key events for beginners:

| Event | When it fires | Typical use |
|---|---|---|
| `SessionStart` | A session begins or resumes | Inject project context, print reminders |
| `UserPromptSubmit` | You send a prompt | Add context, validate prompts |
| `PreToolUse` | Before a tool call | **Block or approve** dangerous actions |
| `PostToolUse` | After a tool call | Auto-format, lint, run tests |
| `Stop` | The agent finishes responding | Final checks, notifications |
| `SessionEnd` | Session closes | Cleanup, logging |

**About `SessionStart`:** it carries a `source` value telling you why it fired (startup, resume, clear, or compact). For `SessionStart`, `UserPromptSubmit` (and a couple of related events), **plain text printed to stdout is added as context the model can see**. For most other events stdout only goes to the debug log. [Verified]

### 8.3 Exit codes and output (very important)
- **Exit 0**: success. The agent parses stdout for optional JSON output fields. [Verified]
- **Exit 2**: a **blocking error** for events that can block. stdout/JSON is ignored, and **stderr is fed back to the agent** as the reason. [Verified]
- **Any other exit code (including 1)**: a **non-blocking error**; the action proceeds. This surprises many people because `1` is the usual Unix failure code. [Verified]
- Roughly half of the events can block on exit 2. [Community]

### 8.4 Where hooks are configured (Claude Code) [Verified]
| Location | Scope | Shared? |
|---|---|---|
| `~/.claude/settings.json` | All your projects | No |
| `.claude/settings.json` | One project | Yes (commit it) |
| `.claude/settings.local.json` | One project | No (gitignored) |
| Plugin `hooks/hooks.json` | While the plugin is enabled | Yes, bundled with the plugin |

### 8.5 Configuration shape (Claude Code settings) [Verified shape; Check details against the current reference]
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/block-dangerous.js\""
          }
        ]
      }
    ]
  }
}
```
- `matcher` selects which tool(s) or sources trigger the hook (for example `Bash`, or `Edit|Write`). Community notes say matchers can behave like regular expressions, so a short name may also match longer names; test your matcher. [Community]
- `${CLAUDE_PROJECT_DIR}` points to the project root. [Verified]
- Defaults for timeouts exist (community sources mention 60 seconds for command hooks). Keep hooks fast. [Community]

### 8.6 Plugin `hooks/hooks.json` uses a **wrapper** format [Community, consistent with the plugin docs]
Inside a plugin the events sit under a top-level `"hooks"` key:
```json
{
  "description": "Quality gates for this plugin",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/format-on-edit.js\"" }
        ]
      }
    ]
  }
}
```

### 8.7 Hook types
- **command**: runs a script (most common; gets JSON on stdin).
- **HTTP**: posts the event to a URL. [Verified exists]
- **prompt**: asks an LLM to evaluate (community sources say it's supported on a subset of events such as `Stop`, `UserPromptSubmit`, `PreToolUse`). [Community]
- **MCP tool hooks** also exist per the reference. [Verified exists; Check details]

### 8.8 Example hooks (Node.js; works well in a Node stack)

**A. SessionStart: give the agent project context**
```js
#!/usr/bin/env node
// .claude/hooks/session-start.js
// Anything printed to stdout on SessionStart is added as context.
console.log(`Project rules reminder:
- Stack: Next.js + Node.js + Postgres, 3-tier.
- Reuse existing API calls; do not add near-duplicate endpoints.
- DB schema changes require explicit human approval.`);
process.exit(0);
```

**B. PreToolUse: block dangerous shell commands**
```js
#!/usr/bin/env node
// .claude/hooks/block-dangerous.js
let data = '';
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  const input = JSON.parse(data);
  const cmd = (input.tool_input && input.tool_input.command) || '';
  if (/\brm\s+-rf\b/.test(cmd) || /\bgit\s+push\s+--force\b/.test(cmd)) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Blocked by team policy: destructive command.'
      }
    }));
  }
  process.exit(0);
});
```
(The `permissionDecision: deny` JSON pattern blocks the tool call and shows the reason to the agent. [Verified])

**C. PreToolUse with exit code 2: protect database files**
```js
#!/usr/bin/env node
// .claude/hooks/protect-db.js
let data = '';
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  const input = JSON.parse(data);
  const file = (input.tool_input && input.tool_input.file_path) || '';
  if (/(^|\/)(migrations|prisma\/schema\.prisma|schema\.sql)/.test(file)) {
    console.error('Database/schema files are protected. Ask a human for a written spec and approval first.');
    process.exit(2); // block and tell the agent why via stderr
  }
  process.exit(0);
});
```
Matcher for this hook: `Edit|Write` (adjust to the tool names your agent uses; **[Check]** tool names in the docs).

**D. PostToolUse: auto-format edited files**
```js
#!/usr/bin/env node
// .claude/hooks/format-on-edit.js
const { execFileSync } = require('child_process');
let data = '';
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  const input = JSON.parse(data);
  const file = (input.tool_input && input.tool_input.file_path) || '';
  if (/\.(ts|tsx|js|jsx|json|css)$/.test(file)) {
    try {
      // --no-install: use the project's prettier; never download code silently
      execFileSync('npx', ['--no-install', 'prettier', '--write', file], { stdio: 'ignore' });
    } catch (e) { /* formatting problems must not break the session */ }
  }
  process.exit(0);
});
```
Notice how this is where **NPX appears inside a hook**, and why `--no-install` is a good safety habit.

**E. Stop: final check**
Run a quick `npx tsc --noEmit` or a test subset and print failures so the agent sees them. Keep it fast, and watch for infinite loops (some Stop-type events report whether a stop hook is already active, for example `stop_hook_active`). [Verified field exists in community reference]

### 8.9 Hook input JSON: common fields [Check against the docs]
Typical fields include the session id, transcript path, current working directory, event name, and (for tool events) `tool_name` and `tool_input`. Print the stdin JSON to a file during development to see exactly what you get:
```js
require('fs').appendFileSync('/tmp/hook-debug.log', data + '\n');
```

### 8.10 Debugging hooks
- Run your script manually: `echo '{"tool_input":{"command":"rm -rf x"}}' | node block-dangerous.js`
- Check `chmod +x` for shell scripts; use absolute paths or `${CLAUDE_PROJECT_DIR}`.
- Remember exit 1 does **not** block. Use exit 2 or the JSON deny.
- Keep hooks fast and silent; slow hooks make the agent feel broken.
- In Claude Code, `/hooks` lists configured hooks; in Codex, `/hooks` manages lifecycle hooks. [Verified for Codex slash command list; Check Claude]

### 8.11 Hook safety
- Hooks run **with your permissions** and execute automatically. Read every hook in a plugin before enabling it.
- Never let a hook `eval` or run text from the model or the prompt without validation.
- Don't log secrets.

---

## 9. PLUGINS (CLAUDE CODE)

### 9.1 What a plugin is
The highest-level extension package. It can bundle **skills, agents, hooks, MCP servers, LSP (language server) configs, and monitors**. [Verified]

### 9.2 Directory layout [Verified]
```
my-plugin/
├── .claude-plugin/
│   └── plugin.json        # REQUIRED manifest (name, version, description, author)
├── skills/
│   └── code-reviewer/
│       └── SKILL.md
├── agents/                # subagent definitions
├── hooks/
│   └── hooks.json         # lifecycle handlers (wrapper format)
└── .mcp.json              # MCP servers (optional)
```
- **Only `plugin.json` goes inside `.claude-plugin/`.** Do NOT put `skills/`, `agents/`, `hooks/` there. This is the #1 beginner mistake. [Verified]
- Every other folder is optional: a plugin can be skills-only, hooks-only, or any mix. [Verified]
- Use `${CLAUDE_PLUGIN_ROOT}` for paths to files inside the installed plugin. [Verified]

### 9.3 Minimal `plugin.json`
```json
{
  "name": "team-standards",
  "version": "0.1.0",
  "description": "Hooks and skills for our Next.js/Node/Postgres projects",
  "author": { "name": "Your Team" }
}
```
(Field names beyond name/version/description/author: check the plugin reference.)

### 9.4 Testing locally [Verified]
```bash
claude --plugin-dir ./my-plugin
claude --plugin-dir ./my-plugin --plugin-dir ./another-plugin
```
Inside the session a reload command re-reads manifests, skills, agents, hooks, and MCP configs. [Verified that a reload exists; Check the command name in your version.]

### 9.5 Distribution: marketplaces [Verified]
- A marketplace is a JSON file (`.claude-plugin/marketplace.json`) in a git repo that lists plugins and where to find them.
- The official one is called `claude-plugins-official`.
- Commands:
```bash
/plugin marketplace add owner/repo-name
/plugin install plugin-name@marketplace
claude plugin install plugin-name@marketplace --scope user
claude plugin enable|disable|update|uninstall plugin-name@marketplace
```
- Teams can pre-register marketplaces in `.claude/settings.json`. [Community]
- Enterprises can control which MCP servers plugins may use through managed configuration. [Community]

### 9.6 Plugin security checklist
1. Read `plugin.json`, every hook script, `.mcp.json` and any `npx` commands in them.
2. Are NPX packages pinned to exact versions?
3. Does any hook run network calls or send file contents elsewhere?
4. What file paths can the MCP servers access?
5. Who maintains the marketplace repo, and who can merge into it?

---

## 10. CODEX CLI EQUIVALENTS

Everything below is summarized from the Codex CLI reference plus community write-ups. **Verify details in the official Codex docs**, as Codex releases frequently.

| Concept | Codex CLI |
|---|---|
| Instructions | `AGENTS.md`, `~/.codex/AGENTS.md`, `AGENTS.override.md` [Verified] |
| Config | `~/.codex/config.toml` (user), `.codex/config.toml` (project, trusted projects), profiles, `/etc/codex/config.toml` (system defaults on Unix) [Verified] |
| MCP | `codex mcp add/list/login`, `/mcp` in the app, or `[mcp_servers.*]` in config.toml [Verified] |
| Hooks | `~/.codex/hooks.json` (user) and `<repo>/.codex/hooks.json` (repo); `/hooks` to manage [Verified locations] |
| Plugins | `codex plugin ...` commands and `/plugins` to browse; plugins were introduced around March 2026 and bundle skills, app integrations and MCP configs [Verified from CLI reference and a community article] |
| Subagents | TOML files, e.g. `.codex/agents/<name>.toml` [Community] |
| Non-interactive | `codex exec "task"`, `codex review` [Verified] |
| Diagnostics | `codex doctor` [Verified] |

Notes:
- Community sources say hooks may need to be switched on with a feature flag in `config.toml` (names such as `hooks` or `codex_hooks` appear in different guides). **Check the current docs** for the correct key in your version. [Check]
- Community sources mention hook events like `PreToolUse` and `PostToolUse`, plus newer ones (for example subagent start and compaction hooks) added in recent versions. The event list differs from Claude Code's. Look at `/hooks` and the docs. [Community]
- A common portable approach: write hook logic as standalone Node/Python scripts that read JSON from stdin; only the small config file differs between agents.

---

## 11. EXERCISES (do in a throwaway folder)

### Exercise 1: NPX basics (20 min)
1. `mkdir npx-lab && cd npx-lab && npm init -y`
2. `npx cowsay "hi"`. Does anything get written to disk? (No, only cache.)
3. `npx create-next-app@latest demo`. List what was created. Who wrote it?
4. Find the npx cache folder on your OS (hint: ask the AI mentor; check `npm config get cache`).
5. Write 3 sentences: what risks come with `npx -y`?

### Exercise 2: Extension map (15 min)
For each need, name the best layer (instruction file / skill / MCP / subagent / hook / plugin):
- "Always format files after edits" → ?
- "Our API naming conventions" → ?
- "Query our issue tracker" → ?
- "Never run `rm -rf`" → ?
- "Give all 20 developers the same setup" → ?
(Answers: hook; instruction file or skill; MCP; hook (a guarantee) plus instruction file; plugin.)

### Exercise 3: Filesystem MCP via NPX (40 min)
1. Create `~/mcp-sandbox` with two text files.
2. Add a filesystem MCP server scoped to **only** that folder (Section 6.3).
3. Ask the agent: "list files, then create `notes.md` summarizing both."
4. Check the new file in your IDE.
5. Try asking it to read a file **outside** the sandbox. What happens? Why?
6. Write down which process actually wrote `notes.md`.

### Exercise 4: Four hooks (80 min)
Create `.claude/hooks/` (or the Codex equivalent) and implement, then test:
1. `SessionStart` context printer (Section 8.8-A)
2. `PreToolUse` blocker for `rm -rf` (8.8-B)
3. `PreToolUse` guard for schema/migration files (8.8-C)
4. `PostToolUse` formatter (8.8-D)

For each: run the script manually with a fake JSON input first, then wire it in, then trigger it through the agent. Record in a table: event, matcher, what happened, exit code used.

### Exercise 5: Exit code experiments (15 min)
Make the guard hook use `exit 1` instead of `exit 2`. Does it block? Switch back. Explain why.

### Exercise 6: Build a plugin (60 min)
1. Create `team-standards/.claude-plugin/plugin.json`.
2. Move your hooks into `team-standards/hooks/` with a wrapper `hooks.json` using `${CLAUDE_PLUGIN_ROOT}`.
3. Add `skills/db-change-checklist/SKILL.md` with a checklist for database changes.
4. Run `claude --plugin-dir ./team-standards` and confirm the hooks and skill work.
5. Break it on purpose (put `hooks/` inside `.claude-plugin/`) and see the failure; then fix it.

### Exercise 7: Capstone, a plugin for a Next.js + Node + Postgres team (45 min)
- `SessionStart`: inject team rules (reuse existing API calls instead of adding similar ones; DB changes need full written detail first).
- `PreToolUse`: block edits to schema/migration files unless a human has approved.
- `PostToolUse`: run ESLint and `tsc --noEmit` on changed TypeScript files (use `npx --no-install`).
- A skill: "design review checklist" that asks about data model, indexes, auth, performance, request counts per page, and rollback plan.
- Present it to a teammate and defend each design choice.

### Exercise 8: Security review (20 min)
Take any open-source plugin or MCP config. Apply the checklist in Section 9.6 and write a 5-line risk assessment.

---

## 12. COMMON MISTAKES AND TROUBLESHOOTING

| Symptom | Likely cause | Fix |
|---|---|---|
| Hook doesn't block | Used `exit 1` | Use `exit 2` or the JSON `deny` response |
| Hook never fires | Wrong event name, wrong matcher, wrong file location, or config not reloaded | Check spelling/case, test matcher, restart session, check `/hooks` |
| Plugin loads but nothing works | Components placed inside `.claude-plugin/` | Move `skills/ agents/ hooks/` to the plugin root |
| Plugin hooks ignored | Missing wrapper `{"hooks": {...}}` in `hooks/hooks.json` | Use the wrapper format |
| Script not found in plugin | Hard-coded path | Use `${CLAUDE_PLUGIN_ROOT}` |
| `npx` hangs at start | Interactive "Ok to proceed?" prompt inside an automated launch | Pin the version and use `-y` only after vetting, or install the dependency locally |
| MCP server won't start | Wrong command, missing Node, network blocked | Run the same `npx` command manually in a terminal |
| Agent can read files outside the sandbox | Directory scope too wide | Re-check the arguments given to the server |
| Agent ignores a rule in `CLAUDE.md`/`AGENTS.md` | Instruction files are advisory | Enforce with a hook |
| Slow sessions | Heavy hooks (full test suites on every edit) | Move to `Stop` or run a subset |
| Formatter edits cause loops | Hook changes file, which triggers more edits | Make hooks idempotent; format only the changed file |

---

## 13. SECURITY MINDSET (summary)

1. Everything launched by `npx`, MCP, or hooks runs with **your** permissions.
2. Pin versions. Prefer local installs over `npx -y` downloads in hooks (`--no-install`).
3. Scope file access narrowly. Sandbox first.
4. Treat file contents, web pages, and tool outputs as possibly hostile (prompt injection).
5. Review plugins like you review dependencies: manifest, scripts, MCP configs, network calls.
6. Keep secrets out of config files that are committed.
7. Use hooks to enforce hard rules; don't rely on the model to remember them.
8. Keep AI-generated local-only test scripts or experiments out of git if the team wants them local (for example via `.git/info/exclude` or a local override file), and never wire them into CI by accident.

---

## 14. SELF-QUIZ (the AI mentor can ask these one at a time)

1. What does `npx` do when a command isn't installed locally?
2. Does NPX itself edit files in your IDE? Explain who does.
3. Name three layers of agent customization and one use for each.
4. Which exit code blocks a tool call in a hook? What happens with exit 1?
5. Name the events that fire once per session, once per turn, and on every tool call.
6. Where does the stdout of a `SessionStart` hook go?
7. What is the only file allowed in `.claude-plugin/`?
8. What variable do you use for paths inside an installed plugin?
9. Why use `npx --no-install` inside a hook?
10. Give two risks of running an unpinned MCP server via `npx -y`.
11. Which is more reliable for "always format after edit", `CLAUDE.md` or a hook? Why?
12. How would you test a plugin locally before sharing it?
13. Where do Codex hooks live?
14. What is `AGENTS.override.md` for?

### Answer key (for the mentor)
1. Downloads it to a cache and runs it. 2. No; the package's code or the agent's tools do. 3. Any three from Section 1.2. 4. Exit 2 (or JSON deny); exit 1 is non-blocking. 5. Session: `SessionStart`/`SessionEnd`. Turn: `UserPromptSubmit`/`Stop`. Tool: `PreToolUse`/`PostToolUse`. 6. It's added as context for the model. 7. `plugin.json`. 8. `${CLAUDE_PLUGIN_ROOT}`. 9. Avoid silently downloading and running code. 10. Code can change; supply-chain attacks; broad file access. 11. A hook; it's deterministic. 12. `claude --plugin-dir ./my-plugin`. 13. `~/.codex/hooks.json` and `<repo>/.codex/hooks.json`. 14. Local overrides layered over `AGENTS.md`.

---

## 15. GLOSSARY

- **NPX**: runs npm package executables.
- **npm registry**: public store of JavaScript packages.
- **Agent**: AI loop that plans and calls tools.
- **Tool**: a function the agent can call (read, edit, shell, MCP tool).
- **MCP**: open protocol that lets agents use external tools and data.
- **MCP server / client**: the provider of tools / the agent that uses them.
- **stdio transport**: the agent starts the server as a subprocess and talks over stdin/stdout.
- **Hook**: script, HTTP endpoint, or prompt triggered by a lifecycle event.
- **Matcher**: filter that decides which tool or source triggers a hook.
- **Skill**: folder with `SKILL.md` describing a reusable workflow.
- **Subagent**: specialized helper agent.
- **Plugin**: installable bundle of skills, agents, hooks, MCP servers and more.
- **Marketplace**: catalog (JSON) of plugins.
- **Prompt injection**: malicious instructions hidden in content the agent reads.
- **Supply-chain risk**: danger from third-party code you depend on.
- **Idempotent**: running it twice gives the same result as once.

---

## 16. SUGGESTED PROMPTS FOR THE LEARNER

Paste these into the AI after uploading this file:
- "Teach me Block 1 (NPX basics) step by step. Wait for me after each step."
- "Quiz me on hooks, one question at a time, and explain my mistakes."
- "Review my `hooks.json`. Here it is: ..."
- "Why isn't my PreToolUse hook blocking? Here's my script and config."
- "Compare Claude Code hooks and Codex hooks for the same guard rule."
- "Explain this plugin's security risks: (paste its files)."
- "Help me design a plugin for our team's Next.js/Node/Postgres workflow."
- "Explain it to me like I'm new to the terminal."

---

## 17. FURTHER READING (go to the source)

- Claude Code hooks reference and the hooks guide (official docs site, `/en/hooks`, `/en/hooks-guide`)
- Claude Code plugins reference (`/en/plugins-reference`)
- Codex CLI docs on hooks, subagents, AGENTS.md, MCP, plugins (OpenAI developer docs)
- Model Context Protocol documentation (`modelcontextprotocol.io`)
- npm documentation for `npx` / `npm exec`


*Document status: written October 2026. Features in this space change monthly. When anything here disagrees with the official documentation or `--help` output, trust the official source and tell the learner what changed.*