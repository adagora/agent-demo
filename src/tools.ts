/**
 * Tool Definitions
 *
 * Every coding agent is built on these fundamental tools.
 * There's no magic—just these primitives in a loop.
 */

import type { ToolDefinition } from "./types.js";

// =============================================================================
// CORE TOOLS (Read)
// =============================================================================

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file at the specified path.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path to the file to read",
      },
    },
    required: ["path"],
  },
};

export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description:
    "List all files and directories in the specified path. Hidden files and node_modules are excluded.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The directory path to list (default: current directory)",
      },
    },
  },
};

export const codeSearchTool: ToolDefinition = {
  name: "code_search",
  description: `Search for patterns in the codebase using ripgrep.

This is the SECRET WEAPON of every coding agent. VS Code, Cursor, Amp, Claude Code
all use ripgrep under the hood. No fancy AI-powered semantic search, no embeddings,
no vector databases. Just blazing-fast regex search.

Use this to:
- Find function/class definitions
- Locate where variables are used
- Search for TODO/FIXME comments
- Navigate large codebases efficiently`,
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The search pattern (supports regex)",
      },
      path: {
        type: "string",
        description: "Directory to search in (default: current directory)",
      },
      file_type: {
        type: "string",
        description: "File extension to filter (e.g., 'ts', 'js', 'py')",
      },
      case_sensitive: {
        type: "boolean",
        description: "Whether search is case-sensitive (default: false)",
      },
    },
    required: ["pattern"],
  },
};

// =============================================================================
// CORE TOOLS (Write)
// =============================================================================

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: `Edit a file by replacing a specific string with new content.
If the file doesn't exist and old_str is empty, creates a new file.
The old_str must match EXACTLY (including whitespace) to avoid ambiguity.`,
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path to the file to edit",
      },
      old_str: {
        type: "string",
        description:
          "The exact string to replace (empty string to create new file)",
      },
      new_str: {
        type: "string",
        description: "The new string to insert",
      },
    },
    required: ["path", "old_str", "new_str"],
  },
};

export const bashTool: ToolDefinition = {
  name: "bash",
  description: `Execute a bash command.

Use for:
- Running scripts (npm test, npm run build)
- Installing packages (npm install)
- Git operations
- File system operations
- Any shell command`,
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
  },
};

// =============================================================================
// META-TOOLS (Subagents)
// =============================================================================

export const oracleTool: ToolDefinition = {
  name: "oracle",
  description: `Consult the oracle - a powerful reasoning model for complex analysis tasks.

The oracle is READ-ONLY and cannot modify files, but excels at:
- Code review and finding bugs
- Analyzing complex logic and architecture
- Debugging difficult issues
- Planning refactoring strategies
- Understanding how code works together

Use the oracle when you need deep analysis or are stuck on a hard problem.
The oracle is slower and more expensive, so use it judiciously.`,
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The question or task for the oracle. Be specific about what you want analyzed.",
      },
      context: {
        type: "string",
        description:
          "Optional additional context (e.g., file contents, error messages) to help the oracle.",
      },
    },
    required: ["query"],
  },
};

export const subagentTool: ToolDefinition = {
  name: "subagent",
  description: `Spawn an isolated subagent to perform a focused task.

WHEN TO USE:
- Tasks that require reading many files (subagent context is garbage collected after)
- Parallel/independent subtasks that don't need your current context
- Exploring a part of the codebase without polluting your context
- Any task where you only need the final result, not the journey

HOW IT WORKS:
- Subagent gets a fresh context (like a new terminal session)
- It has access to all tools EXCEPT oracle and subagent (no recursion)
- It runs until completion, then returns only the final result
- Its internal context is garbage collected - doesn't bloat your context

OUTPUT HANDLING:
- max_output_tokens limits how much comes back to you (default: 2000)
- Set lower for simple yes/no tasks, higher for summaries
- Subagent is instructed to be concise in its final response

CONTEXT MANAGEMENT:
Think of context like RAM - you can malloc but not free.
Subagents let you "free" by doing work in isolated memory that gets discarded.
You only keep the return value, not all the intermediate file reads.`,
  input_schema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "Clear description of the task for the subagent to complete. Be specific about what output format you want.",
      },
      working_directory: {
        type: "string",
        description:
          "Optional working directory for the subagent (default: current directory)",
      },
      max_output_tokens: {
        type: "number",
        description:
          "Maximum tokens in the response (default: 2000). Use lower for simple tasks, higher for detailed summaries.",
      },
      output_format: {
        type: "string",
        enum: ["full", "summary", "structured"],
        description:
          "How to format output: 'full' (complete response), 'summary' (condensed), 'structured' (JSON)",
      },
    },
    required: ["task"],
  },
};

export const searchAgentTool: ToolDefinition = {
  name: "search_agent",
  description: `Spawn a specialized search agent to explore the codebase.

The search agent is optimized for FAST, PARALLEL codebase exploration:
- Uses a faster model (Gemini Flash) optimized for parallel tool calls
- Fires off ~8 parallel searches vs ~2.5 for regular agents
- Completes in ~3 turns vs ~9 turns
- READ-ONLY: can only search and read, cannot modify files

WHEN TO USE:
- "Where is the auth logic?"
- "Find all files related to payments"
- "How does the routing work?"
- Any question about WHERE something is or HOW code is structured

The search agent returns a summary of what it found, keeping your context clean.`,
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to search for in the codebase. Be specific about what you're looking for.",
      },
      scope: {
        type: "string",
        description:
          "Optional directory to limit search scope (default: entire codebase)",
      },
    },
    required: ["query"],
  },
};

export const parallelSubagentsTool: ToolDefinition = {
  name: "parallel_subagents",
  description: `Spawn MULTIPLE subagents to work in PARALLEL.

This is powerful for:
- Breaking a large task into independent subtasks
- Implementing changes across multiple files simultaneously
- Exploring different parts of the codebase at once
- Any work that can be parallelized

Each subagent gets its own fresh context window. Results are collected and returned together.

Example: Instead of editing 5 files sequentially (slow, uses your tokens),
spawn 5 subagents in parallel (fast, each uses their own tokens).

IMPORTANT: Tasks must be INDEPENDENT. Subagents cannot see each other's work.`,
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short name for this task" },
            task: {
              type: "string",
              description: "What this subagent should do",
            },
            working_directory: {
              type: "string",
              description: "Optional working directory",
            },
          },
          required: ["name", "task"],
        },
        description: "Array of tasks to run in parallel",
      },
      max_output_tokens_per_task: {
        type: "number",
        description: "Max tokens per subagent response (default: 1000)",
      },
    },
    required: ["tasks"],
  },
};

export const librarianTool: ToolDefinition = {
  name: "librarian",
  description: `Summon THE LIBRARIAN - a specialized agent for researching external libraries and documentation.

WHEN TO USE:
- "How does [library] implement X?"
- "What's the best practice for [framework feature]?"
- "Why does [dependency] behave this way?"
- "Find examples of [library] usage in open source"
- Working with unfamiliar npm/pip/cargo packages
- Understanding library internals or source code
- Finding real-world usage patterns

THE LIBRARIAN EXCELS AT:
- Searching GitHub for implementation details
- Finding official documentation
- Locating usage examples in open source
- Understanding library internals
- Connecting your code to its dependencies`,
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What you want to know about the library/framework. Be specific.",
      },
      library: {
        type: "string",
        description:
          "The library or framework name (e.g., 'react', 'express', 'zod')",
      },
      type: {
        type: "string",
        enum: ["conceptual", "implementation", "examples", "troubleshooting"],
        description:
          "Type of question: conceptual (how to use), implementation (source code), examples (real usage), troubleshooting (why error)",
      },
    },
    required: ["query", "library"],
  },
};

export const feedbackLoopTool: ToolDefinition = {
  name: "feedback_loop",
  description: `Run feedback loops to validate code quality.

"TypeScript is essentially free feedback for your AI"
"AI agents don't get frustrated by repetition. When code fails type checking or tests, the agent simply tries again."

WHAT IT RUNS:
1. TypeScript type checking (tsc --noEmit) - catches type errors
2. Tests (vitest/jest/npm test) - catches logical errors
3. ESLint - catches style/quality issues

WHEN TO USE:
- After making code changes
- Before considering a task "done"
- When you want to verify your changes work
- As part of a fix-retry loop

The feedback loop will tell you EXACTLY what's wrong so you can fix it.
If something fails, FIX IT and run again. Repeat until all pass.`,
  input_schema: {
    type: "object",
    properties: {
      working_directory: {
        type: "string",
        description: "Directory to run checks in (default: current directory)",
      },
      fix_and_retry: {
        type: "boolean",
        description:
          "If true, automatically attempt to fix issues and retry (up to 3 times)",
      },
    },
  },
};

// =============================================================================
// TOOL COLLECTIONS
// =============================================================================

export const readOnlyTools: ToolDefinition[] = [
  readFileTool,
  listFilesTool,
  codeSearchTool,
];

export const writeTools: ToolDefinition[] = [editFileTool, bashTool];

export const mainAgentTools: ToolDefinition[] = [
  ...readOnlyTools,
  ...writeTools,
  oracleTool,
  subagentTool,
  searchAgentTool,
  parallelSubagentsTool,
  librarianTool,
  feedbackLoopTool,
];

export const subagentTools: ToolDefinition[] = [
  ...readOnlyTools,
  ...writeTools,
  feedbackLoopTool,
];

export const searchAgentTools: ToolDefinition[] = [...readOnlyTools];

export const librarianTools: ToolDefinition[] = [...readOnlyTools];
