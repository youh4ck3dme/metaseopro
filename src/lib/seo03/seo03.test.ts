import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DATA_ROWS,
  MAX_FILE_BYTES,
  Seo03Error,
  assertFileSize,
  detectDelimiter,
  parseCsv,
  parseNumber,
} from "./csv";
import {
  dominantHost,
  joinPeriods,
  localizePeriodLabel,
  normalizePageKey,
  parseCompareExport,
  parseExportFile,
  parseTwoPeriodExports,
  type PeriodMetrics,
} from "./gsc-export";
import {
  TIME_SAVED_MINUTES,
  buildHint,
  buildReportCsv,
  computeLosses,
  sanitizeCell,
} from "./analysis";
import { SAMPLE_PERIOD_A_CSV, SAMPLE_PERIOD_B_CSV } from "./sample";
import { createSlotStore } from "./slots";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "__fixtures__", name), "utf8");

function caught(fn: () => unknown): Seo03Error | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof Seo03Error) return e;
    throw e;
  }
  return undefined;
}
const errorCode = (fn: () => unknown) => caught(fn)?.code;

const m = (
  clicks: number,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): PeriodMetrics => ({ clicks, impressions, ctr, position });

describe("seo03 csv tokenizer", () => {
  it("handles quotes, escaped quotes, embedded delimiters/newlines, CRLF and BOM", () => {
    const rows = parseCsv('\uFEFFa,b,c\r\n"x, y","he said ""hi""","multi\nline"\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'he said "hi"', "multi\nline"],
    ]);
  });

  it("detects comma, semicolon and tab delimiters from the first line", () => {
    expect(detectDelimiter("a,b,c\n1;2;3;4;5")).toBe(",");
    expect(detectDelimiter('"a,b";c;d\n')).toBe(";");
    expect(detectDelimiter("a\tb\tc\n")).toBe("\t");
  });

  it("rejects an unterminated quote", () => {
    expect(errorCode(() => parseCsv('a,b\n"open,1\n'))).toBe("UNTERMINATED_QUOTE");
  });

  it("enforces the row limit (50 000 per file, header excluded)", () => {
    expect(MAX_DATA_ROWS).toBe(50_000);
    const ok = "h\n" + "1\n".repeat(5);
    expect(parseCsv(ok, { maxRows: 5 })).toHaveLength(6);
    expect(errorCode(() => parseCsv(ok + "1\n", { maxRows: 5 }))).toBe("TOO_MANY_ROWS");
    const big = "Page,Clicks\n" + "https://x.example/p,1\n".repeat(MAX_DATA_ROWS + 1);
    expect(errorCode(() => parseExportFile(big))).toBe("TOO_MANY_ROWS");
  });

  it("enforces the 5 MB size limit before reading and reports the measured size", () => {
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(() => assertFileSize(MAX_FILE_BYTES)).not.toThrow();
    const err = caught(() => assertFileSize(7.2 * 1024 * 1024));
    expect(err?.code).toBe("FILE_TOO_LARGE");
    expect(err?.message).toContain("7,2 MB");
    expect(err?.message).toContain("Maximum je 5 MB");
    expect(err?.details.bytes).toBe(7.2 * 1024 * 1024);
  });

  it("parses EN and SK number formats", () => {
    expect(parseNumber("1,234", true)).toBe(1234);
    expect(parseNumber("1 234", true)).toBe(1234);
    expect(parseNumber("1\u00a0234\u00a0567", true)).toBe(1234567);
    expect(parseNumber("4,49 %", false)).toBe(4.49);
    expect(parseNumber("4.49%", false)).toBe(4.49);
    expect(parseNumber("1.234,5", false)).toBe(1234.5);
    expect(parseNumber("nie-cislo", true)).toBeNull();
    expect(parseNumber("", true)).toBeNull();
  });
});

describe("seo03 column mapping and fixtures (UX spec §3, §4)", () => {
  it("skips the GSC preamble and reads period dates from it", () => {
    const file = parseExportFile(SAMPLE_PERIOD_A_CSV);
    expect(file.kind).toBe("single");
    if (file.kind !== "single") return;
    expect(file.data.label).toBe("26. 5. 2026 – 23. 8. 2026");
    expect(file.data.pages.size).toBe(10);
    expect(file.data.skippedEmpty).toBe(1);
  });

  it("sample data in the app matches the spec fixtures byte for byte", () => {
    expect(SAMPLE_PERIOD_A_CSV).toBe(fixture("sample-period-a.csv"));
    expect(SAMPLE_PERIOD_B_CSV).toBe(fixture("sample-period-b.csv"));
  });

  it("joins two periods by normalized URL; 11 unique pages", () => {
    const parsed = parseTwoPeriodExports(SAMPLE_PERIOD_A_CSV, SAMPLE_PERIOD_B_CSV);
    expect(parsed.rows).toHaveLength(11);
    expect(parsed.periodLabels).toEqual({
      previous: "26. 5. 2026 – 23. 8. 2026",
      current: "24. 8. 2026 – 21. 11. 2026",
    });
    const sale = parsed.rows.find((r) => r.page.endsWith("/akcie/letny-vypredaj"))!;
    expect(sale.missingIn).toBe("current");
    expect(sale.current).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null });
    const bf = parsed.rows.find((r) => r.page.endsWith("/akcie/cierny-piatok"))!;
    expect(bf.missingIn).toBe("previous");
    expect(dominantHost(parsed.rows)).toBe("eshop-priklad.sk");
  });

  it("top 3 from the sample matches the spec table", () => {
    const summary = computeLosses(parseTwoPeriodExports(SAMPLE_PERIOD_A_CSV, SAMPLE_PERIOD_B_CSV));
    expect(
      summary.top.map((p) => [new URL(p.page).pathname, p.clickLoss, p.lossPct?.toFixed(3)]),
    ).toEqual([
      ["/produkty/bezdratove-sluchadla", 860, "0.467"],
      ["/kategoria/smartfony", 790, "0.357"],
      ["/akcie/letny-vypredaj", 710, "1.000"],
    ]);
    expect(summary.top[0].previous).toMatchObject({
      clicks: 1840,
      impressions: 62400,
      position: 6.2,
    });
    expect(summary.top[0].previous.ctr).toBeCloseTo(0.0295, 6);
    expect(summary.top[0].current).toMatchObject({
      clicks: 980,
      impressions: 61200,
      position: 6.5,
    });
    expect(summary.top[0].current.ctr).toBeCloseTo(0.016, 6);
    expect(summary.top.map((p) => p.hint.kind)).toEqual(["title_meta", "content", "missing"]);
    expect(summary.top[2].hint.detail).toContain("/akcie/cierny-piatok");
    expect(summary.topClickLoss).toBe(2360);
    expect(summary.pagesTotal).toBe(11);
    expect(TIME_SAVED_MINUTES).toBe(43.5);
  });

  it("reads a single file with Clicks_A / Clicks_B pairs", () => {
    const parsed = parseCompareExport(fixture("combined-two-periods.csv"));
    expect(parsed.periodLabels).toEqual({ previous: "Obdobie A", current: "Obdobie B" });
    const top = computeLosses(parsed).top;
    expect(top.map((p) => p.clickLoss)).toEqual([860, 790, 430]);
    expect(top[2].hint.kind).toBe("content_and_title");
    expect(top[0].previous.position).toBe(6.2);
    expect(top[0].current.position).toBe(6.5);
  });

  it.each([
    ["Clicks (period 1)", "Clicks (period 2)"],
    ["Kliky (obdobie A)", "Kliky (obdobie B)"],
    ["Clicks Previous", "Clicks Current"],
    ["Previous 3 months Clicks", "Last 3 months Clicks"],
  ])("maps paired headers %s / %s to A / B", (a, b) => {
    const parsed = parseCompareExport(`Stránka,${b},${a}\nhttps://x.example/p,10,30\n`);
    expect(parsed.rows[0].previous.clicks).toBe(30);
    expect(parsed.rows[0].current.clicks).toBe(10);
  });

  it("parses a SK semicolon compare export and counts broken, empty and duplicate rows", () => {
    const parsed = parseCompareExport(fixture("sk-compare-broken.csv"));
    expect(parsed.rows.map((r) => r.page)).toEqual([
      "https://obchod.example/a",
      "https://obchod.example/b?x=1;y=2",
    ]);
    expect(parsed.skippedEmpty).toBe(2);
    expect(parsed.skippedInvalid).toBe(3);
    expect(parsed.skippedDuplicate).toBe(1);
    expect(parsed.rows[0].previous).toEqual(m(1840, 41000, 0.0449, 3.1));
    expect(parsed.periodLabels).toEqual({
      previous: "Predchádzajúce 3 mesiace",
      current: "Posledné 3 mesiace",
    });
  });

  it("skips empty and non-numeric rows (empty-and-invalid-rows.csv)", () => {
    const file = parseExportFile(fixture("empty-and-invalid-rows.csv"));
    expect(file.kind).toBe("single");
    if (file.kind !== "single") return;
    expect([...file.data.pages.values()].map((p) => p.page)).toEqual([
      "https://eshop-priklad.sk/produkty/bezdratove-sluchadla",
    ]);
    expect(file.data.skippedEmpty).toBe(2);
    expect(file.data.skippedInvalid).toBe(3);
  });

  it("names the missing columns, lists found ones and spots a queries export", () => {
    const err = caught(() => parseExportFile(fixture("broken-missing-columns.csv")));
    expect(err?.code).toBe("WRONG_FORMAT");
    expect(err?.details.missing).toEqual(["page", "clicks"]);
    expect(err?.details.found).toEqual(["Query", "Impressions", "CTR", "Position"]);
    expect(err?.details.looksLikeQueries).toBe(true);
    expect(err?.message).toContain("Page (alebo URL / Stránka)");
    expect(err?.message).toContain("Clicks (alebo Kliky / Kliknutia)");
    const onlyClicks = caught(() => parseExportFile("Page,Impressions\nhttps://x.example,5\n"));
    expect(onlyClicks?.details.missing).toEqual(["clicks"]);
  });

  it.each([
    ["empty.csv", "EMPTY_FILE"],
    ["header-only.csv", "EMPTY_FILE"],
  ])("rejects %s with %s", (name, code) => {
    expect(errorCode(() => parseCompareExport(fixture(name)))).toBe(code);
  });

  it("asks for the second period when a compare file is expected", () => {
    expect(errorCode(() => parseCompareExport(fixture("single-current.csv")))).toBe(
      "SINGLE_PERIOD",
    );
  });

  it("rejects a file where every data row is broken", () => {
    const text = "Page,Clicks_A,Clicks_B\n,1,2\nx,a,b\n";
    expect(errorCode(() => parseCompareExport(text))).toBe("NO_VALID_ROWS");
  });

  it("rejects binary content", () => {
    expect(errorCode(() => parseCompareExport("PK\u0003\u0004\u0000\u0000"))).toBe("NOT_TEXT");
  });

  it("normalizes URLs for pairing", () => {
    expect(normalizePageKey("https://ESHOP-priklad.sk/Kat/?utm_source=x&a=1#top")).toBe(
      "https://eshop-priklad.sk/Kat?a=1",
    );
    expect(normalizePageKey("https://eshop-priklad.sk/")).toBe("https://eshop-priklad.sk/");
    expect(normalizePageKey("/kategoria/")).toBe("/kategoria");
    const parsed = parseTwoPeriodExports(
      "Page,Clicks\nhttps://X.example/a/,10\n",
      "Page,Clicks\nhttps://x.example/a?utm_medium=y,4\n",
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].page).toBe("https://X.example/a/");
  });

  it("joins the single-period fixtures with broken and empty rows", () => {
    const parsed = parseTwoPeriodExports(
      fixture("single-previous.csv"),
      fixture("single-current.csv"),
    );
    const byPage = Object.fromEntries(parsed.rows.map((r) => [r.page, r]));
    expect(byPage["https://obchod.example/a"].previous.clicks).toBe(160);
    expect(byPage["https://obchod.example/a"].current.clicks).toBe(100);
    expect(byPage["https://obchod.example/b"].previous.clicks).toBe(0);
    expect(byPage["https://obchod.example/c"].current.clicks).toBe(0);
    expect(parsed.skippedEmpty).toBe(1);
    expect(parsed.skippedInvalid).toBe(1);
  });

  it("localizes EN period labels to Slovak", () => {
    expect(localizePeriodLabel("Last 28 days")).toBe("Posledné 28 dní");
    expect(localizePeriodLabel("Previous 6 months")).toBe("Predchádzajúce 6 mesiacov");
    expect(localizePeriodLabel("2026-08-01 - 2026-08-28")).toBe("2026-08-01 - 2026-08-28");
  });
});

describe("seo03 loss computation and brief rules", () => {
  it("finds no losses when every page stagnates or grows (state 4)", () => {
    const parsed = parseTwoPeriodExports(
      fixture("no-click-loss-period-a.csv"),
      fixture("no-click-loss-period-b.csv"),
    );
    const summary = computeLosses(parsed);
    expect(summary.top).toHaveLength(0);
    expect(summary.pagesTotal).toBe(2);
  });

  it("returns fewer than 3 when fewer pages lost clicks", () => {
    const rows = [
      { page: "a", previous: m(10, null, null, null), current: m(20, null, null, null) },
      { page: "b", previous: m(10, null, null, null), current: m(4, null, null, null) },
    ];
    const s = computeLosses({ rows });
    expect(s.top).toHaveLength(1);
    expect(s.top[0].rank).toBe(1);
  });

  it("breaks ties by % loss, then by clicks in A", () => {
    const rows = [
      { page: "x", previous: m(200, null, null, null), current: m(100, null, null, null) },
      { page: "y", previous: m(100, null, null, null), current: m(0, null, null, null) },
    ];
    expect(computeLosses({ rows }).top.map((p) => p.page)).toEqual(["y", "x"]);
  });

  it("applies each brief rule", () => {
    const hint = (prev: PeriodMetrics, cur: PeriodMetrics) =>
      buildHint({ page: "https://x.example/p", previous: prev, current: cur }).kind;
    expect(hint(m(100, 5000, 0.02, 5), m(50, 5000, 0.01, 5.5))).toBe("title_meta");
    expect(hint(m(100, 5000, 0.02, 4), m(50, 2600, 0.0195, 7))).toBe("content");
    expect(hint(m(100, 5000, 0.02, 4), m(50, 5000, 0.01, 5.5))).toBe("content_and_title");
    expect(hint(m(100, 5000, 0.02, 4), m(50, 2500, 0.02, 4.2))).toBe("demand");
    expect(hint(m(100, 5000, 0.02, 4), m(0, 0, null, null))).toBe("missing");
    // 0 clicks without an impressions column is not proof the page dropped out.
    expect(hint(m(40, null, null, null), m(0, null, null, null))).toBe("manual");
  });
});

describe("seo03 report export (formula injection, spec §6.4)", () => {
  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx", "=CMD|'/C'"])(
    "neutralizes text cell %j",
    (v) => {
      expect(sanitizeCell(v)).toBe(`'${v}`);
    },
  );

  it("leaves safe text unchanged", () => {
    expect(sanitizeCell("https://eshop-priklad.sk/")).toBe("https://eshop-priklad.sk/");
  });

  it.each([
    ["zero-width space", "\u200B=1+1"],
    ["zero-width joiner", "\u200D+cmd"],
    ["RTL mark", "\u200F-2+3"],
    ["RTL override", "\u202E@SUM(A1)"],
    ["LTR embedding", "\u202A=1"],
    ["isolate", "\u2066=1"],
    ["pop isolate", "\u2069=1"],
    ["BOM", "\uFEFF=1"],
    ["several invisibles", "\u200B\u2067\uFEFF=1"],
  ])("neutralizes a formula hidden behind a leading %s", (_, v) => {
    expect(sanitizeCell(v)).toBe(`'${v}`);
  });

  it.each(["\uFF1D1+1", "\uFF0Bcmd", "\uFF0D2+3", "\uFF20SUM(A1)", "\u200B\uFF1D1"])(
    "neutralizes fullwidth formula start %j",
    (v) => {
      expect(sanitizeCell(v)).toBe(`'${v}`);
    },
  );

  it("leaves safe text behind invisible characters unchanged", () => {
    expect(sanitizeCell("\u200Bhttps://eshop-priklad.sk/")).toBe("\u200Bhttps://eshop-priklad.sk/");
    expect(sanitizeCell("a=b")).toBe("a=b");
  });

  it("escapes zero-width, bidi and fullwidth formula cells from a CSV fixture", () => {
    const csv = buildReportCsv(
      computeLosses(parseCompareExport(fixture("injection-unicode.csv")), 10),
    );
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(9);
    const pages = lines.slice(1).map((line) => parseCsv(line, { delimiter: ";" })[0][1]);
    const hostile = pages.filter((p) => !p.includes("eshop-priklad.sk/ok"));
    expect(hostile).toHaveLength(7);
    for (const page of hostile) expect(page.startsWith("'")).toBe(true);
    expect(pages).toContain("\u200Bhttps://eshop-priklad.sk/ok");
    expect(pages).toContain("'\uFF1D1+1");
    expect(pages).toContain("'\u202E+cmd");
  });

  it.each([
    ["U+2060 word joiner", '\u2060=HYPERLINK("http://evil.example")'],
    ["U+00AD soft hyphen", "\u00AD=1+1"],
    ["U+061C Arabic letter mark", "\u061C=1+1"],
    ["U+2061 function application", "\u2061=1+1"],
    ["U+2062 invisible times", "\u2062+cmd"],
    ["U+180E Mongolian vowel separator", "\u180E-2+3"],
    ["U+034F combining grapheme joiner", "\u034F@SUM(A1)"],
    ["Hangul fillers", "\u115F\u1160\u3164\uFFA0=1"],
    ["control character", "\u0007=1"],
    ["spaces + U+2060 + fullwidth =", "   \u2060\uFF1D1+1"],
    ["NBSP + ideographic space", "\u00A0\u3000=1"],
    ["U+2060 + spaces + fullwidth =", "\u2060 \u00A0\uFF1D2+2"],
    ["leading newline", "\nx"],
  ])("neutralizes a formula behind a leading %s", (_, v) => {
    expect(sanitizeCell(v)).toBe(`'${v}`);
  });

  it.each([
    ["small plus U+FE62", "\uFE62cmd"],
    ["small hyphen-minus U+FE63", "\uFE632+3"],
    ["small equals U+FE66", "\uFE66SUM(A1)"],
    ["small commercial at U+FE6B", "\uFE6BSUM(A1)"],
    ["superscript equals U+207C", "\u207C1+1"],
    ["fullwidth behind U+2060", "\u2060\uFF20SUM(A1)"],
  ])("neutralizes NFKC formula start: %s", (_, v) => {
    expect(sanitizeCell(v)).toBe(`'${v}`);
  });

  it.each([
    "https://eshop-priklad.sk/kategória/čučoriedky-žltá-ľan",
    "\u2060https://eshop-priklad.sk/ok",
    "  Ťažké ľadové údolie",
    "\u00ADa=b",
    "",
    "\u2060",
  ])("leaves benign text %j unchanged", (v) => {
    expect(sanitizeCell(v)).toBe(v);
  });

  it("escapes every hidden formula from injection-invisible.csv and keeps numbers numeric", () => {
    const csv = buildReportCsv(
      computeLosses(parseCompareExport(fixture("injection-invisible.csv")), 20),
    );
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(12);
    const rows = lines.slice(1).map((line) => parseCsv(line, { delimiter: ";" })[0]);
    const pages = rows.map((cells) => cells[1]);
    const benign = "https://eshop-priklad.sk/kategória/čučoriedky-žltá-ľan";
    expect(pages).toContain(benign);
    const hostile = pages.filter((p) => p !== benign);
    expect(hostile).toHaveLength(10);
    for (const page of hostile) expect(page.startsWith("'")).toBe(true);
    expect(pages).toEqual(
      expect.arrayContaining([
        '\'\u2060=HYPERLINK("http://evil.example")',
        "'\u00AD=1+1",
        "'\u061C=1+1",
        "'\u2061=1+1",
        // Parsing trims plain leading spaces; U+2060 and the fullwidth = stay and are escaped.
        "'\u2060\uFF1D1+1",
        "'\u2060 \u00A0\uFF1D2+2",
        "'\u034F\u3164\uFE62cmd",
        "'\uFE632+3",
        "'\uFE66SUM(A1)",
        "'\uFE6BSUM(A1)",
      ]),
    );
    for (const cells of rows) {
      expect(cells[2]).toMatch(/^\d+$/);
      expect(cells[4]).toMatch(/^-\d+$/);
      expect(cells[5]).toBe("-100,0");
    }
  });

  it("escapes hostile page cells but keeps negative numbers numeric", () => {
    const csv = buildReportCsv(computeLosses(parseCompareExport(fixture("injection.csv")), 5));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(6);
    for (const line of lines.slice(1)) {
      const cells = parseCsv(line, { delimiter: ";" })[0];
      for (const cell of cells) {
        const isNumber = /^-?\d+(,\d+)?$/.test(cell);
        if (!isNumber) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
      }
      expect(cells[4]).toMatch(/^-\d+$/);
    }
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'@SUM(A1)");
  });

  it("writes the sample report with numeric deltas", () => {
    const csv = buildReportCsv(
      computeLosses(parseTwoPeriodExports(SAMPLE_PERIOD_A_CSV, SAMPLE_PERIOD_B_CSV)),
    );
    const row1 = parseCsv(csv.slice(1).split("\r\n")[1], { delimiter: ";" })[0];
    expect(row1.slice(0, 6)).toEqual([
      "1",
      "https://eshop-priklad.sk/produkty/bezdratove-sluchadla",
      "1840",
      "980",
      "-860",
      "-46,7",
    ]);
  });

  it("quotes cells containing the delimiter", () => {
    const csv = buildReportCsv(computeLosses(parseCompareExport(fixture("sk-compare-broken.csv"))));
    expect(csv).toContain('"https://obchod.example/b?x=1;y=2"');
  });
});

describe("seo03 privacy: uploaded CSV is never stored, sent or logged", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs parse, analysis and export without touching network, storage, cookies or console", () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    const beaconSpy = vi.fn();
    const localSet = vi.fn();
    const sessionSet = vi.fn();
    const idbOpen = vi.fn();
    const cookieSet = vi.fn();
    const fakeDocument = {};
    Object.defineProperty(fakeDocument, "cookie", { get: () => "", set: cookieSet });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhrSpy);
    vi.stubGlobal("navigator", { sendBeacon: beaconSpy });
    vi.stubGlobal("localStorage", { setItem: localSet, getItem: vi.fn() });
    vi.stubGlobal("sessionStorage", { setItem: sessionSet, getItem: vi.fn() });
    vi.stubGlobal("indexedDB", { open: idbOpen });
    vi.stubGlobal("document", fakeDocument);
    const consoleSpies = (["log", "info", "warn", "error", "debug", "trace", "table"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );

    // Happy path: two single-period uploads joined, then compare export, then report.
    const store = createSlotStore<ReturnType<typeof parseExportFile>>();
    store.put("a", parseExportFile(fixture("sample-period-a.csv")));
    const put = store.put("b", parseExportFile(fixture("sample-period-b.csv")));
    expect(put.complete).toBe(true);
    if (!put.complete || put.a.kind !== "single" || put.b.kind !== "single") throw new Error();
    const joined = joinPeriods(put.a.data, put.b.data);
    const summary = computeLosses(joined);
    expect(summary.top).toHaveLength(3);
    dominantHost(joined.rows);
    buildReportCsv(summary);
    buildReportCsv(computeLosses(parseCompareExport(fixture("combined-two-periods.csv"))));
    buildReportCsv(computeLosses(parseCompareExport(fixture("injection-unicode.csv"))));
    // Error paths must stay silent too.
    expect(caught(() => parseExportFile(fixture("broken-missing-columns.csv")))).toBeDefined();
    expect(caught(() => assertFileSize(MAX_FILE_BYTES + 1))).toBeDefined();

    for (const spy of [fetchSpy, xhrSpy, beaconSpy, localSet, sessionSet, idbOpen, cookieSet]) {
      expect(spy).not.toHaveBeenCalled();
    }
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  const sources = [
    ...readdirSync(here)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(here, f)),
    join(here, "..", "..", "components", "Seo03Demo.tsx"),
    join(here, "..", "..", "routes", "demo.seo-03.tsx"),
  ];

  it.each(sources)("%s has no storage, network or console calls", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    expect(src).not.toMatch(/\bconsole\.|fetch\(|XMLHttpRequest|sendBeacon|supabase/);
  });
});

describe("seo03 period A/B slots (concurrent uploads)", () => {
  const parseLater = (csv: string, ms: number) =>
    new Promise<ReturnType<typeof parseExportFile>>((resolve) =>
      setTimeout(() => resolve(parseExportFile(csv)), ms),
    );

  it("keeps both files when A and B finish parsing almost at once", async () => {
    const store = createSlotStore<ReturnType<typeof parseExportFile>>();
    const results = await Promise.all([
      parseLater(SAMPLE_PERIOD_A_CSV, 5).then((a) => store.put("a", a)),
      parseLater(SAMPLE_PERIOD_B_CSV, 0).then((b) => store.put("b", b)),
    ]);
    const done = results.filter((r) => r.complete);
    expect(done).toHaveLength(1);
    expect(results[1]).toEqual({ complete: false, slots: { b: expect.anything() } });
    // Store is emptied once both periods were handed over.
    expect(store.get()).toEqual({});
  });

  it("replaces a slot that is uploaded again and clears on reset", () => {
    const store = createSlotStore<string>();
    expect(store.put("a", "first")).toEqual({ complete: false, slots: { a: "first" } });
    expect(store.put("a", "second")).toEqual({ complete: false, slots: { a: "second" } });
    store.clear();
    expect(store.put("b", "b")).toEqual({ complete: false, slots: { b: "b" } });
    expect(store.put("a", "a")).toEqual({ complete: true, a: "a", b: "b" });
  });
});
