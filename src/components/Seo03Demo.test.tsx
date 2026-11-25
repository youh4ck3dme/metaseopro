/**
 * Component tests for <Seo03Demo /> rendered with React DOM into a minimal
 * in-memory DOM (see seo03-demo.test-dom.ts — no jsdom in this repo):
 *  - late/stale async parses never reset or overwrite a committed view (P3 #2)
 *  - the rendered UI and the CSV download never touch network, storage,
 *    cookies or the console (runtime privacy, P3 #3)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ComponentType, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  TestEvent,
  TestHTMLAnchorElement,
  TestHTMLInputElement,
  TestXMLHttpRequest,
  installTestDom,
  type TestDocument,
  type TestElement,
} from "./seo03-demo.test-dom";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children?: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "seo03",
  "__fixtures__",
);
const fixture = (name: string) => readFileSync(join(fixturesDir, name), "utf8");

const RESULT_HEADING = "Tri stránky s najväčšou stratou kliknutí";

let dom: { document: TestDocument; uninstall: () => void };
let createRoot: (container: TestElement) => Root;
let Seo03Demo: ComponentType;
let root: Root | null = null;
let container: TestElement;

beforeAll(async () => {
  dom = installTestDom();
  // react-dom must load after the DOM exists.
  const client = await import("react-dom/client");
  createRoot = client.createRoot as unknown as (container: TestElement) => Root;
  ({ Seo03Demo } = await import("./Seo03Demo"));
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.parentNode?.removeChild(container);
  vi.restoreAllMocks();
});

afterAll(() => dom.uninstall());

async function mount() {
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const r = createRoot(container);
  root = r;
  await act(async () => r.render(<Seo03Demo />));
}

const text = () => container.textContent;

/** Lets timers (MIN_PROCESSING_MS) and promises run inside act until `check` holds. */
async function waitFor(check: () => boolean, label: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}\n${text()}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
}

/** Settles all pending work for a while without expecting a change. */
async function settle(ms = 900) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function clickButton(label: string) {
  const button = container
    .querySelectorAll("button")
    .find((b) => b.textContent.replace(/\s+/g, " ").trim() === label);
  if (!button) throw new Error(`button "${label}" not found in:\n${text()}`);
  await act(async () => button.click());
}

async function upload(slot: "a" | "b", file: File) {
  const input = container.querySelector(`[data-testid="seo03-file-${slot}"]`);
  if (!(input instanceof TestHTMLInputElement)) throw new Error("file input missing");
  input.files = [file];
  await act(async () => {
    input.dispatchEvent(new TestEvent("change", { bubbles: true }));
  });
}

const csvFile = (name: string, content: string) => new File([content], name, { type: "text/csv" });

/** A File whose `text()` (what the reader awaits) settles only when the test says so. */
function deferredFile(name: string) {
  let resolve!: (content: string) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const file = csvFile(name, "placeholder");
  Object.defineProperty(file, "text", { value: () => pending });
  return { file, resolve, reject };
}

const A = () => csvFile("obdobie-a.csv", fixture("sample-period-a.csv"));
const B = () => csvFile("obdobie-b.csv", fixture("sample-period-b.csv"));

describe("Seo03Demo: late async parses cannot reset or overwrite the view", () => {
  it("shows Top 3 after a normal A + B upload (baseline)", async () => {
    await mount();
    await upload("a", A());
    await waitFor(() => text().includes("obdobie-a.csv"), "slot A loaded");
    await upload("b", B());
    await waitFor(() => text().includes(RESULT_HEADING), "result view");
  });

  it("drops an older slot-A parse that resolves with valid CSV after the join committed", async () => {
    await mount();
    const stale = deferredFile("stare-a.csv");
    await upload("a", stale.file);
    await upload("a", A()); // newer upload to the same slot
    await upload("b", B());
    await waitFor(() => text().includes(RESULT_HEADING), "result view");

    stale.resolve(fixture("single-previous.csv"));
    await settle();

    expect(text()).toContain(RESULT_HEADING);
    expect(text()).not.toContain("stare-a.csv");
    expect(text()).not.toContain("Presuňte CSV sem");
  });

  it("drops an older slot-A parse that resolves with broken CSV after the join committed", async () => {
    await mount();
    const stale = deferredFile("stare-a.csv");
    await upload("a", stale.file);
    await upload("a", A());
    await upload("b", B());
    await waitFor(() => text().includes(RESULT_HEADING), "result view");

    stale.resolve(fixture("broken-missing-columns.csv"));
    await settle();

    expect(text()).toContain(RESULT_HEADING);
    expect(text()).not.toContain("Súbor sa nepodarilo prečítať");
  });

  it("drops an older slot-A read that rejects after the join committed", async () => {
    await mount();
    const stale = deferredFile("stare-a.csv");
    await upload("a", stale.file);
    await upload("a", A());
    await upload("b", B());
    await waitFor(() => text().includes(RESULT_HEADING), "result view");

    stale.reject(new Error("read failed"));
    await settle();

    expect(text()).toContain(RESULT_HEADING);
    expect(text()).not.toContain("Súbor sa nepodarilo prečítať");
  });

  it("keeps the sample result when a pending upload finishes after the sample loaded", async () => {
    await mount();
    const stale = deferredFile("stare-a.csv");
    await upload("a", stale.file);
    await upload("b", B());
    await waitFor(() => text().includes("Použiť ukážkové dáta"), "empty state with slot B");
    await clickButton("Použiť ukážkové dáta");
    await waitFor(() => text().includes(RESULT_HEADING), "sample result");

    stale.resolve(fixture("sample-period-a.csv"));
    await settle();

    expect(text()).toContain(RESULT_HEADING);
    expect(text()).toContain("Ukážkové dáta");
    expect(text()).not.toContain("stare-a.csv");
  });

  it("does not refill a slot or show an error after reset when a pending upload finishes late", async () => {
    await mount();
    const stale = deferredFile("stare-a.csv");
    await upload("a", stale.file);
    await upload("b", csvFile("zly-b.csv", fixture("broken-missing-columns.csv")));
    await waitFor(() => text().includes("Súbor sa nepodarilo prečítať"), "format error");
    await clickButton("Vybrať iný súbor"); // resets, then reopens the picker
    await waitFor(() => text().includes("Presuňte CSV sem"), "empty state");

    stale.resolve(fixture("sample-period-a.csv"));
    await settle();

    expect(text()).toContain("Presuňte CSV sem");
    expect(text()).not.toContain("stare-a.csv");
    expect(text()).not.toContain("Súbor sa nepodarilo prečítať");
  });

  it.each([
    ["B first", ["b", "a"] as const],
    ["A first", ["a", "b"] as const],
  ])("joins concurrent A + B uploads that finish in any order (%s)", async (_, order) => {
    await mount();
    const files = { a: deferredFile("obdobie-a.csv"), b: deferredFile("obdobie-b.csv") };
    await upload("a", files.a.file);
    await upload("b", files.b.file);
    const content = { a: fixture("sample-period-a.csv"), b: fixture("sample-period-b.csv") };
    files[order[0]].resolve(content[order[0]]);
    await settle(700);
    expect(text()).toContain(`obdobie-${order[0]}.csv`);
    files[order[1]].resolve(content[order[1]]);
    await waitFor(() => text().includes(RESULT_HEADING), "joined result");
  });
});

describe("Seo03Demo runtime privacy: UI and CSV download stay in the browser", () => {
  it("never calls network, storage, cookie or console APIs while used", async () => {
    const g = globalThis as unknown as { fetch: typeof fetch };
    const fetchSpy = vi.spyOn(g, "fetch").mockRejectedValue(new Error("network blocked"));
    const xhrOpen = vi.spyOn(TestXMLHttpRequest.prototype, "open");
    const xhrSend = vi.spyOn(TestXMLHttpRequest.prototype, "send");
    const nav = navigator as unknown as { sendBeacon: () => boolean };
    const beacon = vi.spyOn(nav, "sendBeacon");
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    const idb = globalThis.indexedDB as unknown as { open: () => unknown } | undefined;
    const idbOpen = idb ? vi.spyOn(idb, "open") : null;
    const cookieSet = vi.fn();
    Object.defineProperty(dom.document, "cookie", {
      configurable: true,
      get: () => "",
      set: cookieSet,
    });
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );

    const blobs: Blob[] = [];
    const downloads: { href: string; download: string }[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:seo03-test/${blobs.length}`;
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(TestHTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: TestHTMLAnchorElement,
    ) {
      downloads.push({ href: this.href, download: this.download });
    });

    try {
      // Sanity: the spies would see a write if one happened.
      localStorage.setItem("probe", "1");
      sessionStorage.setItem("probe", "1");
      expect(storageSet).toHaveBeenCalledTimes(2);
      storageSet.mockClear();

      await mount();

      // a) sample -> client report -> CSV download
      await clickButton("Použiť ukážkové dáta");
      await waitFor(() => text().includes(RESULT_HEADING), "sample result");
      await clickButton("Otvoriť klientsky report");
      await waitFor(() => text().includes("Stratené kliknutia"), "client report");
      await clickButton("Stiahnuť report (CSV)");
      expect(downloads).toEqual([{ href: "blob:seo03-test/1", download: "seo-03-report.csv" }]);
      expect(revoke).toHaveBeenCalledWith("blob:seo03-test/1");
      const sampleCsv = await blobs[0].text();
      expect(blobs[0].type).toBe("text/csv;charset=utf-8");
      expect(sampleCsv.startsWith("Poradie;")).toBe(true); // BOM is stripped by Blob.text()
      expect(sampleCsv).toContain(
        "1;https://eshop-priklad.sk/produkty/bezdratove-sluchadla;1840;980;-860;-46,7;",
      );

      // b) hostile combined export -> result -> CSV download is sanitized
      await clickButton("Späť na výsledok");
      await clickButton("Nahrať iný export");
      await upload("a", csvFile("injection-invisible.csv", fixture("injection-invisible.csv")));
      await waitFor(() => text().includes("s najväčšou stratou kliknutí"), "injection result");
      await clickButton("Stiahnuť report (CSV)");
      const hostileCsv = await blobs[1].text();
      expect(hostileCsv).toContain(`"'\u2060=HYPERLINK(""http://evil.example"")"`);
      expect(hostileCsv).toContain("'\u00AD=1+1");
      expect(hostileCsv).not.toMatch(/(^|;)[\u2060\u00AD]?=/m);

      // c) real A/B pair with broken and unicode rows, then a format error
      await clickButton("Nahrať iný export");
      await upload("a", csvFile("previous.csv", fixture("single-previous.csv")));
      await upload("b", csvFile("current.csv", fixture("single-current.csv")));
      await waitFor(() => text().includes("s najväčšou stratou kliknutí"), "pair result");
      await clickButton("Nahrať iný export");
      await upload("a", csvFile("zly.csv", fixture("broken-missing-columns.csv")));
      await waitFor(() => text().includes("Súbor sa nepodarilo prečítať"), "format error");

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpen).not.toHaveBeenCalled();
      expect(xhrSend).not.toHaveBeenCalled();
      expect(beacon).not.toHaveBeenCalled();
      expect(storageSet).not.toHaveBeenCalled();
      if (idbOpen) expect(idbOpen).not.toHaveBeenCalled();
      expect(cookieSet).not.toHaveBeenCalled();
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      delete (dom.document as unknown as { cookie?: string }).cookie;
    }
  });
});
