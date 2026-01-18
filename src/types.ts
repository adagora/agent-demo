/**
 * Type definitions for the Code Editing Agent
 */

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export type MainModel =
  | "claude-sonnet-4-20250514"
  | "claude-opus-4-20250514"
  | "gpt-5.2-codex"
  | string;

export type MainModelProvider = "anthropic" | "openai";

export interface Config {
  mainModel: MainModel;
  mainModelProvider: MainModelProvider;
  oracleModel: string;
  oracleProvider: "openai" | "anthropic";
  searchModel: string;
  searchProvider: "google" | "anthropic";
  maxTokens: number;
  feedbackLoops: {
    enabled: boolean;
    maxRetries: number;
  };
}

// =============================================================================
// TOOL TYPES
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
}

export interface PropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?:
    | PropertySchema
    | {
        type: string;
        properties?: Record<string, PropertySchema>;
        required?: string[];
      };
}

// Tool input types
export interface ReadFileInput {
  path: string;
}

export interface ListFilesInput {
  path?: string;
}

export interface EditFileInput {
  path: string;
  old_str: string;
  new_str: string;
}

export interface BashInput {
  command: string;
  timeout?: number;
}

export interface CodeSearchInput {
  pattern: string;
  path?: string;
  file_type?: string;
  case_sensitive?: boolean;
}

export interface OracleInput {
  query: string;
  context?: string;
}

export interface SubagentInput {
  task: string;
  working_directory?: string;
  max_output_tokens?: number;
  output_format?: "full" | "summary" | "structured";
}

export interface SearchAgentInput {
  query: string;
  scope?: string;
}

export interface ParallelSubagentsInput {
  tasks: Array<{
    name: string;
    task: string;
    working_directory?: string;
  }>;
  max_output_tokens_per_task?: number;
}

export interface LibrarianInput {
  query: string;
  library: string;
  type?: "conceptual" | "implementation" | "examples" | "troubleshooting";
}

export interface FeedbackLoopInput {
  working_directory?: string;
  fix_and_retry?: boolean;
}

export type ToolInput =
  | ReadFileInput
  | ListFilesInput
  | EditFileInput
  | BashInput
  | CodeSearchInput
  | OracleInput
  | SubagentInput
  | SearchAgentInput
  | ParallelSubagentsInput
  | LibrarianInput
  | FeedbackLoopInput;

// =============================================================================
// FEEDBACK LOOP TYPES
// =============================================================================

export interface FeedbackResult {
  passed: boolean;
  output: string;
  error?: string;
  skipped?: boolean;
}

export interface FeedbackLoopResults {
  typescript: FeedbackResult | null;
  tests: FeedbackResult | null;
  lint: FeedbackResult | null;
  allPassed: boolean;
  summary: string;
}

// =============================================================================
// MESSAGE TYPES
// =============================================================================

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "redacted_thinking";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  data?: string;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface AnthropicResponse {
  content: ContentBlock[];
  stop_reason?: string;
}

export interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

// =============================================================================
// GEMINI TYPES
// =============================================================================

export interface GeminiFunctionCall {
  functionCall: {
    name: string;
    args: object;
  };
}

export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: object;
  };
}

export interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export interface ParallelTaskResult {
  name: string;
  success: boolean;
  result: string;
}

export interface Colors {
  reset: string;
  dim: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
}
