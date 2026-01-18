# GORA - Code Editing Agent Specification

> A TypeScript CLI tool for solo developers that prioritizes context efficiency, customization, and code quality through intelligent multi-agent orchestration.

## Table of Contents

1. [Vision & Goals](#vision--goals)
2. [Architecture Overview](#architecture-overview)
3. [Agent System](#agent-system)
4. [Context Management](#context-management)
5. [Persistence Model](#persistence-model)
6. [Feedback Loops](#feedback-loops)
7. [CLI Interface](#cli-interface)
8. [Configuration](#configuration)
9. [Security & Safety](#security--safety)
10. [Technical Requirements](#technical-requirements)

---

## Vision & Goals

### Core Problem

Existing AI coding tools (Claude Code, Cursor, Aider) struggle with:

- **Context pollution**: Long sessions accumulate stale context, degrading performance
- **Limited customization**: Rigid behavior that doesn't adapt to project-specific needs

### Solution

Gora is a CLI tool that solves these through:

- **Context efficiency**: Subagent architecture with automatic garbage collection (Ralph-style)
- **Customization**: User-defined prompts, configurable models, and extensible tool restrictions

### Primary Metric

**Code quality** - Maximize tests passing, types correct, lint clean.

### Target User

Solo developers working on personal or small projects who want fine-grained control over their AI coding assistant.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         GORA CLI                                │
│  gora [--plan|--build] [--loop N] [--yolo] [--dry-run] "task"  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MAIN AGENT                                 │
│  Configurable model (Claude Sonnet/Opus, GPT-5.2-Codex, etc.)  │
│  Reads: PROMPT_{mode}.md, AGENTS.md, IMPLEMENTATION_PLAN.md    │
└─────────────────────────────────────────────────────────────────┘
           │              │              │              │
           ▼              ▼              ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  ORACLE  │   │  SEARCH  │   │ LIBRARIAN│   │ SUBAGENT │
    │ (Reason) │   │  (Find)  │   │(Research)│   │  (Work)  │
    └──────────┘   └──────────┘   └──────────┘   └──────────┘
         │              │              │              │
         └──────────────┴──────────────┴──────────────┘
                              │
                              ▼
                   Each gets isolated ~156KB context
                   (Garbage collected after completion)
```

### Key Principles

1. **Context is RAM** - You can malloc (read files) but not free. Subagents let you "free" by doing work in isolated memory that gets discarded.

2. **File-based State** - Disk is the source of truth. Each iteration reads current state, does work, updates files.

3. **Feedback-Driven** - TypeScript + Tests + Lint run after changes. Agent auto-fixes until all pass.

---

## Agent System

### Main Agent

The primary orchestrator that handles user requests.

| Property | Value                                                   |
| -------- | ------------------------------------------------------- |
| Model    | Fully configurable (default: Claude Sonnet 4)           |
| Provider | Anthropic or OpenAI                                     |
| Context  | Persistent within session, file-based across sessions   |
| Tools    | All tools including meta-tools (oracle, subagent, etc.) |

**Behavior:**

- Reads PROMPT\_{mode}.md at start of each iteration
- Updates IMPLEMENTATION_PLAN.md with progress
- Auto-commits when all feedback loops pass
- Uses hybrid subagent spawning (auto for large tasks, explicit on request)

### Oracle Agent

Deep reasoning model for complex analysis.

| Property | Value                                                       |
| -------- | ----------------------------------------------------------- |
| Model    | Fully configurable (default: o3-mini)                       |
| Provider | OpenAI or Anthropic                                         |
| Access   | READ-ONLY (cannot modify files)                             |
| Trigger  | Agent discretion - consults when stuck or for deep analysis |

**Use Cases:**

- Code review and bug finding
- Architecture analysis
- Debugging difficult issues
- Planning refactoring strategies

**Fallback Behavior:**
When main agent cannot complete a task, it MUST consult Oracle before giving up.

### Search Agent

Fast parallel codebase exploration.

| Property     | Value                                                |
| ------------ | ---------------------------------------------------- |
| Model        | Fully configurable (default: Gemini 2.0 Flash)       |
| Provider     | Google or Anthropic (fallback)                       |
| Access       | READ-ONLY                                            |
| Optimization | Parallel tool calls (~8 concurrent vs ~2.5 standard) |

**Graceful Degradation:**
If GOOGLE_API_KEY not set, falls back to Claude Haiku. Slower but functional.

### Librarian Agent

Specialized research agent for external libraries and documentation.

| Property | Value                                          |
| -------- | ---------------------------------------------- |
| Model    | Fully configurable (default: Claude Sonnet)    |
| Access   | READ-ONLY + Web Search + GitHub CLI            |
| Mode     | Subagent (isolated context, garbage collected) |

**Capabilities:**

- **Documentation Discovery**: Find official docs, parse sitemaps, fetch versioned documentation
- **GitHub Research**: Clone repos, search code, read issues/PRs, git blame
- **Web Search**: DuckDuckGo scraping (no API key required)
- **Evidence Synthesis**: All claims backed by permalinks

**Request Classification:**
| Type | Trigger | Tools |
|------|---------|-------|
| TYPE A: Conceptual | "How do I use X?" | Docs + Web Search |
| TYPE B: Implementation | "Show me source of X" | GitHub clone + read |
| TYPE C: Context | "Why was this changed?" | Issues/PRs + git history |
| TYPE D: Comprehensive | Complex requests | All tools |

### Subagent (Generic)

Isolated worker for focused tasks.

| Property    | Value                                         |
| ----------- | --------------------------------------------- |
| Model       | Same as main agent                            |
| Context     | Isolated ~156KB, garbage collected after      |
| Tools       | All except oracle and subagent (no recursion) |
| Parallelism | No limit on concurrent subagents              |

**When to Spawn:**

- Hybrid approach: Agent decides automatically for large tasks
- User can explicitly request via prompt
- Large file reads (>50KB) automatically delegated
- Independent subtasks that don't need main context

**Context Bubble Up:**
Subagent returns most important parts of work done:

- Summary of actions taken
- File paths modified
- Test results
- Error messages (if any)

---

## Context Management

### The Problem

"When 200K+ tokens advertised = ~176K truly usable. And 40-60% context utilization for 'smart zone.'"

### The Solution: Ralph-Style Isolation

Each iteration:

1. Reads current disk state (PROMPT.md, AGENTS.md, IMPLEMENTATION_PLAN.md)
2. Performs one focused task
3. Updates files with progress
4. Context is discarded

Subagents extend this by providing isolated ~156KB allocations that are garbage collected after returning results.

### Large File Handling

Files over threshold are automatically delegated to subagents:

- Subagent reads file in its isolated context
- Returns relevant excerpts/analysis
- Main context stays clean

**Important:** No summarization that loses information. If full content needed, use subagent.

---

## Persistence Model

### Directory Structure

```
project-root/
├── gora.config.json          # Project configuration
├── PROMPT_build.md           # Build mode instructions
├── PROMPT_plan.md            # Plan mode instructions
├── AGENTS.md                 # Operational guide (optional)
├── IMPLEMENTATION_PLAN.md    # Task list (auto-generated/updated)
├── specs/                    # Requirement specs
│   ├── feature-a.md
│   └── feature-b.md
└── src/                      # Application source code
```

### File Purposes

| File                     | Purpose                                           | Creation                       |
| ------------------------ | ------------------------------------------------- | ------------------------------ |
| `gora.config.json`       | Project settings, model config, tool restrictions | Init wizard                    |
| `PROMPT_build.md`        | System prompt for build/implementation mode       | Init wizard                    |
| `PROMPT_plan.md`         | System prompt for planning mode                   | Init wizard                    |
| `AGENTS.md`              | Operational guide loaded each iteration           | Optional (smart defaults)      |
| `IMPLEMENTATION_PLAN.md` | Prioritized task list                             | Auto-generated, always updated |
| `specs/*.md`             | Requirement documents                             | User created                   |

### Operating Modes

**Plan Mode** (`gora --plan`)

- Uses PROMPT_plan.md
- Focus: Break down requirements into tasks
- Output: Updated IMPLEMENTATION_PLAN.md

**Build Mode** (`gora` or `gora --build`)

- Uses PROMPT_build.md
- Focus: Implement next task from plan
- Output: Code changes + updated plan

---

## Feedback Loops

### Available Checks

| Check      | Command                 | Purpose              |
| ---------- | ----------------------- | -------------------- |
| TypeScript | `tsc --noEmit`          | Type errors          |
| Tests      | `bun test` / `npm test` | Logic errors         |
| Lint       | `eslint`                | Style/quality issues |

### Configuration

Predefined set with ability to add/remove in config:

```json
{
  "feedbackLoops": {
    "typescript": true,
    "tests": true,
    "lint": true,
    "custom": [{ "name": "format", "command": "prettier --check ." }]
  }
}
```

### Auto-Fix Behavior

**Always auto-fix.** Agent keeps trying until all checks pass or max retries reached.

"AI agents don't get frustrated by repetition. When code fails type checking or tests, the agent simply tries again."

### Post-Success Actions

When all feedback loops pass:

1. Auto-commit changes with descriptive message
2. Push to remote (if configured)
3. Update IMPLEMENTATION_PLAN.md marking task complete

### Timeouts

No timeout on test execution. Tests run until complete.

---

## CLI Interface

### Command Name

```bash
gora
```

### Installation

```bash
npm install -g gora
```

### Usage Patterns

**Interactive Mode (default):**

```bash
gora
# Enters REPL, user types commands
```

**Single Command Mode:**

```bash
gora "fix the authentication bug"
gora -c "add dark mode support"
```

**Loop Mode:**

```bash
gora --loop              # Run until plan complete
gora --loop 10           # Max 10 iterations
gora --plan --loop 5     # Plan mode, 5 iterations
```

**Dry Run Mode:**

```bash
gora --dry-run "refactor the API"
# Shows what would be done without executing
```

**YOLO Mode:**

```bash
gora --yolo "migrate database"
# Skips all confirmations (for unattended execution)
```

### CLI Flags

| Flag              | Description                               |
| ----------------- | ----------------------------------------- |
| `--plan`          | Use plan mode (PROMPT_plan.md)            |
| `--build`         | Use build mode (default)                  |
| `--loop [N]`      | Run continuously, optional max iterations |
| `--yolo`          | Skip all confirmations                    |
| `--dry-run`       | Show plan without executing               |
| `-c, --command`   | Single command mode                       |
| `--verbose`       | Detailed execution logging                |
| `--config <path>` | Custom config file path                   |

### Output Style

Box-drawing characters with colors (current implementation style):

```
┌─ Oracle (o3-mini) ─────────────────
│ Query: Analyze this authentication flow...
│
│ tool: read_file
│ tool: code_search
│
│ The authentication uses JWT tokens stored in...
│ ... (truncated)
└─────────────────────────────────────
```

### Streaming

Always stream responses in real-time for responsiveness.

### Interrupt Handling (Ctrl+C)

Graceful stop: Finish current tool call, then stop. No checkpoint saving required (state is in files).

---

## Configuration

### Location

Project-local only: `gora.config.json` in project root.

### Init Wizard

```bash
gora init
```

Interactive wizard that:

1. Asks about project type (TypeScript, JavaScript, etc.)
2. Configures models for each agent
3. Sets up feedback loops
4. Creates PROMPT files with sensible defaults
5. Optionally creates specs/ directory structure

### Config Schema

```json
{
  "$schema": "https://gora.dev/schema/config.json",
  "version": "1.0",

  "models": {
    "main": {
      "model": "claude-sonnet-4-20250514",
      "provider": "anthropic"
    },
    "oracle": {
      "model": "o3-mini",
      "provider": "openai"
    },
    "search": {
      "model": "gemini-2.0-flash",
      "provider": "google"
    },
    "librarian": {
      "model": "claude-sonnet-4-20250514",
      "provider": "anthropic"
    }
  },

  "feedbackLoops": {
    "typescript": true,
    "tests": true,
    "lint": true,
    "maxRetries": 3
  },

  "git": {
    "autoCommit": true,
    "autoPush": false,
    "commitMessageStyle": "conventional"
  },

  "security": {
    "allowedPaths": ["./"],
    "confirmDestructive": true,
    "blockedCommands": ["rm -rf /", "sudo"]
  },

  "toolRestrictions": {
    "oracle": ["read_file", "list_files", "code_search"],
    "search": ["read_file", "list_files", "code_search"],
    "librarian": [
      "read_file",
      "list_files",
      "code_search",
      "web_search",
      "github_cli"
    ]
  }
}
```

### API Keys

Environment variables only (no config file storage):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
```

---

## Security & Safety

### File Access

**Working directory + explicit allowlist.**

Default: Only files in current directory and subdirectories.
Extend via config:

```json
{
  "security": {
    "allowedPaths": ["./", "../shared-lib", "~/.config/gora"]
  }
}
```

### Bash Command Safety

**Confirm destructive operations.**

Operations requiring confirmation:

- `rm` (any form)
- `git push --force`
- `git reset --hard`
- Any command matching `blockedCommands` patterns

Bypass with `--yolo` flag (explicit opt-in).

### Tool Restrictions

Configurable per-tool in config. Each tool type declares what operations it can perform:

```json
{
  "toolRestrictions": {
    "oracle": ["read_file", "list_files", "code_search"],
    "subagent": ["read_file", "list_files", "edit_file", "bash", "code_search"]
  }
}
```

### Git as Backup

Rely on git for file backups. No additional .bak files created.

Assumption: User has git initialized. If not, warn but don't fail.

---

## Technical Requirements

### Runtime

- **Bun.js** (primary)
- Node.js 18+ (fallback)

### Language Focus

TypeScript/JavaScript optimized. Other languages work but not prioritized.

### Dependencies

| Package                 | Purpose    |
| ----------------------- | ---------- |
| `@anthropic-ai/sdk`     | Claude API |
| `openai`                | GPT API    |
| `@google/generative-ai` | Gemini API |

### Built-in Web Search

DuckDuckGo scraping (no API key required).
Rate limited but functional for library research.

### Error Handling

**API Failures:**

1. Retry with exponential backoff (3 attempts)
2. If still failing, pause and notify user
3. User can retry or switch providers

**Rate Limits:**
Pause execution, show countdown, auto-resume when limit resets.

### Token Tracking

Summary at session end:

```
Session complete.
Total tokens: 45,230 (input: 32,100, output: 13,130)
Estimated cost: $0.47
```

---

## MVP Scope (v1.0)

### Included

- Main Agent with configurable models
- Oracle Agent (deep reasoning)
- Search Agent (fast parallel search)
- Librarian Agent (library research with GitHub CLI, web search)
- Subagent system (parallel execution, no limits)
- Ralph-style file persistence (IMPLEMENTATION_PLAN.md)
- Two modes: plan/build
- Feedback loops (TypeScript, tests, lint) with auto-fix
- Loop mode with max iterations
- Interactive init wizard
- Dry-run mode
- YOLO mode
- Auto-commit on success
- Graceful degradation (missing API keys)

### Deferred to v2.0

- Plugin/extension system
- MCP protocol support
- Watch mode (file change triggers)
- Multi-project support
- Team collaboration features
- Custom agent definitions
- Homebrew distribution

---

## Appendix: Librarian Prompt Reference

The Librarian uses a structured approach to research:

### Phase 0: Request Classification

Classify every request into TYPE A-D before taking action.

### Phase 0.5: Documentation Discovery

1. Find official documentation URL
2. Check version-specific docs if version mentioned
3. Fetch sitemap to understand doc structure
4. Target specific pages based on sitemap

### Phase 1: Execute by Type

- **TYPE A (Conceptual)**: Docs + web search
- **TYPE B (Implementation)**: Clone repo, read source, git blame
- **TYPE C (Context)**: Issues, PRs, git history
- **TYPE D (Comprehensive)**: All tools

### Phase 2: Evidence Synthesis

Every claim includes a permalink:

```markdown
**Evidence** ([source](https://github.com/owner/repo/blob/<sha>/path#L10-L20)):
```

---

_Specification version: 1.0_
_Last updated: 2025-01-18_
