import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChartNoAxesCombined, Check, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MAX_DATA_ROWS,
  MAX_FILE_BYTES,
  Seo03Error,
  assertFileSize,
  formatMb,
  type Seo03ErrorDetails,
} from "@/lib/seo03/csv";
import {
  describeMissingColumn,
  dominantHost,
  joinPeriods,
  parseExportFile,
  type ParsedExport,
  type SinglePeriodExport,
} from "@/lib/seo03/gsc-export";
import {
  TIME_ASSUMPTION,
  TIME_SAVED_MINUTES,
  buildReportCsv,
  computeLosses,
  type LossSummary,
  type PageLoss,
} from "@/lib/seo03/analysis";
import { createSlotStore, type Slot } from "@/lib/seo03/slots";
import {
  SAMPLE_FILE_NAMES,
  SAMPLE_LABEL,
  SAMPLE_PERIOD_A_CSV,
  SAMPLE_PERIOD_B_CSV,
} from "@/lib/seo03/sample";

type Loaded = { name: string; data: SinglePeriodExport };
type Outcome = { sample: boolean; parsed: ParsedExport; summary: LossSummary; host: string | null };

type View =
  | { phase: "empty" }
  | { phase: "processing"; fileName: string; rows: number | null; progress: number }
  | { phase: "format-error"; fileName: string; message: string; details: Seo03ErrorDetails }
  | { phase: "limit-error"; fileName: string; kind: "size" | "rows"; bytes?: number }
  | { phase: "no-loss"; outcome: Outcome }
  | { phase: "result"; outcome: Outcome }
  | { phase: "report"; outcome: Outcome; generatedAt: Date };

/** Minimum time the processing card stays visible, so the state doesn't flash. */
const MIN_PROCESSING_MS = 600;

const intFmt = new Intl.NumberFormat("sk-SK");
const dec1 = new Intl.NumberFormat("sk-SK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtInt = (n: number | null) => (n === null ? "—" : intFmt.format(Math.round(n)));
const fmtPos = (n: number | null) => (n === null || n === 0 ? "—" : dec1.format(n));
const fmtCtr = (n: number | null) => (n === null ? "—" : `${dec2.format(n * 100)} %`);
const fmtLossPct = (n: number | null) =>
  n === null ? "—" : n >= 1 ? "−100 %" : `−${dec1.format(n * 100)} %`;
const fmtMinutes = (n: number) => `${dec1.format(n).replace(/,0$/, "")} min`;

const FOCUS =
  "min-h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function pathOf(page: string): string {
  try {
    return new URL(page).pathname;
  } catch {
    return page;
  }
}

function readFileWithProgress(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    reader.onerror = () => reject(new Seo03Error("NOT_TEXT", "Súbor sa nepodarilo prečítať."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  });
}

const countLines = (text: string) => {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith("\n") ? n : n + 1;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Seo03Demo() {
  const [view, setView] = useState<View>({ phase: "empty" });
  const [slots, setSlots] = useState<Partial<Record<Slot, Loaded>>>({});
  // Source of truth for A/B; `slots` only mirrors it for rendering.
  const [slotStore] = useState(() => createSlotStore<Loaded>());
  const [lastSlot, setLastSlot] = useState<Slot>("a");
  const inputA = useRef<HTMLInputElement>(null);
  const inputB = useRef<HTMLInputElement>(null);
  // Async guards. `session` changes on reset, on sample load and when a joined
  // or combined result commits; `slotGen` changes on every new upload to a slot.
  // A read/parse that finishes after either changed is stale and is dropped
  // without touching `slotStore`, errors or the view (no late reset/overwrite).
  const session = useRef(0);
  const slotGen = useRef<Record<Slot, number>>({ a: 0, b: 0 });

  const sample =
    view.phase === "no-loss" || view.phase === "result" || view.phase === "report"
      ? view.outcome.sample
      : false;

  const finish = (parsed: ParsedExport, isSample: boolean) => {
    const outcome: Outcome = {
      sample: isSample,
      parsed,
      summary: computeLosses(parsed),
      host: dominantHost(parsed.rows),
    };
    session.current++;
    slotStore.clear();
    setSlots({});
    setView(
      outcome.summary.top.length === 0
        ? { phase: "no-loss", outcome }
        : { phase: "result", outcome },
    );
  };

  const fail = (error: unknown, fileName: string) => {
    if (error instanceof Seo03Error) {
      if (error.code === "FILE_TOO_LARGE") {
        setView({ phase: "limit-error", fileName, kind: "size", bytes: error.details.bytes });
        return;
      }
      if (error.code === "TOO_MANY_ROWS") {
        setView({ phase: "limit-error", fileName, kind: "rows" });
        return;
      }
      setView({ phase: "format-error", fileName, message: error.message, details: error.details });
      return;
    }
    setView({
      phase: "format-error",
      fileName,
      message:
        "Súbor sa nepodarilo spracovať. Skontrolujte, či ide o CSV export zo Search Console.",
      details: {},
    });
  };

  const handleFile = async (slot: Slot, file: File | undefined) => {
    if (!file) return;
    const mySession = session.current;
    const myGen = ++slotGen.current[slot];
    const stale = () => session.current !== mySession || slotGen.current[slot] !== myGen;
    setLastSlot(slot);
    try {
      // Size is checked before anything is read.
      assertFileSize(file.size);
    } catch (error) {
      fail(error, file.name);
      return;
    }
    const started = Date.now();
    setView({ phase: "processing", fileName: file.name, rows: null, progress: 0 });
    try {
      const text = await readFileWithProgress(file, (progress) => {
        if (!stale()) setView((v) => (v.phase === "processing" ? { ...v, progress } : v));
      });
      if (stale()) return;
      setView({ phase: "processing", fileName: file.name, rows: countLines(text), progress: 100 });
      const parsedFile = parseExportFile(text);
      await wait(Math.max(0, MIN_PROCESSING_MS - (Date.now() - started)));
      if (stale()) return;
      if (parsedFile.kind === "compare") {
        if (parsedFile.data.rows.length === 0) {
          throw new Seo03Error(
            "NO_VALID_ROWS",
            "V súbore nie je ani jeden platný riadok (chýba stránka alebo číselná hodnota kliknutí).",
          );
        }
        finish(parsedFile.data, false);
        return;
      }
      const put = slotStore.put(slot, { name: file.name, data: parsedFile.data });
      if (put.complete) {
        finish(joinPeriods(put.a.data, put.b.data), false);
      } else {
        setSlots(put.slots);
        setView({ phase: "empty" });
      }
    } catch (error) {
      if (stale()) return;
      fail(error, file.name);
    }
  };

  const loadSample = async () => {
    const mySession = ++session.current;
    slotStore.clear();
    setSlots({});
    const started = Date.now();
    setView({
      phase: "processing",
      fileName: `${SAMPLE_FILE_NAMES.a} + ${SAMPLE_FILE_NAMES.b}`,
      rows: countLines(SAMPLE_PERIOD_A_CSV) + countLines(SAMPLE_PERIOD_B_CSV),
      progress: 100,
    });
    const a = parseExportFile(SAMPLE_PERIOD_A_CSV);
    const b = parseExportFile(SAMPLE_PERIOD_B_CSV);
    await wait(Math.max(0, MIN_PROCESSING_MS - (Date.now() - started)));
    if (session.current !== mySession) return;
    if (a.kind === "single" && b.kind === "single") finish(joinPeriods(a.data, b.data), true);
  };

  const reset = () => {
    // Drop every reference to the uploaded data and invalidate pending reads.
    session.current++;
    slotStore.clear();
    setSlots({});
    setView({ phase: "empty" });
    if (inputA.current) inputA.current.value = "";
    if (inputB.current) inputB.current.value = "";
  };

  const pickAgain = () => {
    reset();
    (lastSlot === "b" ? inputB : inputA).current?.click();
  };

  const downloadReport = (summary: LossSummary) => {
    const blob = new Blob([buildReportCsv(summary)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seo-03-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileInput = (slot: Slot) => (
    <input
      ref={slot === "a" ? inputA : inputB}
      id={`seo03-file-${slot}`}
      data-testid={`seo03-file-${slot}`}
      type="file"
      accept=".csv,text/csv"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        void handleFile(slot, file);
      }}
    />
  );

  return (
    <div className="flex min-h-screen min-h-dvh flex-col bg-page-bg font-sans text-foreground">
      <header className="border-b border-border print:hidden">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 md:px-6">
          <Link
            to="/"
            className={`flex min-w-0 items-center gap-2 rounded-md ${FOCUS}`}
            aria-label="SEO4WEB — domov"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChartNoAxesCombined className="size-4" aria-hidden />
            </span>
            <span className="font-display text-lg font-semibold max-[359px]:hidden">SEO4WEB</span>
            <span className="truncate text-sm text-muted-foreground">90-sekundová ukážka</span>
          </Link>
          {sample && (
            <div className="max-[479px]:basis-full max-[479px]:pb-1">
              <SampleBadge />
            </div>
          )}
        </div>
      </header>

      {fileInput("a")}
      {fileInput("b")}

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-6 md:pt-8">
        {(view.phase === "empty" ||
          view.phase === "processing" ||
          view.phase === "format-error" ||
          view.phase === "limit-error") && <Intro />}

        {view.phase === "empty" && (
          <EmptyState
            slots={slots}
            onFile={(slot, file) => void handleFile(slot, file)}
            onPick={(slot) => (slot === "a" ? inputA : inputB).current?.click()}
            onSample={() => void loadSample()}
          />
        )}

        {view.phase === "processing" && (
          <>
            <ProcessingCard view={view} />
            <Limits />
          </>
        )}

        {view.phase === "format-error" && (
          <>
            <FormatError view={view} onPick={pickAgain} onSample={() => void loadSample()} />
            <HowTo />
          </>
        )}

        {view.phase === "limit-error" && (
          <>
            <LimitError view={view} onPick={pickAgain} />
            <Limits />
          </>
        )}

        {view.phase === "no-loss" && (
          <NoLoss outcome={view.outcome} onReset={reset} onSample={() => void loadSample()} />
        )}

        {view.phase === "result" && (
          <Result
            outcome={view.outcome}
            onReport={() =>
              setView({ phase: "report", outcome: view.outcome, generatedAt: new Date() })
            }
            onDownload={() => downloadReport(view.outcome.summary)}
            onReset={reset}
          />
        )}

        {view.phase === "report" && (
          <Report
            outcome={view.outcome}
            generatedAt={view.generatedAt}
            onBack={() => setView({ phase: "result", outcome: view.outcome })}
            onDownload={() => downloadReport(view.outcome.summary)}
          />
        )}
      </main>
    </div>
  );
}

function SampleBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-warning-subtle px-3 py-1 text-xs font-semibold text-warning-foreground ring-1 ring-warning-border">
      {SAMPLE_LABEL}
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function Intro() {
  return (
    <div className="mb-6">
      <Eyebrow>SEO-03 · Google Search Console</Eyebrow>
      <h1 className="mb-3 font-display text-3xl leading-tight text-balance md:text-4xl">
        Kde e-shop stráca kliknutia
      </h1>
      <p className="max-w-[60ch] text-base text-pretty text-secondary-foreground">
        Nahrajte anonymizovaný export stránok zo Search Console. Za 90 sekúnd uvidíte tri stránky s
        najväčším poklesom a čo opraviť ako prvé.
      </p>
    </div>
  );
}

/** `withPrivacy` is off on the empty state, where the shield line below says it once. */
function Limits({ withPrivacy = true }: { withPrivacy?: boolean }) {
  return (
    <ul className="mt-5 list-inside list-disc space-y-1 text-sm text-muted-foreground">
      <li>Najviac {formatMb(MAX_FILE_BYTES)} MB na súbor</li>
      <li>Najviac {intFmt.format(MAX_DATA_ROWS)} riadkov</li>
      {withPrivacy && (
        <li>CSV ostáva len v prehliadači — nič sa neodosiela, neukladá ani neloguje</li>
      )}
    </ul>
  );
}

function HowTo() {
  return (
    <details className="group mt-5 rounded-xl bg-card ring-1 ring-border">
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 font-medium ${FOCUS}`}
      >
        <span aria-hidden className="text-primary group-open:hidden">
          +
        </span>
        <span aria-hidden className="hidden text-primary group-open:inline">
          −
        </span>
        Ako získať export zo Search Console
      </summary>
      <ol className="list-inside list-decimal space-y-1 px-4 pb-4 text-sm text-secondary-foreground">
        <li>Search Console → Výkon → karta Stránky.</li>
        <li>
          Nastavte obdobie na minulých 90 dní a exportujte CSV (obdobie A), potom aktuálnych 90 dní
          (obdobie B).
        </li>
        <li>Z názvu súboru odstráňte meno klienta.</li>
        <li>
          Stačí aj jeden súbor so stĺpcami pre obe obdobia (napr. <code>Clicks_A</code> /{" "}
          <code>Clicks_B</code> alebo porovnanie období zo Search Console).
        </li>
      </ol>
    </details>
  );
}

function DropZone({
  slot,
  title,
  loaded,
  onFile,
  onPick,
}: {
  slot: Slot;
  title: string;
  loaded?: Loaded;
  onFile: (slot: Slot, file: File | undefined) => void;
  onPick: (slot: Slot) => void;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    onFile(slot, e.dataTransfer.files?.[0]);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={
        "flex flex-col items-center rounded-xl border-2 border-dashed p-5 text-center transition-colors " +
        (over ? "border-primary bg-muted" : "border-input bg-card")
      }
    >
      <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {loaded ? (
        <>
          <Check className="mb-2 size-6 text-success-foreground" aria-hidden />
          <p className="max-w-full font-medium [overflow-wrap:anywhere]">{loaded.name}</p>
          <p className="mb-3 text-sm text-muted-foreground">
            {intFmt.format(loaded.data.pages.size)} stránok načítaných
          </p>
          <Button variant="outline" className={FOCUS} onClick={() => onPick(slot)}>
            Zmeniť súbor
          </Button>
        </>
      ) : (
        <>
          <FileText className="mb-2 size-6 text-primary" aria-hidden />
          <p className="font-medium">Presuňte CSV sem</p>
          <p className="my-2 text-xs text-muted-foreground">alebo</p>
          <Button
            variant="outline"
            className={FOCUS}
            onClick={() => onPick(slot)}
            aria-label={`Vybrať súbor pre ${title}`}
          >
            Vybrať súbor
          </Button>
        </>
      )}
    </div>
  );
}

function EmptyState({
  slots,
  onFile,
  onPick,
  onSample,
}: {
  slots: Partial<Record<Slot, Loaded>>;
  onFile: (slot: Slot, file: File | undefined) => void;
  onPick: (slot: Slot) => void;
  onSample: () => void;
}) {
  const waitingFor = slots.a && !slots.b ? "B" : slots.b && !slots.a ? "A" : null;
  return (
    <section aria-label="Nahranie exportu">
      <div className="grid gap-4 sm:grid-cols-2">
        <DropZone
          slot="a"
          title="Obdobie A · minulých 90 dní"
          loaded={slots.a}
          onFile={onFile}
          onPick={onPick}
        />
        <DropZone
          slot="b"
          title="Obdobie B · aktuálnych 90 dní"
          loaded={slots.b}
          onFile={onFile}
          onPick={onPick}
        />
      </div>
      {waitingFor && (
        <p role="status" className="mt-3 text-sm text-secondary-foreground">
          Obdobie {waitingFor === "B" ? "A" : "B"} je načítané. Pridajte ešte obdobie {waitingFor}.
        </p>
      )}
      <Button size="lg" className={`mt-5 w-full sm:w-auto ${FOCUS}`} onClick={onSample}>
        Použiť ukážkové dáta
      </Button>
      <Limits withPrivacy={false} />
      <p className="mt-4 flex items-start gap-2 text-sm text-secondary-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        Súbor sa spracuje len vo vašom prehliadači. Na server nejde ani kópia, ani náhľad obsahu a
        nič sa neukladá ani neloguje.
      </p>
      <HowTo />
      <p className="mt-5 text-sm text-muted-foreground">
        Manuálny report zvyčajne trvá okolo {TIME_ASSUMPTION.manualMinutes} minút. Tu ho uvidíte do{" "}
        {TIME_ASSUMPTION.demoSeconds} sekúnd.
      </p>
    </section>
  );
}

function ProcessingCard({ view }: { view: Extract<View, { phase: "processing" }> }) {
  return (
    <div aria-live="polite" className="rounded-xl bg-card p-5 ring-1 ring-border">
      <h2 className="mb-1 font-display text-xl">Čítame CSV…</h2>
      <p className="mb-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {view.fileName}
        {view.rows !== null && ` · ${intFmt.format(view.rows)} riadkov`} · súbor ostáva v
        prehliadači
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.progress}
        aria-label={`Načítané ${view.progress} %`}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${view.progress}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Nič sa neodosiela.</p>
    </div>
  );
}

const NEEDED_COLUMNS = "Page, Clicks, Impressions, CTR, Position";

function FormatError({
  view,
  onPick,
  onSample,
}: {
  view: Extract<View, { phase: "format-error" }>;
  onPick: () => void;
  onSample: () => void;
}) {
  const { missing, found, looksLikeQueries } = view.details;
  return (
    <div role="alert" className="rounded-xl bg-danger-subtle p-5 ring-1 ring-danger-border">
      <h2 className="mb-2 font-display text-xl text-danger-foreground">
        Súbor sa nepodarilo prečítať
      </h2>
      {missing && missing.length > 0 ? (
        <>
          <p className="text-sm text-foreground">
            V <strong className="[overflow-wrap:anywhere]">{view.fileName}</strong> chýbajú povinné
            stĺpce:
          </p>
          <ul className="my-2 list-inside list-disc text-sm text-foreground">
            {missing.map((column) => (
              <li key={column}>chýba {describeMissingColumn(column)}</li>
            ))}
          </ul>
          <p className="text-sm text-foreground [overflow-wrap:anywhere]">
            Nájdené stĺpce: {found && found.length > 0 ? found.join(", ") : "žiadne"}.
            {looksLikeQueries && (
              <>
                {" "}
                Toto vyzerá ako export <strong>dopytov</strong>, nie stránok.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="text-sm text-foreground">
          <strong className="[overflow-wrap:anywhere]">{view.fileName}</strong>: {view.message}
        </p>
      )}
      <p className="mt-2 text-xs text-foreground">
        Potrebné stĺpce v exporte stránok: {NEEDED_COLUMNS}.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button className={FOCUS} onClick={onPick}>
          Vybrať iný súbor
        </Button>
        <Button variant="outline" className={FOCUS} onClick={onSample}>
          Použiť ukážkové dáta
        </Button>
      </div>
    </div>
  );
}

function LimitError({
  view,
  onPick,
}: {
  view: Extract<View, { phase: "limit-error" }>;
  onPick: () => void;
}) {
  const limits = `Maximum je ${formatMb(MAX_FILE_BYTES)} MB a ${intFmt.format(MAX_DATA_ROWS)} riadkov.`;
  return (
    <div role="alert" className="rounded-xl bg-danger-subtle p-5 ring-1 ring-danger-border">
      <h2 className="mb-2 font-display text-xl text-danger-foreground">
        {view.kind === "size" ? "Súbor je príliš veľký" : "Súbor má príliš veľa riadkov"}
      </h2>
      <p className="text-sm text-foreground [overflow-wrap:anywhere]">
        <strong>{view.fileName}</strong>{" "}
        {view.kind === "size" && view.bytes !== undefined
          ? `má ${formatMb(view.bytes)} MB.`
          : `má viac ako ${intFmt.format(MAX_DATA_ROWS)} riadkov.`}{" "}
        {limits}
      </p>
      <p className="mt-2 text-sm text-foreground">
        {view.kind === "size"
          ? "Súbor sme nečítali celý a nič z neho sa neuložilo."
          : "Spracovanie sme zastavili na limite a nič z neho sa neuložilo."}
      </p>
      <Button className={`mt-4 ${FOCUS}`} onClick={onPick}>
        Vybrať iný súbor
      </Button>
    </div>
  );
}

function Periods({ outcome }: { outcome: Outcome }) {
  const { previous, current } = outcome.parsed.periodLabels;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {outcome.host && <span className="font-display text-lg font-semibold">{outcome.host}</span>}
      <span className="text-sm text-muted-foreground">
        {previous} → {current}
      </span>
    </p>
  );
}

function PrivacyFooter({ outcome }: { outcome: Outcome }) {
  return (
    <p className="mt-6 text-sm text-muted-foreground">
      {outcome.sample ? `${SAMPLE_LABEL} pre fiktívny e-shop ${outcome.host ?? ""}. ` : ""}
      Nič z CSV sa neodoslalo ani neuložilo.
    </p>
  );
}

function NoLoss({
  outcome,
  onReset,
  onSample,
}: {
  outcome: Outcome;
  onReset: () => void;
  onSample: () => void;
}) {
  return (
    <section aria-labelledby="seo03-noloss">
      <Eyebrow>Výsledok · 90-sekundová ukážka</Eyebrow>
      <h1 id="seo03-noloss" className="mb-3 font-display text-3xl leading-tight md:text-4xl">
        Nenašli sme pokles kliknutí
      </h1>
      <Periods outcome={outcome} />
      <div className="mt-5 rounded-xl bg-card p-5 ring-1 ring-border">
        <p>V porovnaní období A a B žiadna stránka nestratila kliknutia.</p>
        <p className="mt-2 text-sm text-secondary-foreground">
          Porovnali sme {intFmt.format(outcome.summary.pagesTotal)} stránok. Skontrolujte, či je A
          staršie obdobie a B novšie a či ide o export stránok, nie dopytov.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button className={FOCUS} onClick={onReset}>
            Nahrať iný export
          </Button>
          <Button variant="outline" className={FOCUS} onClick={onSample}>
            Použiť ukážkové dáta
          </Button>
        </div>
      </div>
      <PrivacyFooter outcome={outcome} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** A page absent from one period's export has no CTR or position there; say so instead of "—". */
const MISSING_IN_EXPORT = "v exporte chýba";
function missingOr(page: PageLoss, period: "previous" | "current", value: string): string {
  return page.missingIn === period ? MISSING_IN_EXPORT : value;
}

function PageBlock({ page, variant }: { page: PageLoss; variant: "card" | "paper" }) {
  return (
    <article
      className={
        variant === "card"
          ? "rounded-xl bg-card p-4 ring-1 ring-border md:p-5"
          : "border-t border-border py-5 break-inside-avoid"
      }
      aria-label={`${page.rank}. ${pathOf(page.page)}`}
    >
      <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
            {page.rank}
          </span>
          <div className="min-w-0">
            <p className="font-semibold [overflow-wrap:anywhere]">{pathOf(page.page)}</p>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{page.page}</p>
          </div>
        </div>
        <p className="shrink-0 pl-12 min-[400px]:pl-0 min-[400px]:text-right">
          <span className="block font-display text-xl font-semibold text-danger-foreground tabular-nums">
            −{fmtInt(page.clickLoss)} klikov
          </span>
          <span className="text-xs text-danger-foreground tabular-nums">
            {fmtLossPct(page.lossPct)}
          </span>
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Kliky"
          value={`${fmtInt(page.previous.clicks)} → ${fmtInt(page.current.clicks)}`}
        />
        <Metric
          label="Impresie"
          value={`${fmtInt(page.previous.impressions)} → ${fmtInt(page.current.impressions)}`}
        />
        <Metric
          label="CTR"
          value={`${missingOr(page, "previous", fmtCtr(page.previous.ctr))} → ${missingOr(page, "current", fmtCtr(page.current.ctr))}`}
        />
        <Metric
          label="Pozícia"
          value={`${missingOr(page, "previous", fmtPos(page.previous.position))} → ${missingOr(page, "current", fmtPos(page.current.position))}`}
        />
      </dl>
      <div className="mt-4 rounded-lg bg-info-subtle p-3 ring-1 ring-info-border">
        <p className="text-xs font-semibold tracking-wide text-info-foreground uppercase">
          Čo opraviť ako prvé
        </p>
        <p className="mt-1 text-sm text-foreground">{page.hint.detail}</p>
      </div>
    </article>
  );
}

function Result({
  outcome,
  onReport,
  onDownload,
  onReset,
}: {
  outcome: Outcome;
  onReport: () => void;
  onDownload: () => void;
  onReset: () => void;
}) {
  const { summary, parsed } = outcome;
  const n = summary.top.length;
  const skipped = parsed.skippedInvalid + parsed.skippedDuplicate;
  return (
    <section aria-labelledby="seo03-result">
      <Eyebrow>Výsledok · 90-sekundová ukážka</Eyebrow>
      <h1
        id="seo03-result"
        className="mb-3 font-display text-3xl leading-tight text-balance md:text-4xl"
      >
        {n === 3 ? "Tri stránky" : "Stránky"} s najväčšou stratou kliknutí
      </h1>
      <Periods outcome={outcome} />
      {n < 3 && (
        <p className="mt-2 text-sm text-secondary-foreground">
          Kliknutia stratil{n === 1 ? "a iba 1 stránka" : `i iba ${n} stránky`}, preto ich je menej
          ako tri.
        </p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-card p-4 ring-1 ring-border">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Strata top {n}
          </dt>
          <dd className="font-display text-2xl font-semibold text-danger-foreground tabular-nums">
            −{fmtInt(summary.topClickLoss)}
          </dd>
          <dd className="text-xs text-muted-foreground">klikov spolu</dd>
        </div>
        <div className="rounded-xl bg-card p-4 ring-1 ring-border">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Stránky
          </dt>
          <dd className="font-display text-2xl font-semibold tabular-nums">
            {fmtInt(summary.pagesTotal)}
          </dd>
          <dd className="text-xs text-muted-foreground">porovnaných</dd>
        </div>
        <div className="col-span-2 rounded-xl bg-card p-4 ring-1 ring-border sm:col-span-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Úspora času (odhad)
          </dt>
          <dd className="font-display text-2xl font-semibold tabular-nums">
            {fmtMinutes(TIME_SAVED_MINUTES)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            Predpoklad: ručný report ≈ {TIME_ASSUMPTION.manualMinutes} min, tu ≈{" "}
            {TIME_ASSUMPTION.demoSeconds} s
          </dd>
        </div>
      </dl>

      <ol className="mt-5 space-y-4" aria-label="Stránky so stratou kliknutí">
        {summary.top.map((p) => (
          <li key={p.page}>
            <PageBlock page={p} variant="card" />
          </li>
        ))}
      </ol>

      {skipped > 0 && (
        <p className="mt-3 text-sm text-secondary-foreground">
          Preskočené riadky: {skipped} (chýba stránka alebo číselná hodnota, prípadne duplicita).
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button className={FOCUS} onClick={onReport}>
          Otvoriť klientsky report
        </Button>
        <Button variant="outline" className={FOCUS} onClick={onDownload}>
          Stiahnuť report (CSV)
        </Button>
        <Button variant="outline" className={FOCUS} onClick={onReset}>
          Nahrať iný export
        </Button>
      </div>
      <PrivacyFooter outcome={outcome} />
    </section>
  );
}

function Report({
  outcome,
  generatedAt,
  onBack,
  onDownload,
}: {
  outcome: Outcome;
  generatedAt: Date;
  onBack: () => void;
  onDownload: () => void;
}) {
  const { summary, parsed } = outcome;
  const n = summary.top.length;
  const pagesWord = n === 1 ? "stránka" : n === 3 ? "tri stránky" : `${n} stránky`;
  return (
    <div className="mx-auto max-w-[800px]">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row print:hidden">
        <Button className={FOCUS} onClick={() => window.print()}>
          Tlačiť report
        </Button>
        <Button variant="outline" className={FOCUS} onClick={onDownload}>
          Stiahnuť report (CSV)
        </Button>
        <Button variant="outline" className={FOCUS} onClick={onBack}>
          Späť na výsledok
        </Button>
      </div>
      <article
        aria-labelledby="seo03-report"
        className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-border md:p-8 print:rounded-none print:p-0 print:shadow-none print:ring-0"
      >
        <Eyebrow>Klientsky report · SEO4WEB</Eyebrow>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {outcome.sample && <SampleBadge />}
          <span className="text-xs text-muted-foreground">
            Vygenerované {generatedAt.toLocaleDateString("sk-SK")} v prehliadači
          </span>
        </div>
        <h1 id="seo03-report" className="mb-3 font-display text-2xl leading-tight md:text-3xl">
          Stratené kliknutia{outcome.host ? `: ${outcome.host}` : ""}
        </h1>
        <p className="mb-3 text-sm text-secondary-foreground">
          Porovnanie {parsed.periodLabels.previous} s {parsed.periodLabels.current}.
        </p>
        <p className="mb-4 text-sm">
          V {outcome.sample ? "ukážkovom " : ""}exporte zo Search Console stratil
          {n === 1 ? "a" : "i"} {pagesWord} spolu{" "}
          <strong>{fmtInt(summary.topClickLoss)} kliknutí</strong>. Nižšie je poradie podľa
          absolútneho poklesu a krátky podklad, čo opraviť ako prvé.
        </p>
        {summary.top.map((p) => (
          <PageBlock key={p.page} page={p} variant="paper" />
        ))}
        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            Tento prehľad nahrádza približne {TIME_ASSUMPTION.manualMinutes} minút manuálnej práce
            na reporte (odhadovaná úspora {fmtMinutes(TIME_SAVED_MINUTES)}). Čísla pochádzajú z CSV
            spracovaného len v prehliadači — súbor sa neukladal na server.
          </p>
          {outcome.sample && (
            <p className="mt-2">
              {SAMPLE_LABEL}, fiktívna doména {outcome.host}. Toto nie je report z reálneho klienta.
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
