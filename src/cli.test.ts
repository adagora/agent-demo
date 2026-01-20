import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  parseCliArgs,
  loadConfig,
  loadPromptFile,
  buildSystemContext,
} from "./cli.js";

describe("CLI Module", () => {
  describe("parseCliArgs", () => {
    it("should default to build mode with no args", () => {
      const result = parseCliArgs([]);
      expect(result.mode).toBe("build");
      expect(result.loop).toBeUndefined();
      expect(result.yolo).toBe(false);
      expect(result.dryRun).toBe(false);
    });

    it("should parse --plan flag", () => {
      const result = parseCliArgs(["--plan"]);
      expect(result.mode).toBe("plan");
    });

    it("should parse -p short flag", () => {
      const result = parseCliArgs(["-p"]);
      expect(result.mode).toBe("plan");
    });

    it("should parse --loop without value as infinite", () => {
      const result = parseCliArgs(["--loop"]);
      expect(result.loop).toBe("infinite");
    });

    it("should parse --loop with numeric value", () => {
      const result = parseCliArgs(["--loop", "10"]);
      expect(result.loop).toBe(10);
    });

    it("should parse --yolo flag", () => {
      const result = parseCliArgs(["--yolo"]);
      expect(result.yolo).toBe(true);
    });

    it("should parse --dry-run flag", () => {
      const result = parseCliArgs(["--dry-run"]);
      expect(result.dryRun).toBe(true);
    });

    it("should parse positional task", () => {
      const result = parseCliArgs(["fix", "the", "bug"]);
      expect(result.task).toBe("fix the bug");
    });

    it("should parse -c command flag", () => {
      const result = parseCliArgs(["-c", "fix the bug"]);
      expect(result.task).toBe("fix the bug");
    });

    it("should parse --help flag", () => {
      const result = parseCliArgs(["--help"]);
      expect(result.help).toBe(true);
    });

    it("should parse --version flag", () => {
      const result = parseCliArgs(["--version"]);
      expect(result.version).toBe(true);
    });

    it("should parse --init flag", () => {
      const result = parseCliArgs(["--init"]);
      expect(result.init).toBe(true);
    });

    it("should parse --verbose flag", () => {
      const result = parseCliArgs(["--verbose"]);
      expect(result.verbose).toBe(true);
    });

    it("should parse --config path", () => {
      const result = parseCliArgs(["--config", "custom.json"]);
      expect(result.configPath).toBe("custom.json");
    });

    it("should handle combined flags", () => {
      const result = parseCliArgs([
        "--plan",
        "--loop",
        "5",
        "--yolo",
        "--verbose",
        "implement feature",
      ]);
      expect(result.mode).toBe("plan");
      expect(result.loop).toBe(5);
      expect(result.yolo).toBe(true);
      expect(result.verbose).toBe(true);
      expect(result.task).toBe("implement feature");
    });
  });

  describe("loadConfig", () => {
    const testDir = path.join(os.tmpdir(), "gora-test-config");
    const testConfigPath = path.join(testDir, "gora.config.json");

    beforeEach(() => {
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
    });

    it("should return default config when file does not exist", () => {
      const config = loadConfig(path.join(testDir, "nonexistent.json"));
      expect(config.version).toBe("1.0");
      expect(config.models.main.model).toBe("claude-sonnet-4-20250514");
      expect(config.feedbackLoops.typescript).toBe(true);
    });

    it("should load and merge user config with defaults", () => {
      const userConfig = {
        models: {
          main: {
            model: "gpt-5.2-codex",
            provider: "openai",
          },
        },
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(userConfig));

      const config = loadConfig(testConfigPath);
      expect(config.models.main.model).toBe("gpt-5.2-codex");
      expect(config.models.main.provider).toBe("openai");
      // Should still have defaults for unspecified fields
      expect(config.models.oracle.model).toBe("o3-mini");
      expect(config.feedbackLoops.typescript).toBe(true);
    });
  });

  describe("loadPromptFile", () => {
    const originalCwd = process.cwd();
    const testDir = path.join(os.tmpdir(), "gora-test-prompts");

    beforeEach(() => {
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      process.chdir(testDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(path.join(testDir, "PROMPT_build.md"))) {
        fs.unlinkSync(path.join(testDir, "PROMPT_build.md"));
      }
      if (fs.existsSync(path.join(testDir, "PROMPT_plan.md"))) {
        fs.unlinkSync(path.join(testDir, "PROMPT_plan.md"));
      }
    });

    it("should load PROMPT_build.md in build mode", () => {
      fs.writeFileSync(
        path.join(testDir, "PROMPT_build.md"),
        "Build instructions here",
      );
      const content = loadPromptFile("build");
      expect(content).toBe("Build instructions here");
    });

    it("should load PROMPT_plan.md in plan mode", () => {
      fs.writeFileSync(
        path.join(testDir, "PROMPT_plan.md"),
        "Plan instructions here",
      );
      const content = loadPromptFile("plan");
      expect(content).toBe("Plan instructions here");
    });

    it("should return null when file does not exist", () => {
      const content = loadPromptFile("build");
      expect(content).toBeNull();
    });
  });

  describe("buildSystemContext", () => {
    const originalCwd = process.cwd();
    const testDir = path.join(os.tmpdir(), "gora-test-context");

    beforeEach(() => {
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      process.chdir(testDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      const files = [
        "PROMPT_build.md",
        "PROMPT_plan.md",
        "AGENTS.md",
        "IMPLEMENTATION_PLAN.md",
      ];
      for (const file of files) {
        const filePath = path.join(testDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });

    it("should return default message when no files exist", () => {
      const context = buildSystemContext("build");
      expect(context).toContain("BUILD");
      expect(context).toContain("gora --init");
    });

    it("should include prompt file in context", () => {
      fs.writeFileSync(
        path.join(testDir, "PROMPT_build.md"),
        "Build mode active",
      );
      const context = buildSystemContext("build");
      expect(context).toContain("Build mode active");
      expect(context).toContain("Current Mode: BUILD");
    });

    it("should include AGENTS.md in context", () => {
      fs.writeFileSync(
        path.join(testDir, "PROMPT_build.md"),
        "Build instructions",
      );
      fs.writeFileSync(
        path.join(testDir, "AGENTS.md"),
        "Operational guide here",
      );
      const context = buildSystemContext("build");
      expect(context).toContain("Operational guide here");
      expect(context).toContain("Operational Guide");
    });

    it("should include IMPLEMENTATION_PLAN.md in context", () => {
      fs.writeFileSync(
        path.join(testDir, "PROMPT_build.md"),
        "Build instructions",
      );
      fs.writeFileSync(
        path.join(testDir, "IMPLEMENTATION_PLAN.md"),
        "- Task 1\n- Task 2",
      );
      const context = buildSystemContext("build");
      expect(context).toContain("Task 1");
      expect(context).toContain("Implementation Plan");
    });
  });
});
