import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// Load .env for local runs; CI provides real environment variables.
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], testTimeout: 20000, fileParallelism: false },
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
});
