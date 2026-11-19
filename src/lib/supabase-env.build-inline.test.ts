// Vitest aliases import.meta.env to process.env, so the build-time (third) step
// cannot be told apart from the runtime steps in a normal unit test. Here we run
// a real Vite build of supabase-env.server.ts against a throw-away env dir that
// holds only fake public values, then execute the bundle with process.env empty.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "vite";

const ENTRY = resolve(__dirname, "supabase-env.server.ts");
const KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

type Mod = {
  getServerSupabaseUrl: () => string | undefined;
  getServerSupabasePublishableKey: () => string | undefined;
};

let dir: string;

async function bundle(envFile: string | null): Promise<Mod> {
  // Vite lets real process.env VITE_* override .env files, so unset them for the build.
  for (const k of KEYS) vi.stubEnv(k, undefined);
  const envDir = mkdtempSync(join(dir, "env-"));
  if (envFile !== null) writeFileSync(join(envDir, ".env"), envFile);
  const out = (await build({
    configFile: false,
    root: dir,
    envDir,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      ssr: ENTRY,
      rollupOptions: { output: { format: "es", entryFileNames: "out.mjs" } },
    },
  })) as unknown as { output: Array<{ type: string; code?: string }> };
  const code = out.output.find((o) => o.type === "chunk")?.code ?? "";
  for (const k of KEYS) vi.stubEnv(k, ""); // runtime env is empty from here on
  const file = join(dir, `bundle-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Mod;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "supabase-env-inline-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("import.meta.env.VITE_SUPABASE_* is inlined by the build (third fallback)", () => {
  it("runtime env empty → value from the build-time .env is used", async () => {
    const mod = await bundle(
      "VITE_SUPABASE_URL=https://build.example.test\nVITE_SUPABASE_PUBLISHABLE_KEY=build-key\n",
    );
    expect(mod.getServerSupabaseUrl()).toBe("https://build.example.test");
    expect(mod.getServerSupabasePublishableKey()).toBe("build-key");
  }, 60_000);

  it("runtime process.env.VITE_* and SUPABASE_* still win over the inlined value", async () => {
    const mod = await bundle(
      "VITE_SUPABASE_URL=https://build.example.test\nVITE_SUPABASE_PUBLISHABLE_KEY=build-key\n",
    );
    vi.stubEnv("VITE_SUPABASE_URL", "https://runtime-vite.example.test");
    expect(mod.getServerSupabaseUrl()).toBe("https://runtime-vite.example.test");
    vi.stubEnv("SUPABASE_URL", "https://runtime-server.example.test");
    expect(mod.getServerSupabaseUrl()).toBe("https://runtime-server.example.test");
  }, 60_000);

  it("no build-time .env and empty runtime env → undefined (fail closed)", async () => {
    const mod = await bundle(null);
    expect(mod.getServerSupabaseUrl()).toBeUndefined();
    expect(mod.getServerSupabasePublishableKey()).toBeUndefined();
  }, 60_000);
});
