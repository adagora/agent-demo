/**
 * Tool Implementations
 *
 * The actual logic for each tool.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { FeedbackLoopResults, FeedbackResult } from "./types.js";

// =============================================================================
// READ TOOLS
// =============================================================================

/**
 * Read the contents of a file
 */
export function readFile(filePath: string): string {
  try {
    const absolutePath = path.resolve(filePath);
    const content = fs.readFileSync(absolutePath, "utf-8");
    return content;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return `Error reading file: ${error.message}`;
  }
}

/**
 * List files in a directory (recursive, 2 levels deep)
 */
export function listFiles(dirPath: string = "."): string {
  try {
    const absolutePath = path.resolve(dirPath);
    const results: string[] = [];

    function walk(dir: string, depth: number): void {
      if (depth > 2) return;

      const items = fs.readdirSync(dir);

      for (const item of items) {
        // Skip hidden files and node_modules
        if (item.startsWith(".") || item === "node_modules") continue;

        const fullPath = path.join(dir, item);
        const relativePath = path.relative(absolutePath, fullPath);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          results.push(`${relativePath}/`);
          walk(fullPath, depth + 1);
        } else {
          results.push(relativePath);
        }
      }
    }

    walk(absolutePath, 0);
    return results.join("\n") || "No files found";
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return `Error listing files: ${error.message}`;
  }
}

/**
 * Search for patterns using ripgrep (or grep fallback)
 */
export function codeSearch(
  pattern: string,
  searchPath: string = ".",
  fileType?: string,
  caseSensitive: boolean = false,
): string {
  try {
    // Build ripgrep command
    let cmd = "rg";
    const args: string[] = ["--line-number", "--no-heading", "--color=never"];

    if (!caseSensitive) {
      args.push("-i");
    }

    if (fileType) {
      args.push("-t", fileType);
    }

    args.push("--max-count=50"); // Limit results
    args.push("--", pattern, searchPath);

    const fullCmd = `${cmd} ${args.join(" ")}`;

    try {
      const result = execSync(fullCmd, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return result || "No matches found";
    } catch {
      // Ripgrep not found or no matches, try grep
      const grepArgs = ["-r", "-n", "--include=*"];
      if (!caseSensitive) grepArgs.push("-i");
      if (fileType) grepArgs.push(`--include=*.${fileType}`);

      const grepCmd = `grep ${grepArgs.join(" ")} "${pattern}" ${searchPath} | head -50`;
      const result = execSync(grepCmd, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return result || "No matches found";
    }
  } catch (err) {
    const error = err as Error & { status?: number };
    // Exit code 1 means no matches (not an error)
    if (error.status === 1) {
      return "No matches found";
    }
    return `Search error: ${error.message}`;
  }
}

// =============================================================================
// WRITE TOOLS
// =============================================================================

/**
 * Edit a file by replacing old_str with new_str
 */
export function editFile(
  filePath: string,
  oldStr: string,
  newStr: string,
): string {
  try {
    const absolutePath = path.resolve(filePath);

    // If file doesn't exist and old_str is empty, create new file
    if (!fs.existsSync(absolutePath)) {
      if (oldStr === "") {
        // Ensure directory exists
        const dir = path.dirname(absolutePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absolutePath, newStr);
        return `Created new file: ${filePath}`;
      }
      return `Error: File not found: ${filePath}`;
    }

    const content = fs.readFileSync(absolutePath, "utf-8");

    // If old_str is empty, append to file
    if (oldStr === "") {
      fs.writeFileSync(absolutePath, newStr);
      return `Replaced entire file: ${filePath}`;
    }

    // Check if old_str exists in file
    if (!content.includes(oldStr)) {
      return `Error: Could not find the specified text in ${filePath}. Make sure the old_str matches exactly.`;
    }

    // Check for multiple matches
    const matches = content.split(oldStr).length - 1;
    if (matches > 1) {
      return `Error: Found ${matches} matches for the specified text. Please use a more specific string to avoid ambiguity.`;
    }

    // Perform replacement
    const newContent = content.replace(oldStr, newStr);
    fs.writeFileSync(absolutePath, newContent);

    return `Successfully edited ${filePath}`;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return `Error editing file: ${error.message}`;
  }
}

/**
 * Execute a bash command
 */
export function bash(command: string, timeout: number = 30000): string {
  try {
    const result = execSync(command, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result || "Command completed (no output)";
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string };
    // Return output even on non-zero exit
    const output = error.stdout || "";
    const stderr = error.stderr || "";
    return (
      output + (stderr ? `\nSTDERR: ${stderr}` : "") ||
      `Error: ${error.message}`
    );
  }
}

// =============================================================================
// FEEDBACK LOOPS
// =============================================================================

/**
 * Run all feedback loops and return results
 * Based on: https://www.aihero.dev/essential-ai-coding-feedback-loops-for-type-script-projects
 *
 * Key insight: "AI agents don't get frustrated by repetition. When code fails
 * type checking or tests, the agent simply tries again."
 */
export function runFeedbackLoops(
  workingDir: string = ".",
): FeedbackLoopResults {
  const results: FeedbackLoopResults = {
    typescript: null,
    tests: null,
    lint: null,
    allPassed: false,
    summary: "",
  };

  // 1. TypeScript Type Checking (FREE FEEDBACK!)
  try {
    const tscResult = execSync("npx tsc --noEmit 2>&1", {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 60000,
    });
    results.typescript = {
      passed: true,
      output: tscResult || "No type errors",
    };
  } catch (err) {
    const error = err as Error & { stdout?: string };
    results.typescript = {
      passed: false,
      output: error.stdout || error.message,
      error: "TypeScript type errors found",
    };
  }

  // 2. Tests (Vitest/Jest)
  try {
    let testCmd = "npm test 2>&1";

    // Try to detect test runner
    try {
      execSync("npx vitest --version", { cwd: workingDir, encoding: "utf-8" });
      testCmd = "npx vitest run 2>&1";
    } catch {
      try {
        execSync("npx jest --version", { cwd: workingDir, encoding: "utf-8" });
        testCmd = "npx jest 2>&1";
      } catch {
        // Fall back to npm test
      }
    }

    const testResult = execSync(testCmd, {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 120000,
    });
    results.tests = { passed: true, output: testResult };
  } catch (err) {
    const error = err as Error & { stdout?: string };
    const output = error.stdout || error.message;

    if (output.includes("no test") || output.includes("No tests found")) {
      results.tests = {
        passed: true,
        output: "No tests configured",
        skipped: true,
      };
    } else {
      results.tests = {
        passed: false,
        output: output,
        error: "Tests failed",
      };
    }
  }

  // 3. Linting (ESLint)
  try {
    const lintResult = execSync("npx eslint . --ext .ts,.tsx,.js,.jsx 2>&1", {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 60000,
    });
    results.lint = { passed: true, output: lintResult || "No lint errors" };
  } catch (err) {
    const error = err as Error & { stdout?: string };
    const output = error.stdout || error.message;

    if (
      output.includes("No ESLint configuration") ||
      output.includes("eslint: not found")
    ) {
      results.lint = {
        passed: true,
        output: "ESLint not configured",
        skipped: true,
      };
    } else {
      results.lint = {
        passed: false,
        output: output,
        error: "Lint errors found",
      };
    }
  }

  // Summary
  results.allPassed =
    (results.typescript?.passed ?? true) &&
    (results.tests?.passed ?? true) &&
    (results.lint?.passed ?? true);

  const statusEmoji = (r: FeedbackResult | null): string =>
    r?.passed ? "✓" : "✗";

  results.summary = `
Feedback Loop Results:
${statusEmoji(results.typescript)} TypeScript: ${results.typescript?.passed ? "PASS" : "FAIL"}
${statusEmoji(results.tests)} Tests: ${results.tests?.passed ? (results.tests?.skipped ? "SKIP" : "PASS") : "FAIL"}
${statusEmoji(results.lint)} Lint: ${results.lint?.passed ? (results.lint?.skipped ? "SKIP" : "PASS") : "FAIL"}

${results.allPassed ? "✓ All checks passed!" : "✗ Some checks failed - fix and retry"}
`.trim();

  return results;
}

/**
 * Truncate output to stay within token budget
 */
export function truncateOutput(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4; // Rough estimate: 1 token ≈ 4 characters

  if (text.length <= maxChars) {
    return text;
  }

  const keepChars = Math.floor(maxChars / 2) - 50;
  const beginning = text.substring(0, keepChars);
  const end = text.substring(text.length - keepChars);

  return `${beginning}\n\n... [TRUNCATED - ${text.length - maxChars} chars removed] ...\n\n${end}`;
}
