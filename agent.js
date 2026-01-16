import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { execSync } from "child_process";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Main agent model (fast, good at agentic coding)
  mainModel: "claude-sonnet-4-20250514",
  
  // Oracle model (slower, better at reasoning/analysis)
  oracleModel: "gpt-5.2",
  oracleProvider: "openai", // "openai" or "anthropic"
  
  // Search agent model (optimized for fast parallel tool calls)
  // Gemini 3 Flash: 3x faster, ~8 parallel calls vs ~2.5, finishes in ~3 turns vs ~9
  searchModel: "gemini-2.0-flash", // or "claude-haiku" for fallback
  searchProvider: "google", // "google" or "anthropic"
  
  maxTokens: 8096,
};

// =============================================================================
// ANSI COLORS
// =============================================================================

const colors = {
  blue: "\x1b[94m",
  yellow: "\x1b[93m",
  green: "\x1b[92m",
  magenta: "\x1b[95m",
  cyan: "\x1b[96m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

// =============================================================================
// FILE SYSTEM TOOLS (shared between main agent and oracle)
// =============================================================================

function readFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content;
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

function listFiles(dirPath = ".") {
  try {
    const results = [];
    const walkDir = (dir, prefix = "") => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "node_modules") continue;
        const fullPath = path.join(prefix, entry.name);
        if (entry.isDirectory()) {
          results.push(fullPath + "/");
          walkDir(path.join(dir, entry.name), fullPath);
        } else {
          results.push(fullPath);
        }
      }
    };
    walkDir(dirPath);
    return JSON.stringify(results, null, 2);
  } catch (err) {
    return `Error listing files: ${err.message}`;
  }
}

function editFile(filePath, oldStr, newStr) {
  try {
    if (oldStr === "") {
      const dir = path.dirname(filePath);
      if (dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, newStr);
      return `Successfully created file ${filePath}`;
    }

    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      throw err;
    }

    if (!content.includes(oldStr)) {
      return `Error: old_str not found in file`;
    }

    const newContent = content.replace(oldStr, newStr);
    fs.writeFileSync(filePath, newContent);
    return "OK";
  } catch (err) {
    return `Error editing file: ${err.message}`;
  }
}

function bash(command, timeout = 30000) {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      shell: "/bin/bash",
    });
    return output.trim();
  } catch (err) {
    if (err.stdout || err.stderr) {
      const output = (err.stdout || "") + (err.stderr || "");
      return `Command failed with exit code ${err.status}\nOutput: ${output.trim()}`;
    }
    return `Error executing command: ${err.message}`;
  }
}

function codeSearch(pattern, searchPath = ".", fileType = null, caseSensitive = false) {
  if (!pattern) {
    return "Error: pattern is required";
  }

  try {
    const args = ["rg", "--line-number", "--with-filename", "--color=never"];

    if (!caseSensitive) {
      args.push("--ignore-case");
    }

    if (fileType) {
      args.push("--type", fileType);
    }

    args.push(pattern, searchPath);

    const output = execSync(args.join(" "), {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/bash",
    });

    const result = output.trim();
    const lines = result.split("\n");

    if (lines.length > 50) {
      return lines.slice(0, 50).join("\n") + `\n... (showing first 50 of ${lines.length} matches)`;
    }

    return result;
  } catch (err) {
    if (err.status === 1) {
      return "No matches found";
    }

    if (err.message.includes("rg") || err.message.includes("not found")) {
      try {
        const grepArgs = ["grep", "-rn", "--color=never"];
        if (!caseSensitive) grepArgs.push("-i");
        if (fileType) grepArgs.push(`--include=*.${fileType}`);
        grepArgs.push(pattern, searchPath);

        const output = execSync(grepArgs.join(" "), {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          shell: "/bin/bash",
        });
        return output.trim();
      } catch (grepErr) {
        if (grepErr.status === 1) return "No matches found";
        return `Search failed: ${grepErr.message}`;
      }
    }

    return `Search failed: ${err.message}`;
  }
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

const readOnlyTools = [
  {
    name: "read_file",
    description:
      "Read the contents of a given relative file path. Use this when you want to see what's inside a file.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The relative path of a file in the working directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description:
      "List files and directories at a given path. If no path is provided, lists files in the current directory.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional relative path to list files from.",
        },
      },
      required: [],
    },
  },
];

const writeTools = [
  {
    name: "edit_file",
    description: `Make edits to a text file.

Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be different from each other.

If the file specified with path doesn't exist, it will be created.`,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to the file" },
        old_str: {
          type: "string",
          description: "Text to search for - must match exactly",
        },
        new_str: {
          type: "string",
          description: "Text to replace old_str with",
        },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
  {
    name: "bash",
    description: `Execute a bash command and return its output.

Use this to:
- Run shell commands (ls, cat, grep, etc.)
- Execute scripts and programs
- Install packages (npm install, pip install, etc.)
- Run tests and builds
- Git operations

The command runs in the current working directory with a 30 second timeout.`,
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in milliseconds (default: 30000)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "code_search",
    description: `Search for code patterns using ripgrep (rg).

Use this to find:
- Function definitions
- Variable usage
- Import statements
- Any text pattern in the codebase

This is much faster than reading files one by one. Use it to understand code structure and find relevant files.`,
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The search pattern or regex to look for",
        },
        path: {
          type: "string",
          description: "Optional path to search in (file or directory). Defaults to current directory.",
        },
        file_type: {
          type: "string",
          description: "Optional file extension to limit search (e.g., 'js', 'py', 'go')",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether search should be case sensitive (default: false)",
        },
      },
      required: ["pattern"],
    },
  },
];

const oracleTool = {
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

const subagentTool = {
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
You only keep the return value, not all the intermediate file reads.

Example: "Read all 50 test files and summarize the testing patterns"
- Without subagent: 50 files loaded into YOUR context forever
- With subagent: Subagent reads files, returns summary, context freed`,
  input_schema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Clear description of the task for the subagent to complete. Be specific about what output format you want.",
      },
      working_directory: {
        type: "string",
        description: "Optional working directory for the subagent (default: current directory)",
      },
      max_output_tokens: {
        type: "number",
        description: "Maximum tokens in the response (default: 2000). Use lower for simple tasks, higher for detailed summaries.",
      },
      output_format: {
        type: "string",
        enum: ["full", "summary", "structured"],
        description: "How to format output: 'full' (complete response), 'summary' (condensed), 'structured' (JSON)",
      },
    },
    required: ["task"],
  },
};

const searchAgentTool = {
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
        description: "What to search for in the codebase. Be specific about what you're looking for.",
      },
      scope: {
        type: "string",
        description: "Optional directory to limit search scope (default: entire codebase)",
      },
    },
    required: ["query"],
  },
};

const parallelSubagentsTool = {
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
            task: { type: "string", description: "What this subagent should do" },
            working_directory: { type: "string", description: "Optional working directory" },
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

const librarianTool = {
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
- Connecting your code to its dependencies

The Librarian uses web search and can explore documentation to find authoritative answers with evidence.`,
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What you want to know about the library/framework. Be specific.",
      },
      library: {
        type: "string",
        description: "The library or framework name (e.g., 'react', 'express', 'zod')",
      },
      type: {
        type: "string",
        enum: ["conceptual", "implementation", "examples", "troubleshooting"],
        description: "Type of question: conceptual (how to use), implementation (source code), examples (real usage), troubleshooting (why error)",
      },
    },
    required: ["query", "library"],
  },
};

const mainAgentTools = [...readOnlyTools, ...writeTools, oracleTool, subagentTool, searchAgentTool, parallelSubagentsTool, librarianTool];

const subagentTools = [...readOnlyTools, ...writeTools];

const searchAgentTools = [...readOnlyTools];

const librarianTools = [...readOnlyTools];

// =============================================================================
// ORACLE - The reasoning subagent
// =============================================================================

class Oracle {
  constructor() {
    if (CONFIG.oracleProvider === "openai") {
      this.client = new OpenAI();
    } else {
      this.client = new Anthropic();
    }
  }

  toOpenAITools(tools) {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  executeReadOnlyTool(name, input) {
    switch (name) {
      case "read_file":
        return readFile(input.path);
      case "list_files":
        return listFiles(input.path || ".");
      default:
        return `Unknown tool: ${name}`;
    }
  }

  async consult(query, context = "") {
    console.log(
      `\n${colors.magenta}┌─ Oracle (${CONFIG.oracleModel}) ─────────────────${colors.reset}`
    );
    console.log(`${colors.magenta}│${colors.reset} ${colors.dim}Analyzing...${colors.reset}`);

    const systemPrompt = `You are the Oracle - a powerful analytical assistant that helps with code review, debugging, and analysis.

You have access to read-only tools to examine the codebase. You CANNOT modify any files.

Your strengths:
- Deep code analysis and review
- Finding bugs and potential issues  
- Understanding complex logic
- Suggesting improvements and refactoring strategies
- Debugging difficult problems

Be thorough but concise. Focus on actionable insights.`;

    const userMessage = context
      ? `${query}\n\nAdditional context:\n${context}`
      : query;

    try {
      if (CONFIG.oracleProvider === "openai") {
        return await this.consultOpenAI(systemPrompt, userMessage);
      } else {
        return await this.consultAnthropic(systemPrompt, userMessage);
      }
    } catch (err) {
      console.log(
        `${colors.magenta}│${colors.reset} ${colors.dim}Error: ${err.message}${colors.reset}`
      );
      console.log(`${colors.magenta}└─────────────────────────────────────${colors.reset}\n`);
      return `Oracle error: ${err.message}`;
    }
  }

  async consultOpenAI(systemPrompt, userMessage) {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const openAITools = this.toOpenAITools(readOnlyTools);

    while (true) {
      const response = await this.client.chat.completions.create({
        model: CONFIG.oracleModel,
        messages: messages,
        tools: openAITools,
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const name = toolCall.function.name;
          const input = JSON.parse(toolCall.function.arguments);

          console.log(
            `${colors.magenta}│${colors.reset} ${colors.cyan}tool: ${name}(${JSON.stringify(input)})${colors.reset}`
          );

          const result = this.executeReadOnlyTool(name, input);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      } else {
        const finalResponse = message.content || "No response from oracle";
        this.printOracleResponse(finalResponse);
        return finalResponse;
      }
    }
  }

  async consultAnthropic(systemPrompt, userMessage) {
    const messages = [{ role: "user", content: userMessage }];

    while (true) {
      const response = await this.client.messages.create({
        model: CONFIG.oracleModel,
        max_tokens: CONFIG.maxTokens,
        system: systemPrompt,
        tools: readOnlyTools,
        messages: messages,
      });

      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      let textResponse = "";

      for (const block of response.content) {
        if (block.type === "text") {
          textResponse += block.text;
        } else if (block.type === "tool_use") {
          console.log(
            `${colors.magenta}│${colors.reset} ${colors.cyan}tool: ${block.name}(${JSON.stringify(block.input)})${colors.reset}`
          );

          const result = this.executeReadOnlyTool(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      if (toolResults.length === 0) {
        this.printOracleResponse(textResponse);
        return textResponse;
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  printOracleResponse(response) {
    const lines = response.split("\n");
    for (const line of lines) {
      console.log(`${colors.magenta}│${colors.reset} ${line}`);
    }
    console.log(`${colors.magenta}└─────────────────────────────────────${colors.reset}\n`);
  }
}

// =============================================================================
// SEARCH AGENT - Fast parallel codebase search (Gemini Flash)
// =============================================================================

class SearchAgent {
  constructor() {
    if (CONFIG.searchProvider === "google") {
      this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
    } else {
      this.client = new Anthropic();
    }
  }

  executeReadOnlyTool(name, input) {
    switch (name) {
      case "read_file":
        return readFile(input.path);
      case "list_files":
        return listFiles(input.path || ".");
      case "code_search":
        return codeSearch(input.pattern, input.path || ".", input.file_type, input.case_sensitive || false);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  toGeminiTools(tools) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.input_schema.properties,
        required: tool.input_schema.required || [],
      },
    }));
  }

  async search(query, scope = ".") {
    console.log(
      `\n${colors.blue}┌─ Search Agent (${CONFIG.searchModel}) ────────${colors.reset}`
    );
    console.log(`${colors.blue}│${colors.reset} ${colors.dim}Query: ${query.substring(0, 60)}${query.length > 60 ? '...' : ''}${colors.reset}`);
    console.log(`${colors.blue}│${colors.reset} ${colors.dim}Scope: ${scope}${colors.reset}`);
    console.log(`${colors.blue}│${colors.reset}`);

    const systemPrompt = `You are a fast codebase search agent. Your job is to quickly find relevant code.

STRATEGY:
- Use code_search aggressively with diverse queries
- Fire off MULTIPLE parallel searches when possible
- Read files only when you need to verify findings
- Conclude early once you have enough information
- Be thorough but FAST

You're searching in: ${scope}

Return a concise summary of what you found and where.`;

    try {
      if (CONFIG.searchProvider === "google") {
        return await this.searchWithGemini(systemPrompt, query);
      } else {
        return await this.searchWithAnthropic(systemPrompt, query);
      }
    } catch (err) {
      console.log(`${colors.blue}│${colors.reset} ${colors.dim}Error: ${err.message}${colors.reset}`);
      console.log(`${colors.blue}└──────────────────────────────────────${colors.reset}\n`);
      return `Search error: ${err.message}`;
    }
  }


  async searchWithGemini(systemPrompt, query) {
    const model = this.genAI.getGenerativeModel({ 
      model: CONFIG.searchModel,
      systemInstruction: systemPrompt,
    });

    const chat = model.startChat({
      tools: [{ functionDeclarations: this.toGeminiTools(searchAgentTools) }],
    });

    let iterations = 0;
    const maxIterations = 10;
    let totalToolCalls = 0;

    let response = await chat.sendMessage(query);

    while (iterations < maxIterations) {
      iterations++;
      
      const candidate = response.response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];
      const functionCalls = parts.filter(p => p.functionCall);
      
      if (functionCalls.length === 0) {
        const textPart = parts.find(p => p.text);
        const finalText = textPart?.text || "Search completed";
        
        console.log(`${colors.blue}│${colors.reset}`);
        console.log(`${colors.blue}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iterations, ${totalToolCalls} tool calls${colors.reset}`);
        console.log(`${colors.blue}└──────────────────────────────────────${colors.reset}\n`);
        
        return finalText;
      }

      console.log(`${colors.blue}│${colors.reset} ${colors.dim}[iter ${iterations}] ${functionCalls.length} parallel calls${colors.reset}`);
      
      const functionResponses = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        totalToolCalls++;
        
        const shortArgs = JSON.stringify(args).substring(0, 30);
        console.log(`${colors.blue}│${colors.reset}   ${colors.green}${name}${colors.reset}(${shortArgs}...)`);
        
        const result = this.executeReadOnlyTool(name, args);
        functionResponses.push({
          functionResponse: {
            name: name,
            response: { result: result },
          },
        });
      }

      response = await chat.sendMessage(functionResponses);
    }

    console.log(`${colors.blue}│${colors.reset} ${colors.dim}Max iterations reached${colors.reset}`);
    console.log(`${colors.blue}└──────────────────────────────────────${colors.reset}\n`);
    return "Search reached maximum iterations";
  }

  async searchWithAnthropic(systemPrompt, query) {
    const messages = [{ role: "user", content: query }];
    let iterations = 0;
    const maxIterations = 10;
    let totalToolCalls = 0;

    while (iterations < maxIterations) {
      iterations++;

      const response = await this.client.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 4096,
        system: systemPrompt,
        tools: searchAgentTools,
        messages: messages,
      });

      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      let textResponse = "";

      for (const block of response.content) {
        if (block.type === "text") {
          textResponse = block.text;
        } else if (block.type === "tool_use") {
          totalToolCalls++;
          const shortInput = JSON.stringify(block.input).substring(0, 30);
          console.log(`${colors.blue}│${colors.reset}   ${colors.green}${block.name}${colors.reset}(${shortInput}...)`);
          
          const result = this.executeReadOnlyTool(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      if (toolResults.length === 0) {
        console.log(`${colors.blue}│${colors.reset}`);
        console.log(`${colors.blue}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iterations, ${totalToolCalls} tool calls${colors.reset}`);
        console.log(`${colors.blue}└──────────────────────────────────────${colors.reset}\n`);
        return textResponse;
      }

      messages.push({ role: "user", content: toolResults });
    }

    return "Search reached maximum iterations";
  }
}

// =============================================================================
// LIBRARIAN - Specialized agent for external library research
// =============================================================================

class Librarian {
  constructor() {
    this.client = new Anthropic();
  }

  executeReadOnlyTool(name, input) {
    switch (name) {
      case "read_file":
        return readFile(input.path);
      case "list_files":
        return listFiles(input.path || ".");
      case "code_search":
        return codeSearch(input.pattern, input.path || ".", input.file_type, input.case_sensitive || false);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  simulateWebSearch(query) {
    return `[Web search for: "${query}"]

Note: In production, this would return actual search results from:
- Official documentation sites
- GitHub repositories
- Stack Overflow
- npm/PyPI package pages

To enable real web search, integrate with:
- Exa AI (https://exa.ai)
- Tavily (https://tavily.com)
- SerpAPI
- Or use the browser tool`;
  }

  async research(query, library, type = "conceptual") {
    console.log(
      `\n${colors.magenta}┌─ Librarian ────────────────────────────${colors.reset}`
    );
    console.log(`${colors.magenta}│${colors.reset} ${colors.dim}Library: ${library}${colors.reset}`);
    console.log(`${colors.magenta}│${colors.reset} ${colors.dim}Type: ${type}${colors.reset}`);
    console.log(`${colors.magenta}│${colors.reset} ${colors.dim}Query: ${query.substring(0, 50)}${query.length > 50 ? '...' : ''}${colors.reset}`);
    console.log(`${colors.magenta}│${colors.reset}`);

    const currentYear = new Date().getFullYear();
    
    const systemPrompt = `You are THE LIBRARIAN, a specialized agent for researching external libraries and documentation.

YOUR JOB: Answer questions about "${library}" by finding EVIDENCE.

## CURRENT DATE AWARENESS
- Current year: ${currentYear}
- NEVER search for outdated ${currentYear - 1} information
- Always prioritize current/recent documentation

## REQUEST TYPE: ${type.toUpperCase()}

${type === 'conceptual' ? `
CONCEPTUAL QUESTION - Focus on:
1. Official documentation and best practices
2. How to properly use the API
3. Common patterns and idioms
` : ''}
${type === 'implementation' ? `
IMPLEMENTATION QUESTION - Focus on:
1. Source code analysis
2. Internal implementation details
3. How the library works under the hood
` : ''}
${type === 'examples' ? `
EXAMPLES QUESTION - Focus on:
1. Real-world usage patterns
2. Open source projects using this library
3. Code snippets and patterns
` : ''}
${type === 'troubleshooting' ? `
TROUBLESHOOTING QUESTION - Focus on:
1. Common errors and solutions
2. Why specific behaviors occur
3. Debugging approaches
` : ''}

## YOUR TOOLS
- code_search: Search the LOCAL codebase for how "${library}" is used here
- read_file: Read local files that use "${library}"
- list_files: Find files related to "${library}"

## RESEARCH STRATEGY
1. First, search the LOCAL codebase for existing usage of "${library}"
2. Identify patterns in how it's currently used
3. Look at package.json/requirements.txt for version info
4. Provide actionable, evidence-based answers

## OUTPUT FORMAT
- Be concise but thorough
- Include code examples when relevant
- Cite specific files/lines when referencing local code
- Acknowledge when you need external docs (web search would help)

## IMPORTANT
- If you cannot find the answer in local files, clearly state that web search would be needed
- Don't make up documentation - admit uncertainty
- Focus on what you CAN find locally`;

    const userMessage = `Research question about ${library}: ${query}

First, search the local codebase to see how ${library} is currently used, then provide your analysis.`;

    const messages = [{ role: "user", content: userMessage }];
    let iterations = 0;
    const maxIterations = 15;
    let totalToolCalls = 0;

    try {
      while (iterations < maxIterations) {
        iterations++;

        const response = await this.client.messages.create({
          model: CONFIG.mainModel,
          max_tokens: CONFIG.maxTokens,
          system: systemPrompt,
          tools: librarianTools,
          messages: messages,
        });

        messages.push({ role: "assistant", content: response.content });

        const toolResults = [];
        let textResponse = "";

        for (const block of response.content) {
          if (block.type === "text") {
            textResponse = block.text;
          } else if (block.type === "tool_use") {
            totalToolCalls++;
            const shortInput = JSON.stringify(block.input).substring(0, 40);
            console.log(`${colors.magenta}│${colors.reset}   ${colors.green}${block.name}${colors.reset}(${shortInput}...)`);
            
            const result = this.executeReadOnlyTool(block.name, block.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        if (toolResults.length === 0) {
          console.log(`${colors.magenta}│${colors.reset}`);
          console.log(`${colors.magenta}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iterations, ${totalToolCalls} tool calls${colors.reset}`);
          
          const lines = textResponse.split('\n').slice(0, 3);
          for (const line of lines) {
            console.log(`${colors.magenta}│${colors.reset} ${colors.dim}${line.substring(0, 60)}${line.length > 60 ? '...' : ''}${colors.reset}`);
          }
          
          console.log(`${colors.magenta}└────────────────────────────────────────${colors.reset}\n`);
          return textResponse || "Research completed";
        }

        messages.push({ role: "user", content: toolResults });
      }

      console.log(`${colors.magenta}│${colors.reset} ${colors.dim}Max iterations reached${colors.reset}`);
      console.log(`${colors.magenta}└────────────────────────────────────────${colors.reset}\n`);
      return "Librarian reached maximum iterations";

    } catch (err) {
      console.log(`${colors.magenta}│${colors.reset} ${colors.dim}Error: ${err.message}${colors.reset}`);
      console.log(`${colors.magenta}└────────────────────────────────────────${colors.reset}\n`);
      return `Librarian error: ${err.message}`;
    }
  }
}

// =============================================================================
// SUBAGENT - Isolated agent for focused tasks (context garbage collection)
// =============================================================================

class Subagent {
  constructor() {
    this.client = new Anthropic();
  }

  executeTool(name, input) {
    switch (name) {
      case "read_file":
        return readFile(input.path);
      case "list_files":
        return listFiles(input.path || ".");
      case "edit_file":
        return editFile(input.path, input.old_str, input.new_str);
      case "bash":
        return bash(input.command, input.timeout || 30000);
      case "code_search":
        return codeSearch(input.pattern, input.path || ".", input.file_type, input.case_sensitive || false);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  truncateOutput(text, maxTokens) {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) {
      return text;
    }
    
    const keepChars = Math.floor(maxChars / 2) - 50;
    const beginning = text.substring(0, keepChars);
    const end = text.substring(text.length - keepChars);
    
    return `${beginning}\n\n... [OUTPUT TRUNCATED - ${text.length - maxChars} chars removed to fit ${maxTokens} token limit] ...\n\n${end}`;
  }

  async spawn(task, workingDirectory = ".", maxOutputTokens = 2000, outputFormat = "full") {
    console.log(
      `\n${colors.cyan}┌─ Subagent ─────────────────────────────${colors.reset}`
    );
    console.log(`${colors.cyan}│${colors.reset} ${colors.dim}Task: ${task.substring(0, 60)}${task.length > 60 ? '...' : ''}${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} ${colors.dim}Working dir: ${workingDirectory} | Max output: ${maxOutputTokens} tokens${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset}`);

    let outputInstructions = "";
    switch (outputFormat) {
      case "summary":
        outputInstructions = `
OUTPUT FORMAT: Provide a brief, condensed summary. 
- Use bullet points for key findings
- Omit unnecessary details
- Focus on actionable insights
- Keep response under ${maxOutputTokens} tokens`;
        break;
      case "structured":
        outputInstructions = `
OUTPUT FORMAT: Respond with valid JSON only.
- Use a clear structure with meaningful keys
- Keep response under ${maxOutputTokens} tokens
- Example: {"findings": [...], "recommendations": [...], "summary": "..."}`;
        break;
      default:
        outputInstructions = `
OUTPUT: Be thorough but concise. The parent agent only sees your final response.
- Your final message is what gets returned
- Keep it under ${maxOutputTokens} tokens
- Include the most important information first`;
    }

    const systemPrompt = `You are a focused subagent completing a specific task.

Your job: Complete the task and return a clear result to the parent agent.

You have access to these tools:
- read_file: Read file contents
- list_files: List directory contents  
- code_search: Search for patterns with ripgrep
- edit_file: Create or modify files
- bash: Run shell commands

IMPORTANT - CONTEXT EFFICIENCY:
- You exist to do work so the parent agent's context stays clean
- The parent agent does NOT see your tool calls or intermediate work
- They ONLY see your final text response
- Be thorough in your work, concise in your response
${outputInstructions}

Working directory: ${workingDirectory}`;

    const messages = [
      { role: "user", content: task }
    ];

    let iterations = 0;
    const maxIterations = 20;
    let toolCallCount = 0;

    try {
      while (iterations < maxIterations) {
        iterations++;

        const response = await this.client.messages.create({
          model: CONFIG.mainModel,
          max_tokens: CONFIG.maxTokens,
          system: systemPrompt,
          tools: subagentTools,
          messages: messages,
        });

        messages.push({ role: "assistant", content: response.content });

        const toolResults = [];
        let textResponse = "";

        for (const block of response.content) {
          if (block.type === "text") {
            textResponse = block.text;
          } else if (block.type === "tool_use") {
            toolCallCount++;
            const inputPreview = JSON.stringify(block.input);
            const displayInput = inputPreview.length > 40 ? inputPreview.substring(0, 40) + "..." : inputPreview;
            console.log(
              `${colors.cyan}│${colors.reset} ${colors.green}[${toolCallCount}]${colors.reset} ${block.name}(${displayInput})`
            );

            const result = this.executeTool(block.name, block.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          }
        }

        if (toolResults.length === 0) {
          console.log(`${colors.cyan}│${colors.reset}`);
          console.log(`${colors.cyan}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iterations, ${toolCallCount} tool calls${colors.reset}`);
          
          const finalOutput = this.truncateOutput(textResponse || "Task completed", maxOutputTokens);
          const outputLines = finalOutput.split('\n').slice(0, 5);
          for (const line of outputLines) {
            console.log(`${colors.cyan}│${colors.reset} ${colors.dim}${line.substring(0, 70)}${line.length > 70 ? '...' : ''}${colors.reset}`);
          }
          if (finalOutput.split('\n').length > 5) {
            console.log(`${colors.cyan}│${colors.reset} ${colors.dim}... (${finalOutput.split('\n').length - 5} more lines)${colors.reset}`);
          }
          
          console.log(`${colors.cyan}└────────────────────────────────────────${colors.reset}\n`);
          
          return finalOutput;
        }

        messages.push({ role: "user", content: toolResults });
      }

      console.log(`${colors.cyan}│${colors.reset} ${colors.dim}⚠ Max iterations reached${colors.reset}`);
      console.log(`${colors.cyan}└────────────────────────────────────────${colors.reset}\n`);
      return this.truncateOutput("Subagent reached maximum iterations. Partial work may have been completed.", maxOutputTokens);

    } catch (err) {
      console.log(`${colors.cyan}│${colors.reset} ${colors.dim}✗ Error: ${err.message}${colors.reset}`);
      console.log(`${colors.cyan}└────────────────────────────────────────${colors.reset}\n`);
      return `Subagent error: ${err.message}`;
    }
  }
}

class Agent {
  constructor() {
    this.client = new Anthropic();
    this.oracle = new Oracle();
    this.subagent = new Subagent();
    this.searchAgent = new SearchAgent();
    this.librarian = new Librarian();
    this.conversation = [];
  }

  async executeTool(name, input) {
    switch (name) {
      case "read_file":
        return readFile(input.path);
      case "list_files":
        return listFiles(input.path || ".");
      case "edit_file":
        return editFile(input.path, input.old_str, input.new_str);
      case "bash":
        return bash(input.command, input.timeout || 30000);
      case "code_search":
        return codeSearch(input.pattern, input.path || ".", input.file_type, input.case_sensitive || false);
      case "oracle":
        return await this.oracle.consult(input.query, input.context || "");
      case "subagent":
        return await this.subagent.spawn(
          input.task, 
          input.working_directory || ".", 
          input.max_output_tokens || 2000,
          input.output_format || "full"
        );
      case "search_agent":
        return await this.searchAgent.search(input.query, input.scope || ".");
      case "parallel_subagents":
        return await this.runParallelSubagents(input.tasks, input.max_output_tokens_per_task || 1000);
      case "librarian":
        return await this.librarian.research(input.query, input.library, input.type || "conceptual");
      default:
        return `Unknown tool: ${name}`;
    }
  }

  async runParallelSubagents(tasks, maxOutputTokens) {
    console.log(
      `\n${colors.yellow}┌─ Parallel Subagents (${tasks.length} tasks) ──────${colors.reset}`
    );
    
    for (const task of tasks) {
      console.log(`${colors.yellow}│${colors.reset} ${colors.dim}• ${task.name}: ${task.task.substring(0, 40)}...${colors.reset}`);
    }
    console.log(`${colors.yellow}│${colors.reset}`);
    console.log(`${colors.yellow}│${colors.reset} ${colors.dim}Starting parallel execution...${colors.reset}`);
    console.log(`${colors.yellow}└──────────────────────────────────────${colors.reset}\n`);

    const startTime = Date.now();
    const results = await Promise.all(
      tasks.map(async (task) => {
        try {
          const result = await this.subagent.spawn(
            task.task,
            task.working_directory || ".",
            maxOutputTokens,
            "summary"
          );
          return { name: task.name, success: true, result };
        } catch (err) {
          return { name: task.name, success: false, result: `Error: ${err.message}` };
        }
      })
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(
      `\n${colors.yellow}┌─ Parallel Results (${elapsed}s) ────────────${colors.reset}`
    );
    
    let formattedResults = [];
    for (const r of results) {
      const status = r.success ? "✓" : "✗";
      console.log(`${colors.yellow}│${colors.reset} ${status} ${colors.dim}${r.name}${colors.reset}`);
      formattedResults.push(`## ${r.name}\n${r.result}`);
    }
    
    console.log(`${colors.yellow}└──────────────────────────────────────${colors.reset}\n`);
    
    return formattedResults.join("\n\n---\n\n");
  }

  async runInference() {
    const response = await this.client.messages.create({
      model: CONFIG.mainModel,
      max_tokens: CONFIG.maxTokens,
      tools: mainAgentTools,
      messages: this.conversation,
    });
    return response;
  }

  async chat(userMessage) {
    this.conversation.push({
      role: "user",
      content: userMessage,
    });

    while (true) {
      const response = await this.runInference();

      this.conversation.push({
        role: "assistant",
        content: response.content,
      });

      const toolResults = [];

      for (const block of response.content) {
        if (block.type === "text") {
          console.log(`${colors.yellow}Claude${colors.reset}: ${block.text}`);
        } else if (block.type === "tool_use") {
          if (block.name === "oracle") {
            console.log(
              `${colors.green}tool${colors.reset}: ${colors.magenta}oracle${colors.reset}("${block.input.query.substring(0, 50)}...")`
            );
          } else if (block.name === "subagent") {
            console.log(
              `${colors.green}tool${colors.reset}: ${colors.cyan}subagent${colors.reset}("${block.input.task.substring(0, 50)}...")`
            );
          } else if (block.name === "search_agent") {
            console.log(
              `${colors.green}tool${colors.reset}: ${colors.blue}search_agent${colors.reset}("${block.input.query.substring(0, 50)}...")`
            );
          } else if (block.name === "parallel_subagents") {
            console.log(
              `${colors.green}tool${colors.reset}: ${colors.yellow}parallel_subagents${colors.reset}(${block.input.tasks.length} tasks)`
            );
          } else if (block.name === "librarian") {
            console.log(
              `${colors.green}tool${colors.reset}: ${colors.magenta}librarian${colors.reset}(${block.input.library}: "${block.input.query.substring(0, 40)}...")`
            );
          } else {
            console.log(
              `${colors.green}tool${colors.reset}: ${block.name}(${JSON.stringify(block.input)})`
            );
          }

          const result = await this.executeTool(block.name, block.input);

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      if (toolResults.length === 0) {
        break;
      }

      this.conversation.push({
        role: "user",
        content: toolResults,
      });
    }
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  if (CONFIG.oracleProvider === "openai" && !process.env.OPENAI_API_KEY) {
    console.error(
      "Error: OPENAI_API_KEY environment variable is required for OpenAI oracle"
    );
    console.error('Set oracleProvider to "anthropic" to use Anthropic models instead');
    process.exit(1);
  }

  const agent = new Agent();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║                    Code Editing Agent                     ║
║                      with Oracle                          ║
╠═══════════════════════════════════════════════════════════╣
║  Main Agent: ${CONFIG.mainModel.padEnd(43)}║
║  Oracle:     ${(CONFIG.oracleModel + " (" + CONFIG.oracleProvider + ")").padEnd(43)}║
╚═══════════════════════════════════════════════════════════╝${colors.reset}

${colors.dim}Tips:
- Ask Claude to "use the oracle" for complex analysis
- Oracle excels at code review, debugging, and planning
- Use 'ctrl-c' to quit${colors.reset}
`);

  const askQuestion = () => {
    rl.question(`${colors.blue}You${colors.reset}: `, async (input) => {
      if (!input.trim()) {
        askQuestion();
        return;
      }

      try {
        await agent.chat(input);
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }

      console.log();
      askQuestion();
    });
  };

  askQuestion();
}

main();