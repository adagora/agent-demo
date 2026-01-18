import { describe, it, expect } from "vitest";
import {
  readFile,
  listFiles,
  editFile,
  truncateOutput,
} from "./tool-implementations.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Tool Implementations", () => {
  describe("truncateOutput", () => {
    it("should not truncate short text", () => {
      const text = "Hello, World!";
      expect(truncateOutput(text, 100)).toBe(text);
    });

    it("should truncate long text", () => {
      const text = "a".repeat(1000);
      const result = truncateOutput(text, 50);
      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain("TRUNCATED");
    });
  });

  describe("readFile", () => {
    it("should read existing file", () => {
      const testFile = path.join(os.tmpdir(), "test-read.txt");
      fs.writeFileSync(testFile, "test content");

      const result = readFile(testFile);
      expect(result).toBe("test content");

      fs.unlinkSync(testFile);
    });

    it("should return error for non-existent file", () => {
      const result = readFile("/non/existent/file.txt");
      expect(result).toContain("Error");
    });
  });

  describe("listFiles", () => {
    it("should list files in directory", () => {
      const result = listFiles(".");
      expect(result).toBeTruthy();
      expect(result).not.toBe("No files found");
    });
  });

  describe("editFile", () => {
    it("should create new file when old_str is empty", () => {
      const testFile = path.join(os.tmpdir(), "test-create.txt");

      // Ensure file doesn't exist
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }

      const result = editFile(testFile, "", "new content");
      expect(result).toContain("Created");
      expect(fs.readFileSync(testFile, "utf-8")).toBe("new content");

      fs.unlinkSync(testFile);
    });

    it("should replace content in existing file", () => {
      const testFile = path.join(os.tmpdir(), "test-edit.txt");
      fs.writeFileSync(testFile, "hello world");

      const result = editFile(testFile, "world", "TypeScript");
      expect(result).toContain("Successfully");
      expect(fs.readFileSync(testFile, "utf-8")).toBe("hello TypeScript");

      fs.unlinkSync(testFile);
    });
  });
});
