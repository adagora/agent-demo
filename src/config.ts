/**
 * Agent Configuration
 */

import type { Config, Colors } from "./types.js";

export const CONFIG: Config = {
  // Main agent model (fast, good at agentic coding)
  // Options: "claude-sonnet-4-20250514", "claude-opus-4-20250514", "gpt-5.2-codex"
  mainModel: "claude-sonnet-4-20250514",
  mainModelProvider: "anthropic", // "anthropic" or "openai"

  // Oracle model (slower, better at reasoning/analysis)
  oracleModel: "o3-mini",
  oracleProvider: "openai",

  // Search agent model (optimized for fast parallel tool calls)
  searchModel: "gemini-2.0-flash",
  searchProvider: "google",

  maxTokens: 8096,

  // Feedback loop settings
  feedbackLoops: {
    enabled: true,
    maxRetries: 3,
  },
};

// Terminal colors
export const colors: Colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};
