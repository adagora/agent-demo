/**
 * Code Editing Agent with Oracle, Search Agent, and Feedback Loops
 *
 * A TypeScript-based coding agent built on these principles:
 * - Five core primitives: read, list, search, edit, execute
 * - Subagents for context management (context is like RAM - can malloc but not free)
 * - Feedback loops for code validation (TypeScript + Tests + Lint)
 *
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
} from "@google/generative-ai";
import * as readline from "readline";

import { CONFIG, colors } from "./config.js";
import {
  mainAgentTools,
  subagentTools,
  searchAgentTools,
  librarianTools,
  readOnlyTools,
} from "./tools.js";
import {
  readFile,
  listFiles,
  codeSearch,
  editFile,
  bash,
  runFeedbackLoops,
  truncateOutput,
} from "./tool-implementations.js";
import type {
  Message,
  ContentBlock,
  ToolResultBlock,
  AnthropicResponse,
  OpenAIMessage,
  OpenAIToolCall,
  GeminiPart,
  ParallelTaskResult,
  ToolInput,
  ToolDefinition,
} from "./types.js";

// =============================================================================
// ORACLE - The reasoning subagent
// =============================================================================

class Oracle {
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic;

  constructor() {
    this.anthropicClient = new Anthropic();
    if (CONFIG.oracleProvider === "openai" && process.env.OPENAI_API_KEY) {
      this.openaiClient = new OpenAI();
    }
  }

  private executeReadOnlyTool(
    name: string,
    input: Record<string, unknown>,
  ): string {
    switch (name) {
      case "read_file":
        return readFile(input.path as string);
      case "list_files":
        return listFiles((input.path as string) || ".");
      case "code_search":
        return codeSearch(
          input.pattern as string,
          (input.path as string) || ".",
          input.file_type as string | undefined,
          (input.case_sensitive as boolean) || false,
        );
      default:
        return `Unknown tool: ${name}`;
    }
  }

  async consult(query: string, context: string = ""): Promise<string> {
    console.log(
      `\n${colors.magenta}┌─ Oracle (${CONFIG.oracleModel}) ─────────────────${colors.reset}`,
    );
    console.log(
      `${colors.magenta}│${colors.reset} ${colors.dim}Query: ${query.substring(0, 60)}...${colors.reset}`,
    );
    console.log(`${colors.magenta}│${colors.reset}`);

    const systemPrompt = `You are the Oracle - a powerful reasoning model consulted for complex analysis.

Your strengths:
- Deep code analysis and bug finding
- Understanding complex logic and architecture
- Debugging difficult issues
- Planning refactoring strategies

You have READ-ONLY access to the codebase. You can read files and search, but CANNOT edit.

Be thorough but concise. Focus on actionable insights.`;

    const userMessage = context
      ? `Context:\n${context}\n\nQuestion: ${query}`
      : query;

    try {
      if (CONFIG.oracleProvider === "openai" && this.openaiClient) {
        return await this.consultOpenAI(systemPrompt, userMessage);
      } else {
        return await this.consultAnthropic(systemPrompt, userMessage);
      }
    } catch (err) {
      const error = err as Error;
      console.log(`${colors.magenta}│${colors.reset} Error: ${error.message}`);
      console.log(
        `${colors.magenta}└─────────────────────────────────────${colors.reset}\n`,
      );
      return `Oracle error: ${error.message}`;
    }
  }

  private toOpenAITools(
    tools: ToolDefinition[],
  ): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  private async consultOpenAI(
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const openAITools = this.toOpenAITools(readOnlyTools);

    while (true) {
      const response = await this.openaiClient.chat.completions.create({
        model: CONFIG.oracleModel,
        messages,
        tools: openAITools,
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const name = toolCall.function.name;
          const input = JSON.parse(toolCall.function.arguments);

          console.log(
            `${colors.magenta}│${colors.reset} ${colors.cyan}tool: ${name}${colors.reset}`,
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

  private async consultAnthropic(
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    const messages: Message[] = [{ role: "user", content: userMessage }];

    while (true) {
      const response = await this.anthropicClient.messages.create({
        model: CONFIG.oracleModel,
        max_tokens: CONFIG.maxTokens,
        system: systemPrompt,
        tools: readOnlyTools,
        messages: messages as Anthropic.MessageParam[],
      });

      messages.push({ role: "assistant", content: response.content });

      const toolResults: ToolResultBlock[] = [];
      let textResponse = "";

      for (const block of response.content) {
        if (block.type === "text") {
          textResponse += block.text;
        } else if (block.type === "tool_use") {
          console.log(
            `${colors.magenta}│${colors.reset} ${colors.cyan}tool: ${block.name}${colors.reset}`,
          );

          const result = this.executeReadOnlyTool(
            block.name,
            block.input as Record<string, unknown>,
          );
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

      messages.push({
        role: "user",
        content: toolResults as unknown as string,
      });
    }
  }

  private printOracleResponse(response: string): void {
    const lines = response.split("\n").slice(0, 10);
    for (const line of lines) {
      console.log(`${colors.magenta}│${colors.reset} ${line.substring(0, 70)}`);
    }
    if (response.split("\n").length > 10) {
      console.log(
        `${colors.magenta}│${colors.reset} ${colors.dim}... (${response.split("\n").length - 10} more lines)${colors.reset}`,
      );
    }
    console.log(
      `${colors.magenta}└─────────────────────────────────────${colors.reset}\n`,
    );
  }
}

// =============================================================================
// SEARCH AGENT - Fast parallel codebase search (Gemini Flash)
// =============================================================================

class SearchAgent {
  private genAI: GoogleGenerativeAI | null = null;
  private anthropicClient: Anthropic;

  constructor() {
    this.anthropicClient = new Anthropic();
    if (CONFIG.searchProvider === "google" && process.env.GOOGLE_API_KEY) {
      this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    }
  }

  private executeReadOnlyTool(
    name: string,
    input: Record<string, unknown>,
  ): string {
    switch (name) {
      case "read_file":
        return readFile(input.path as string);
      case "list_files":
        return listFiles((input.path as string) || ".");
      case "code_search":
        return codeSearch(
          input.pattern as string,
          (input.path as string) || ".",
          input.file_type as string | undefined,
          (input.case_sensitive as boolean) || false,
        );
      default:
        return `Unknown tool: ${name}`;
    }
  }

  async search(query: string, scope: string = "."): Promise<string> {
    console.log(
      `\n${colors.blue}┌─ Search Agent (${CONFIG.searchModel}) ────────${colors.reset}`,
    );
    console.log(
      `${colors.blue}│${colors.reset} ${colors.dim}Query: ${query.substring(0, 60)}${query.length > 60 ? "..." : ""}${colors.reset}`,
    );
    console.log(`${colors.blue}│${colors.reset}`);

    const systemPrompt = `You are a fast codebase search agent. Your job is to quickly find relevant code.

STRATEGY:
- Use code_search aggressively with diverse queries
- Fire off MULTIPLE parallel searches when possible
- Read files only when you need to verify findings
- Conclude early once you have enough information

You're searching in: ${scope}

Return a concise summary of what you found and where.`;

    try {
      if (CONFIG.searchProvider === "google" && this.genAI) {
        return await this.searchWithGemini(systemPrompt, query);
      } else {
        return await this.searchWithAnthropic(systemPrompt, query);
      }
    } catch (err) {
      const error = err as Error;
      console.log(`${colors.blue}│${colors.reset} Error: ${error.message}`);
      console.log(
        `${colors.blue}└──────────────────────────────────────${colors.reset}\n`,
      );
      return `Search error: ${error.message}`;
    }
  }

  private toGeminiTools(tools: ToolDefinition[]): FunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: tool.input_schema.properties,
        required: tool.input_schema.required || [],
      },
    })) as FunctionDeclaration[];
  }

  private async searchWithGemini(
    systemPrompt: string,
    query: string,
  ): Promise<string> {
    if (!this.genAI) throw new Error("Gemini client not initialized");

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
      const functionCalls = parts.filter(
        (p) => "functionCall" in p && p.functionCall,
      );

      if (functionCalls.length === 0) {
        const textPart = parts.find((p) => "text" in p && p.text);
        const finalText =
          (textPart && "text" in textPart ? textPart.text : null) ||
          "Search completed";

        console.log(`${colors.blue}│${colors.reset}`);
        console.log(
          `${colors.blue}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iters, ${totalToolCalls} calls${colors.reset}`,
        );
        console.log(
          `${colors.blue}└──────────────────────────────────────${colors.reset}\n`,
        );

        return finalText;
      }

      console.log(
        `${colors.blue}│${colors.reset} ${colors.dim}[iter ${iterations}] ${functionCalls.length} parallel calls${colors.reset}`,
      );

      const functionResponses = [];
      for (const part of functionCalls) {
        if (!("functionCall" in part) || !part.functionCall) continue;
        const { name, args } = part.functionCall;
        totalToolCalls++;

        const shortArgs = JSON.stringify(args).substring(0, 30);
        console.log(
          `${colors.blue}│${colors.reset}   ${colors.green}${name}${colors.reset}(${shortArgs}...)`,
        );

        const result = this.executeReadOnlyTool(
          name,
          args as Record<string, unknown>,
        );
        functionResponses.push({
          functionResponse: {
            name: name,
            response: { result: result },
          },
        });
      }

      response = await chat.sendMessage(functionResponses);
    }

    console.log(`${colors.blue}│${colors.reset} Max iterations reached`);
    console.log(
      `${colors.blue}└──────────────────────────────────────${colors.reset}\n`,
    );
    return "Search reached maximum iterations";
  }

  private async searchWithAnthropic(
    systemPrompt: string,
    query: string,
  ): Promise<string> {
    const messages: Message[] = [{ role: "user", content: query }];
    let iterations = 0;
    const maxIterations = 10;
    let totalToolCalls = 0;

    while (iterations < maxIterations) {
      iterations++;

      const response = await this.anthropicClient.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 4096,
        system: systemPrompt,
        tools: searchAgentTools,
        messages: messages as Anthropic.MessageParam[],
      });

      messages.push({ role: "assistant", content: response.content });

      const toolResults: ToolResultBlock[] = [];
      let textResponse = "";

      for (const block of response.content) {
        if (block.type === "text") {
          textResponse = block.text;
        } else if (block.type === "tool_use") {
          totalToolCalls++;
          console.log(
            `${colors.blue}│${colors.reset}   ${colors.green}${block.name}${colors.reset}`,
          );

          const result = this.executeReadOnlyTool(
            block.name,
            block.input as Record<string, unknown>,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      if (toolResults.length === 0) {
        console.log(`${colors.blue}│${colors.reset}`);
        console.log(
          `${colors.blue}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iters, ${totalToolCalls} calls${colors.reset}`,
        );
        console.log(
          `${colors.blue}└──────────────────────────────────────${colors.reset}\n`,
        );
        return textResponse;
      }

      messages.push({
        role: "user",
        content: toolResults as unknown as string,
      });
    }

    return "Search reached maximum iterations";
  }
}

// =============================================================================
// LIBRARIAN - Specialized agent for external library research
// =============================================================================

class Librarian {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  private executeReadOnlyTool(
    name: string,
    input: Record<string, unknown>,
  ): string {
    switch (name) {
      case "read_file":
        return readFile(input.path as string);
      case "list_files":
        return listFiles((input.path as string) || ".");
      case "code_search":
        return codeSearch(
          input.pattern as string,
          (input.path as string) || ".",
          input.file_type as string | undefined,
          (input.case_sensitive as boolean) || false,
        );
      default:
        return `Unknown tool: ${name}`;
    }
  }

  async research(
    query: string,
    library: string,
    type: string = "conceptual",
  ): Promise<string> {
    console.log(
      `\n${colors.magenta}┌─ Librarian ────────────────────────────${colors.reset}`,
    );
    console.log(
      `${colors.magenta}│${colors.reset} ${colors.dim}Library: ${library}${colors.reset}`,
    );
    console.log(
      `${colors.magenta}│${colors.reset} ${colors.dim}Type: ${type}${colors.reset}`,
    );
    console.log(`${colors.magenta}│${colors.reset}`);

    const currentYear = new Date().getFullYear();

    const systemPrompt = `You are THE LIBRARIAN, a specialized agent for researching external libraries.

YOUR JOB: Answer questions about "${library}" by finding EVIDENCE in the local codebase.

CURRENT YEAR: ${currentYear}

REQUEST TYPE: ${type.toUpperCase()}

YOUR TOOLS:
- code_search: Search the LOCAL codebase for how "${library}" is used here
- read_file: Read local files that use "${library}"
- list_files: Find files related to "${library}"

Focus on what you CAN find locally. Acknowledge when external docs would help.`;

    const userMessage = `Research question about ${library}: ${query}

Search the local codebase for existing usage of ${library}, then provide your analysis.`;

    const messages: Message[] = [{ role: "user", content: userMessage }];
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
          messages: messages as Anthropic.MessageParam[],
        });

        messages.push({ role: "assistant", content: response.content });

        const toolResults: ToolResultBlock[] = [];
        let textResponse = "";

        for (const block of response.content) {
          if (block.type === "text") {
            textResponse = block.text;
          } else if (block.type === "tool_use") {
            totalToolCalls++;
            console.log(
              `${colors.magenta}│${colors.reset}   ${colors.green}${block.name}${colors.reset}`,
            );

            const result = this.executeReadOnlyTool(
              block.name,
              block.input as Record<string, unknown>,
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        if (toolResults.length === 0) {
          console.log(`${colors.magenta}│${colors.reset}`);
          console.log(
            `${colors.magenta}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iters, ${totalToolCalls} calls${colors.reset}`,
          );
          console.log(
            `${colors.magenta}└────────────────────────────────────────${colors.reset}\n`,
          );
          return textResponse || "Research completed";
        }

        messages.push({
          role: "user",
          content: toolResults as unknown as string,
        });
      }

      return "Librarian reached maximum iterations";
    } catch (err) {
      const error = err as Error;
      console.log(`${colors.magenta}│${colors.reset} Error: ${error.message}`);
      console.log(
        `${colors.magenta}└────────────────────────────────────────${colors.reset}\n`,
      );
      return `Librarian error: ${error.message}`;
    }
  }
}

// =============================================================================
// SUBAGENT - Isolated agent for focused tasks (context garbage collection)
// =============================================================================

class Subagent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  private executeTool(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case "read_file":
        return readFile(input.path as string);
      case "list_files":
        return listFiles((input.path as string) || ".");
      case "edit_file":
        return editFile(
          input.path as string,
          input.old_str as string,
          input.new_str as string,
        );
      case "bash":
        return bash(
          input.command as string,
          (input.timeout as number) || 30000,
        );
      case "code_search":
        return codeSearch(
          input.pattern as string,
          (input.path as string) || ".",
          input.file_type as string | undefined,
          (input.case_sensitive as boolean) || false,
        );
      case "feedback_loop":
        const results = runFeedbackLoops(
          (input.working_directory as string) || ".",
        );
        return JSON.stringify(results, null, 2);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  async spawn(
    task: string,
    workingDirectory: string = ".",
    maxOutputTokens: number = 2000,
    outputFormat: string = "full",
  ): Promise<string> {
    console.log(
      `\n${colors.cyan}┌─ Subagent ─────────────────────────────${colors.reset}`,
    );
    console.log(
      `${colors.cyan}│${colors.reset} ${colors.dim}Task: ${task.substring(0, 60)}${task.length > 60 ? "..." : ""}${colors.reset}`,
    );
    console.log(`${colors.cyan}│${colors.reset}`);

    let outputInstructions = "";
    switch (outputFormat) {
      case "summary":
        outputInstructions = `OUTPUT: Brief summary with bullet points. Keep under ${maxOutputTokens} tokens.`;
        break;
      case "structured":
        outputInstructions = `OUTPUT: Valid JSON only. Keep under ${maxOutputTokens} tokens.`;
        break;
      default:
        outputInstructions = `OUTPUT: Be thorough but concise. Keep under ${maxOutputTokens} tokens.`;
    }

    const systemPrompt = `You are a focused subagent completing a specific task.

Your job: Complete the task and return a clear result.

IMPORTANT - CONTEXT EFFICIENCY:
- You exist to do work so the parent agent's context stays clean
- The parent ONLY sees your final text response
- Be thorough in your work, concise in your response

${outputInstructions}

Working directory: ${workingDirectory}`;

    const messages: Message[] = [{ role: "user", content: task }];
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
          messages: messages as Anthropic.MessageParam[],
        });

        messages.push({ role: "assistant", content: response.content });

        const toolResults: ToolResultBlock[] = [];
        let textResponse = "";

        for (const block of response.content) {
          if (block.type === "text") {
            textResponse = block.text;
          } else if (block.type === "tool_use") {
            toolCallCount++;
            const inputPreview = JSON.stringify(block.input).substring(0, 40);
            console.log(
              `${colors.cyan}│${colors.reset} ${colors.green}[${toolCallCount}]${colors.reset} ${block.name}(${inputPreview}...)`,
            );

            const result = this.executeTool(
              block.name,
              block.input as Record<string, unknown>,
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content:
                typeof result === "string" ? result : JSON.stringify(result),
            });
          }
        }

        if (toolResults.length === 0) {
          console.log(`${colors.cyan}│${colors.reset}`);
          console.log(
            `${colors.cyan}│${colors.reset} ${colors.dim}✓ Completed: ${iterations} iters, ${toolCallCount} calls${colors.reset}`,
          );
          console.log(
            `${colors.cyan}└────────────────────────────────────────${colors.reset}\n`,
          );

          return truncateOutput(
            textResponse || "Task completed",
            maxOutputTokens,
          );
        }

        messages.push({
          role: "user",
          content: toolResults as unknown as string,
        });
      }

      console.log(`${colors.cyan}│${colors.reset} Max iterations reached`);
      console.log(
        `${colors.cyan}└────────────────────────────────────────${colors.reset}\n`,
      );
      return truncateOutput(
        "Subagent reached maximum iterations.",
        maxOutputTokens,
      );
    } catch (err) {
      const error = err as Error;
      console.log(`${colors.cyan}│${colors.reset} Error: ${error.message}`);
      console.log(
        `${colors.cyan}└────────────────────────────────────────${colors.reset}\n`,
      );
      return `Subagent error: ${error.message}`;
    }
  }
}

// =============================================================================
// MAIN AGENT
// =============================================================================

class Agent {
  private anthropicClient: Anthropic;
  private openaiClient: OpenAI | null = null;
  private oracle: Oracle;
  private subagent: Subagent;
  private searchAgent: SearchAgent;
  private librarian: Librarian;
  private conversation: Message[];
  private openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  constructor() {
    this.anthropicClient = new Anthropic();
    if (CONFIG.mainModelProvider === "openai" && process.env.OPENAI_API_KEY) {
      this.openaiClient = new OpenAI();
    }
    this.oracle = new Oracle();
    this.subagent = new Subagent();
    this.searchAgent = new SearchAgent();
    this.librarian = new Librarian();
    this.conversation = [];
  }

  private toOpenAITools(
    tools: ToolDefinition[],
  ): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      case "read_file":
        return readFile(input.path as string);
      case "list_files":
        return listFiles((input.path as string) || ".");
      case "edit_file":
        return editFile(
          input.path as string,
          input.old_str as string,
          input.new_str as string,
        );
      case "bash":
        return bash(
          input.command as string,
          (input.timeout as number) || 30000,
        );
      case "code_search":
        return codeSearch(
          input.pattern as string,
          (input.path as string) || ".",
          input.file_type as string | undefined,
          (input.case_sensitive as boolean) || false,
        );
      case "oracle":
        return await this.oracle.consult(
          input.query as string,
          (input.context as string) || "",
        );
      case "subagent":
        return await this.subagent.spawn(
          input.task as string,
          (input.working_directory as string) || ".",
          (input.max_output_tokens as number) || 2000,
          (input.output_format as string) || "full",
        );
      case "search_agent":
        return await this.searchAgent.search(
          input.query as string,
          (input.scope as string) || ".",
        );
      case "parallel_subagents":
        return await this.runParallelSubagents(
          input.tasks as Array<{
            name: string;
            task: string;
            working_directory?: string;
          }>,
          (input.max_output_tokens_per_task as number) || 1000,
        );
      case "librarian":
        return await this.librarian.research(
          input.query as string,
          input.library as string,
          (input.type as string) || "conceptual",
        );
      case "feedback_loop":
        return this.runFeedbackLoop(
          (input.working_directory as string) || ".",
          (input.fix_and_retry as boolean) || false,
        );
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private runFeedbackLoop(workingDir: string, _fixAndRetry: boolean): string {
    console.log(
      `\n${colors.green}┌─ Feedback Loop ────────────────────────${colors.reset}`,
    );
    console.log(
      `${colors.green}│${colors.reset} ${colors.dim}Running: TypeScript + Tests + Lint${colors.reset}`,
    );
    console.log(`${colors.green}│${colors.reset}`);

    const results = runFeedbackLoops(workingDir);

    const statusEmoji = (passed: boolean): string => (passed ? "✓" : "✗");
    console.log(
      `${colors.green}│${colors.reset} ${statusEmoji(results.typescript?.passed ?? true)} TypeScript`,
    );
    console.log(
      `${colors.green}│${colors.reset} ${statusEmoji(results.tests?.passed ?? true)} Tests${results.tests?.skipped ? " (skipped)" : ""}`,
    );
    console.log(
      `${colors.green}│${colors.reset} ${statusEmoji(results.lint?.passed ?? true)} Lint${results.lint?.skipped ? " (skipped)" : ""}`,
    );
    console.log(`${colors.green}│${colors.reset}`);

    if (results.allPassed) {
      console.log(
        `${colors.green}│${colors.reset} ${colors.green}✓ All checks passed!${colors.reset}`,
      );
    } else {
      console.log(
        `${colors.green}│${colors.reset} ${colors.red}✗ Some checks failed${colors.reset}`,
      );
    }

    console.log(
      `${colors.green}└────────────────────────────────────────${colors.reset}\n`,
    );

    return JSON.stringify(
      {
        summary: results.summary,
        allPassed: results.allPassed,
        typescript: {
          passed: results.typescript?.passed,
          output: results.typescript?.passed
            ? null
            : results.typescript?.output?.substring(0, 2000),
        },
        tests: {
          passed: results.tests?.passed,
          skipped: results.tests?.skipped,
          output: results.tests?.passed
            ? null
            : results.tests?.output?.substring(0, 2000),
        },
        lint: {
          passed: results.lint?.passed,
          skipped: results.lint?.skipped,
          output: results.lint?.passed
            ? null
            : results.lint?.output?.substring(0, 2000),
        },
      },
      null,
      2,
    );
  }

  private async runParallelSubagents(
    tasks: Array<{ name: string; task: string; working_directory?: string }>,
    maxOutputTokens: number,
  ): Promise<string> {
    console.log(
      `\n${colors.yellow}┌─ Parallel Subagents (${tasks.length} tasks) ──────${colors.reset}`,
    );

    for (const task of tasks) {
      console.log(
        `${colors.yellow}│${colors.reset} ${colors.dim}• ${task.name}${colors.reset}`,
      );
    }
    console.log(`${colors.yellow}│${colors.reset}`);
    console.log(
      `${colors.yellow}│${colors.reset} ${colors.dim}Starting parallel execution...${colors.reset}`,
    );
    console.log(
      `${colors.yellow}└──────────────────────────────────────${colors.reset}\n`,
    );

    const startTime = Date.now();
    const results: ParallelTaskResult[] = await Promise.all(
      tasks.map(async (task) => {
        try {
          const result = await this.subagent.spawn(
            task.task,
            task.working_directory || ".",
            maxOutputTokens,
            "summary",
          );
          return { name: task.name, success: true, result };
        } catch (err) {
          const error = err as Error;
          return {
            name: task.name,
            success: false,
            result: `Error: ${error.message}`,
          };
        }
      }),
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(
      `\n${colors.yellow}┌─ Parallel Results (${elapsed}s) ────────────${colors.reset}`,
    );

    const formattedResults: string[] = [];
    for (const r of results) {
      const status = r.success ? "✓" : "✗";
      console.log(
        `${colors.yellow}│${colors.reset} ${status} ${colors.dim}${r.name}${colors.reset}`,
      );
      formattedResults.push(`## ${r.name}\n${r.result}`);
    }

    console.log(
      `${colors.yellow}└──────────────────────────────────────${colors.reset}\n`,
    );

    return formattedResults.join("\n\n---\n\n");
  }

  async chat(userMessage: string): Promise<void> {
    if (CONFIG.mainModelProvider === "openai" && this.openaiClient) {
      await this.chatWithOpenAI(userMessage);
    } else {
      await this.chatWithAnthropic(userMessage);
    }
  }

  private async chatWithAnthropic(userMessage: string): Promise<void> {
    this.conversation.push({ role: "user", content: userMessage });

    while (true) {
      const response = await this.anthropicClient.messages.create({
        model: CONFIG.mainModel,
        max_tokens: CONFIG.maxTokens,
        tools: mainAgentTools,
        messages: this.conversation as Anthropic.MessageParam[],
      });

      this.conversation.push({ role: "assistant", content: response.content });

      const toolResults: ToolResultBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          console.log(`${colors.yellow}Claude${colors.reset}: ${block.text}`);
        } else if (block.type === "tool_use") {
          this.displayToolCall(
            block.name,
            block.input as Record<string, unknown>,
          );

          const result = await this.executeTool(
            block.name,
            block.input as Record<string, unknown>,
          );

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
        content: toolResults as unknown as string,
      });
    }
  }

  private async chatWithOpenAI(userMessage: string): Promise<void> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    this.openaiMessages.push({ role: "user", content: userMessage });

    const openAITools = this.toOpenAITools(mainAgentTools);

    while (true) {
      const response = await this.openaiClient.chat.completions.create({
        model: CONFIG.mainModel,
        messages: this.openaiMessages,
        tools: openAITools,
      });

      const message = response.choices[0].message;
      this.openaiMessages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const name = toolCall.function.name;
          const input = JSON.parse(toolCall.function.arguments);

          this.displayToolCall(name, input);

          const result = await this.executeTool(name, input);

          this.openaiMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      } else {
        const content = message.content || "";
        if (content) {
          console.log(`${colors.yellow}GPT${colors.reset}: ${content}`);
        }
        break;
      }
    }
  }

  private displayToolCall(name: string, input: Record<string, unknown>): void {
    switch (name) {
      case "oracle":
        console.log(
          `${colors.green}tool${colors.reset}: ${colors.magenta}oracle${colors.reset}("${(input.query as string).substring(0, 50)}...")`,
        );
        break;
      case "subagent":
        console.log(
          `${colors.green}tool${colors.reset}: ${colors.cyan}subagent${colors.reset}("${(input.task as string).substring(0, 50)}...")`,
        );
        break;
      case "search_agent":
        console.log(
          `${colors.green}tool${colors.reset}: ${colors.blue}search_agent${colors.reset}("${(input.query as string).substring(0, 50)}...")`,
        );
        break;
      case "parallel_subagents":
        console.log(
          `${colors.green}tool${colors.reset}: ${colors.yellow}parallel_subagents${colors.reset}(${(input.tasks as unknown[]).length} tasks)`,
        );
        break;
      case "librarian":
        console.log(
          `${colors.green}tool${colors.reset}: ${colors.magenta}librarian${colors.reset}(${input.library})`,
        );
        break;
      case "feedback_loop":
        console.log(
          `${colors.green}tool${colors.reset}: ${colors.green}feedback_loop${colors.reset}()`,
        );
        break;
      default:
        console.log(
          `${colors.green}tool${colors.reset}: ${name}(${JSON.stringify(input).substring(0, 50)}...)`,
        );
    }
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  // Check main model API key
  if (
    CONFIG.mainModelProvider === "anthropic" &&
    !process.env.ANTHROPIC_API_KEY
  ) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  if (CONFIG.mainModelProvider === "openai" && !process.env.OPENAI_API_KEY) {
    console.error(
      "Error: OPENAI_API_KEY environment variable is required for GPT models",
    );
    process.exit(1);
  }

  // Anthropic key still needed for subagents/librarian when using OpenAI main model
  if (CONFIG.mainModelProvider === "openai" && !process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "Warning: ANTHROPIC_API_KEY not set, subagents and librarian will not work",
    );
  }

  if (CONFIG.oracleProvider === "openai" && !process.env.OPENAI_API_KEY) {
    console.warn(
      "Warning: OPENAI_API_KEY not set, Oracle will use Anthropic fallback",
    );
  }

  if (CONFIG.searchProvider === "google" && !process.env.GOOGLE_API_KEY) {
    console.warn(
      "Warning: GOOGLE_API_KEY not set, Search Agent will use Anthropic fallback",
    );
  }

  const agent = new Agent();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║           Code Editing Agent (TypeScript)                 ║
║        with Oracle, Search Agent & Feedback Loops         ║
╠═══════════════════════════════════════════════════════════╣
║  Main Agent: ${CONFIG.mainModel.padEnd(43)}║
║  Oracle:     ${(CONFIG.oracleModel + " (" + CONFIG.oracleProvider + ")").padEnd(43)}║
║  Search:     ${(CONFIG.searchModel + " (" + CONFIG.searchProvider + ")").padEnd(43)}║
╚═══════════════════════════════════════════════════════════╝${colors.reset}

${colors.dim}Tips:
- Run "feedback_loop" to validate your code (TypeScript + Tests + Lint)
- Use "oracle" for deep analysis
- Use "search_agent" for fast codebase exploration
- Use "librarian" for external library research
- Use 'ctrl-c' to quit${colors.reset}
`);

  const askQuestion = (): void => {
    rl.question(`${colors.blue}You${colors.reset}: `, async (input) => {
      if (!input.trim()) {
        askQuestion();
        return;
      }

      try {
        await agent.chat(input);
      } catch (err) {
        const error = err as Error;
        console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
