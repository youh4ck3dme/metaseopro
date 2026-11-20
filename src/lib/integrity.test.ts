import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT_DIR = process.cwd();

describe("Architectural & Codebase Integrity Suite", () => {
  it("tracks only a public-only .env (exactly 3 VITE_SUPABASE_* keys, correct host) and no other .env.* files", () => {
    const ALLOWED_ENV_KEYS = [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PROJECT_ID",
    ];
    const FORBIDDEN_PATTERNS = [
      "sb_secret_",
      "service_role",
      "pptkimvmhekrovsltdqv",
      "tlmuvzrgighahnjkxoyw",
    ];

    // Git checks are skipped when .git is missing (exported snapshot) — test must not fail.
    let trackedEnvFiles: string[] = [];
    try {
      trackedEnvFiles = execSync("git ls-files -- .env .env.*", { cwd: ROOT_DIR })
        .toString()
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      trackedEnvFiles = [];
    }
    if (trackedEnvFiles.length > 0) {
      expect(trackedEnvFiles, ".env must be tracked for the Lovable build").toContain(".env");
      for (const f of trackedEnvFiles) {
        expect(
          [".env", ".env.example"].includes(f),
          `tracked env file not allowed (only .env and .env.example): ${f}`,
        ).toBe(true);
      }
    }

    // Content checks only when a local .env exists — test must not fail when it is missing.
    const envPath = join(ROOT_DIR, ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      const keys = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split("=")[0] ?? "");
      for (const key of keys) {
        expect(
          ALLOWED_ENV_KEYS,
          `.env may contain only public VITE_SUPABASE_* keys, found: ${key}`,
        ).toContain(key);
      }
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(content, `.env must never contain: ${pattern}`).not.toContain(pattern);
      }
      const jwt = content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if (jwt) {
        const payload = JSON.parse(
          Buffer.from(jwt[0].split(".")[1]!, "base64url").toString("utf-8"),
        );
        expect(payload.role, "JWT with service_role role is forbidden in .env").not.toBe(
          "service_role",
        );
      }
      const urlLine = content.split("\n").find((l) => l.startsWith("VITE_SUPABASE_URL="));
      if (urlLine) {
        const raw = urlLine.slice("VITE_SUPABASE_URL=".length).replace(/^["']|["']$/g, "");
        expect(new URL(raw).hostname).toBe("pwftbssvdbjoblmhdeax.supabase.co");
      }
    }
  });

  it(".gitignore keeps .env tracked but ignores .env.* variants (except .env.example)", () => {
    const gitignorePath = join(ROOT_DIR, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const gitignoreContent = readFileSync(gitignorePath, "utf-8");

    expect(gitignoreContent).toContain(".env.local");
    expect(gitignoreContent).toContain("node_modules");
    expect(gitignoreContent).not.toMatch(/^\.env$/m); // .env itself must NOT be ignored
    expect(gitignoreContent).toMatch(/^\.env\.\*$/m);
    expect(gitignoreContent).toContain("!.env.example");

    // git-level check only when .git exists; .env must not be ignored.
    let envIgnored = false;
    try {
      execSync("git check-ignore .env", { cwd: ROOT_DIR, stdio: "pipe" });
      envIgnored = true;
    } catch {
      envIgnored = false;
    }
    expect(
      envIgnored,
      ".env must NOT be git-ignored (Lovable reads VITE_* from committed .env)",
    ).toBe(false);
  });

  it("ensures .env.example documents all configuration keys without real secret values", () => {
    const examplePath = join(ROOT_DIR, ".env.example");
    expect(existsSync(examplePath)).toBe(true);
    const exampleContent = readFileSync(examplePath, "utf-8");

    expect(exampleContent).toContain("VITE_SUPABASE_URL");
    expect(exampleContent).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(exampleContent).toContain("SEMRUSH_API_KEY");
    // .env.example must document keys with EMPTY values only (no real secrets/values)
    for (const line of exampleContent.split("\n")) {
      const m = /^(VITE_SUPABASE_[A-Z_]+|SUPABASE_[A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) expect(m[2], `${m[1]} must have an empty value in .env.example`).toBe("");
    }
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
