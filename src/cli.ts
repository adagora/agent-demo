/**
 * Gora CLI - Command Line Interface
 *
 * Handles argument parsing and orchestrates the agent system
 * based on the operating mode (plan/build) and CLI flags.
 */

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "util";
import { colors } from "./config.js";
import type { GoraConfig, CliOptions, OperatingMode } from "./types.js";

// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

/**
 * Parse command line arguments using Node.js built-in parseArgs
 *
 * Why parseArgs over commander/yargs: Zero dependencies, built into Node 18.3+
 * and Bun. Keeps the tool lightweight per the spec's minimal dependency philosophy.
 */
export function parseCliArgs(
  args: string[] = process.argv.slice(2),
): CliOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      plan: {
        type: "boolean",
        short: "p",
        default: false,
      },
      build: {
        type: "boolean",
        short: "b",
        default: false,
      },
      loop: {
        type: "string",
        short: "l",
      },
      yolo: {
        type: "boolean",
        short: "y",
        default: false,
      },
      "dry-run": {
        type: "boolean",
        default: false,
      },
      command: {
        type: "string",
        short: "c",
      },
      verbose: {
        type: "boolean",
        short: "v",
        default: false,
      },
      config: {
        type: "string",
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
      version: {
        type: "boolean",
        default: false,
      },
      init: {
        type: "boolean",
        default: false,
      },
    },
    allowPositionals: true,
    strict: false, // Allow unknown options to pass through
  });

  // Determine operating mode
  let mode: OperatingMode = "build"; // default
  if (values.plan) {
    mode = "plan";
  }

  // Parse loop value
  let loopCount: number | "infinite" | undefined;
  if (values.loop !== undefined) {
    const loopValue = String(values.loop);
    if (loopValue === "" || loopValue === "true") {
      loopCount = "infinite";
    } else {
      const parsed = parseInt(loopValue, 10);
      if (!isNaN(parsed) && parsed > 0) {
        loopCount = parsed;
      } else {
        loopCount = "infinite";
      }
    }
  }

  // Get task from positionals or command flag
  const task =
    (values.command as string | undefined) ||
    positionals.join(" ") ||
    undefined;

  return {
    mode,
    loop: loopCount,
    yolo: values.yolo as boolean,
    dryRun: values["dry-run"] as boolean,
    task,
    verbose: values.verbose as boolean,
    configPath: values.config as string | undefined,
    help: values.help as boolean,
    version: values.version as boolean,
    init: values.init as boolean,
  };
}

// =============================================================================
// CONFIGURATION LOADING
// =============================================================================

const DEFAULT_CONFIG: GoraConfig = {
  version: "1.0",
  models: {
    main: {
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    },
    oracle: {
      model: "o3-mini",
      provider: "openai",
    },
    search: {
      model: "gemini-2.0-flash",
      provider: "google",
    },
    librarian: {
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    },
  },
  feedbackLoops: {
    typescript: true,
    tests: true,
    lint: true,
    maxRetries: 3,
  },
  git: {
    autoCommit: true,
    autoPush: false,
    commitMessageStyle: "conventional",
  },
  security: {
    allowedPaths: ["./"],
    confirmDestructive: true,
    blockedCommands: ["rm -rf /", "sudo"],
  },
};

/**
 * Load configuration from gora.config.json
 *
 * Configuration is project-local only (per spec).
 * Returns merged config with defaults for any missing fields.
 */
export function loadConfig(configPath?: string): GoraConfig {
  const configFile = configPath || "gora.config.json";
  const absolutePath = path.resolve(configFile);

  if (!fs.existsSync(absolutePath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(absolutePath, "utf-8");
    const userConfig = JSON.parse(content) as Partial<GoraConfig>;

    // Deep merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      models: {
        ...DEFAULT_CONFIG.models,
        ...userConfig.models,
      },
      feedbackLoops: {
        ...DEFAULT_CONFIG.feedbackLoops,
        ...userConfig.feedbackLoops,
      },
      git: {
        ...DEFAULT_CONFIG.git,
        ...userConfig.git,
      },
      security: {
        ...DEFAULT_CONFIG.security,
        ...userConfig.security,
      },
    };
  } catch (err) {
    const error = err as Error;
    console.error(
      `${colors.red}Error loading config: ${error.message}${colors.reset}`,
    );
    return DEFAULT_CONFIG;
  }
}

// =============================================================================
// PROMPT FILE LOADING
// =============================================================================

/**
 * Load the appropriate PROMPT file based on operating mode
 *
 * Per spec: Reads PROMPT_{mode}.md at start of each iteration
 */
export function loadPromptFile(mode: OperatingMode): string | null {
  const promptFile = mode === "plan" ? "PROMPT_plan.md" : "PROMPT_build.md";
  const absolutePath = path.resolve(promptFile);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    return fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load AGENTS.md operational guide
 */
export function loadAgentsFile(): string | null {
  const absolutePath = path.resolve("AGENTS.md");

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    return fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load IMPLEMENTATION_PLAN.md
 */
export function loadImplementationPlan(): string | null {
  const absolutePath = path.resolve("IMPLEMENTATION_PLAN.md");

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    return fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }
}

// =============================================================================
// HELP & VERSION
// =============================================================================

export function printHelp(): void {
  console.log(`
${colors.cyan}gora${colors.reset} - AI Code Editing Agent

${colors.yellow}USAGE:${colors.reset}
  gora [OPTIONS] [TASK]

${colors.yellow}OPTIONS:${colors.reset}
  -p, --plan          Use plan mode (PROMPT_plan.md)
  -b, --build         Use build mode (default, PROMPT_build.md)
  -l, --loop [N]      Run continuously, optional max iterations
  -y, --yolo          Skip all confirmations
      --dry-run       Show plan without executing
  -c, --command       Single command mode
  -v, --verbose       Detailed execution logging
      --config PATH   Custom config file path
      --init          Initialize new project
  -h, --help          Show this help message
      --version       Show version

${colors.yellow}EXAMPLES:${colors.reset}
  gora                        Interactive mode
  gora "fix the auth bug"     Single task mode
  gora --loop                 Loop until plan complete
  gora --loop 10              Max 10 iterations
  gora --plan --loop 5        Plan mode, 5 iterations
  gora --dry-run "refactor"   Preview what would be done
  gora --yolo "migrate db"    Skip confirmations

${colors.yellow}ENVIRONMENT:${colors.reset}
  ANTHROPIC_API_KEY   Required for Claude models
  OPENAI_API_KEY      Required for GPT/O3 models
  GOOGLE_API_KEY      Optional for Gemini search agent
`);
}

export function printVersion(): void {
  const packagePath = path.resolve("package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    console.log(`gora v${pkg.version}`);
  } catch {
    console.log("gora v0.0.0");
  }
}

// =============================================================================
// INIT WIZARD
// =============================================================================

/**
 * Initialize a new gora project
 *
 * Creates:
 * - gora.config.json with sensible defaults
 * - PROMPT_build.md
 * - PROMPT_plan.md
 * - AGENTS.md (optional)
 * - specs/ directory
 */
export async function initProject(): Promise<void> {
  console.log(`\n${colors.cyan}Initializing gora project...${colors.reset}\n`);

  // Check if already initialized
  if (fs.existsSync("gora.config.json")) {
    console.log(
      `${colors.yellow}Warning: gora.config.json already exists${colors.reset}`,
    );
  }

  // Create gora.config.json
  const configContent = JSON.stringify(DEFAULT_CONFIG, null, 2);
  fs.writeFileSync("gora.config.json", configContent);
  console.log(`${colors.green}✓${colors.reset} Created gora.config.json`);

  // Create PROMPT_build.md if it doesn't exist
  if (!fs.existsSync("PROMPT_build.md")) {
    const buildPrompt = `# Build Mode Instructions

You are working in BUILD mode. Your goal is to implement functionality.

## Instructions
1. Read the IMPLEMENTATION_PLAN.md to understand current tasks
2. Pick the highest priority uncompleted task
3. Implement it fully (no placeholders)
4. Run feedback loops (TypeScript, tests, lint)
5. Fix any issues until all checks pass
6. Update IMPLEMENTATION_PLAN.md with progress

## Guidelines
- Search the codebase before assuming something doesn't exist
- Use subagents for context-heavy tasks
- Auto-commit when all feedback loops pass
`;
    fs.writeFileSync("PROMPT_build.md", buildPrompt);
    console.log(`${colors.green}✓${colors.reset} Created PROMPT_build.md`);
  } else {
    console.log(`${colors.dim}  PROMPT_build.md already exists${colors.reset}`);
  }

  // Create PROMPT_plan.md if it doesn't exist
  if (!fs.existsSync("PROMPT_plan.md")) {
    const planPrompt = `# Plan Mode Instructions

You are working in PLAN mode. Your goal is to analyze and plan, NOT implement.

## Instructions
1. Study the specs/ directory to understand requirements
2. Search the codebase to understand current state
3. Compare specs vs implementation
4. Update IMPLEMENTATION_PLAN.md with prioritized tasks

## Guidelines
- Do NOT implement anything
- Do NOT assume functionality is missing - verify with code search
- Document findings in IMPLEMENTATION_PLAN.md
- Note any inconsistencies in specs
`;
    fs.writeFileSync("PROMPT_plan.md", planPrompt);
    console.log(`${colors.green}✓${colors.reset} Created PROMPT_plan.md`);
  } else {
    console.log(`${colors.dim}  PROMPT_plan.md already exists${colors.reset}`);
  }

  // Create AGENTS.md if it doesn't exist
  if (!fs.existsSync("AGENTS.md")) {
    const agentsContent = `## Build & Run

- **Build**: \`bun build src/index.ts --outdir dist --target bun\`
- **Dev**: \`bun --watch src/index.ts\`

## Validation

- **Tests**: \`bun test\`
- **Typecheck**: \`bun x tsc --noEmit\`
- **Lint**: \`bun x eslint src --ext .ts\`
`;
    fs.writeFileSync("AGENTS.md", agentsContent);
    console.log(`${colors.green}✓${colors.reset} Created AGENTS.md`);
  } else {
    console.log(`${colors.dim}  AGENTS.md already exists${colors.reset}`);
  }

  // Create IMPLEMENTATION_PLAN.md if it doesn't exist
  if (!fs.existsSync("IMPLEMENTATION_PLAN.md")) {
    const planContent = `# Implementation Plan

## Pending Tasks

- [ ] Add your tasks here

## Completed Tasks

(Tasks will be moved here when completed)
`;
    fs.writeFileSync("IMPLEMENTATION_PLAN.md", planContent);
    console.log(
      `${colors.green}✓${colors.reset} Created IMPLEMENTATION_PLAN.md`,
    );
  } else {
    console.log(
      `${colors.dim}  IMPLEMENTATION_PLAN.md already exists${colors.reset}`,
    );
  }

  // Create specs/ directory
  if (!fs.existsSync("specs")) {
    fs.mkdirSync("specs");
    console.log(`${colors.green}✓${colors.reset} Created specs/ directory`);
  } else {
    console.log(
      `${colors.dim}  specs/ directory already exists${colors.reset}`,
    );
  }

  console.log(`
${colors.green}Project initialized!${colors.reset}

Next steps:
1. Add your API keys to environment:
   export ANTHROPIC_API_KEY=sk-ant-...
   export OPENAI_API_KEY=sk-...

2. Customize gora.config.json for your project

3. Run: ${colors.cyan}gora${colors.reset}
`);
}

// =============================================================================
// BUILD CONTEXT
// =============================================================================

/**
 * Build the system prompt context from project files
 *
 * Per spec: Main agent reads PROMPT_{mode}.md, AGENTS.md, and
 * IMPLEMENTATION_PLAN.md at the start of each iteration.
 */
export function buildSystemContext(mode: OperatingMode): string {
  const parts: string[] = [];

  // Mode-specific prompt
  const promptContent = loadPromptFile(mode);
  if (promptContent) {
    parts.push(`# Current Mode: ${mode.toUpperCase()}\n\n${promptContent}`);
  }

  // Operational guide
  const agentsContent = loadAgentsFile();
  if (agentsContent) {
    parts.push(`# Operational Guide (AGENTS.md)\n\n${agentsContent}`);
  }

  // Implementation plan
  const planContent = loadImplementationPlan();
  if (planContent) {
    parts.push(`# Implementation Plan\n\n${planContent}`);
  }

  if (parts.length === 0) {
    return `You are gora, an AI code editing agent.

Working in ${mode.toUpperCase()} mode.
No project configuration files found. Run 'gora --init' to initialize a project.`;
  }

  return parts.join("\n\n---\n\n");
}
