import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT_DIR = process.cwd();

describe("Architectural & Codebase Integrity Suite", () => {
  it("ensures .env (if present) contains no private secrets", () => {
    const envPath = join(ROOT_DIR, ".env");
    if (!existsSync(envPath)) {
      // No local .env is fine — secrets live in .env.local which is gitignored
      return;
    }

    const envContent = readFileSync(envPath, "utf-8");

    const forbiddenSecrets = [
      "LOVABLE_API_KEY",
      "SEMRUSH_API_KEY",
      "GOOGLE_SEARCH_CONSOLE_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "SUPERFAKTURA_API_KEY",
    ];

    for (const secret of forbiddenSecrets) {
      expect(envContent, `.env must NEVER contain private secret ${secret}`).not.toContain(
        `${secret}=`,
      );
    }
  });

  it("ensures .gitignore protects local overrides and secrets", () => {
    const gitignorePath = join(ROOT_DIR, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const gitignoreContent = readFileSync(gitignorePath, "utf-8");

    expect(gitignoreContent).toContain(".env.local");
    expect(gitignoreContent).toContain("node_modules");
  });

  it("ensures .env.example documents all configuration keys without real secret values", () => {
    const examplePath = join(ROOT_DIR, ".env.example");
    expect(existsSync(examplePath)).toBe(true);
    const exampleContent = readFileSync(examplePath, "utf-8");

    expect(exampleContent).toContain("VITE_SUPABASE_URL");
    expect(exampleContent).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(exampleContent).toContain("SEMRUSH_API_KEY");
  });

  it("ensures all TanStack Start server functions use .validator() and never .inputValidator()", () => {
    function scanDir(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".output") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          files.push(...scanDir(full));
        } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.")) {
          files.push(full);
        }
      }
      return files;
    }

    const srcFiles = scanDir(join(ROOT_DIR, "src"));
    for (const file of srcFiles) {
      const content = readFileSync(file, "utf-8");
      expect(
        content,
        `File ${file} must use .validator() instead of deprecated .inputValidator()`,
      ).not.toContain(".inputValidator(");
    }
  });

  it("ensures no rogue react-router-dom imports exist (strictly @tanstack/react-router)", () => {
    function scanDir(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".output") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          files.push(...scanDir(full));
        } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.")) {
          files.push(full);
        }
      }
      return files;
    }

    const srcFiles = scanDir(join(ROOT_DIR, "src"));
    for (const file of srcFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content, `File ${file} must not import from react-router-dom`).not.toContain(
        'from "react-router-dom"',
      );
      expect(content, `File ${file} must not import from react-router-dom`).not.toContain(
        "from 'react-router-dom'",
      );
    }
  });

  it("ensures all Supabase migrations enforce Row Level Security (RLS)", () => {
    const migrationsDir = join(ROOT_DIR, "supabase", "migrations");
    expect(existsSync(migrationsDir)).toBe(true);

    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      // If a migration creates a table, it must enable RLS
      const tableMatches = [
        ...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi),
      ];
      for (const match of tableMatches) {
        const tableName = match[1];
        const rlsRegex = new RegExp(
          `ALTER\\s+TABLE\\s+(?:public\\.)?${tableName}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          "i",
        );
        expect(
          rlsRegex.test(sql),
          `Migration ${file} creates table '${tableName}' but lacks 'ALTER TABLE ... ENABLE ROW LEVEL SECURITY'`,
        ).toBe(true);
      }
    }
  });
});
