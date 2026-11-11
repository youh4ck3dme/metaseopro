import { useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Save,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { getUserSubscription, updateCompanyBillingDetails } from "@/lib/billing.functions";
import { isValidDIC, isValidICDPH, isValidICO, type PlanId } from "@/lib/slovak-billing";
import { PaywallModal } from "@/components/PaywallModal";

interface BillingAddressState {
  line1?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

export function BillingInvoiceSection() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Plan info
  const [plan, setPlan] = useState<PlanId>("free");
  const [status, setStatus] = useState<string>("active");
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [lastInvoiceNumber, setLastInvoiceNumber] = useState<string | null>(null);
  const [lastInvoiceUrl, setLastInvoiceUrl] = useState<string | null>(null);

  // Form fields
  const [companyName, setCompanyName] = useState("");
  const [ico, setIco] = useState("");
  const [dic, setDic] = useState("");
  const [icDph, setIcDph] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("Slovensko");

  // Validation errors
  const [icoError, setIcoError] = useState("");
  const [dicError, setDicError] = useState("");
  const [icDphError, setIcDphError] = useState("");

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let active = true;

    async function fetchSubscription() {
      setLoading(true);
      try {
        const sub = await getUserSubscription();
        if (active && sub) {
          setPlan(sub.plan);
          setStatus(sub.status || "active");
          setCurrentPeriodEnd(sub.currentPeriodEnd);
          setCompanyName(sub.companyName || "");
          setIco(sub.ico || "");
          setDic(sub.dic || "");
          setIcDph(sub.icDph || "");
          setLastInvoiceNumber(sub.lastInvoiceNumber || null);
          setLastInvoiceUrl(sub.lastInvoiceUrl || null);

          const addr = sub.billingAddress as BillingAddressState | null;
          if (addr) {
            setAddress(addr.line1 || "");
            setCity(addr.city || "");
            setZip(addr.postal_code || "");
            setCountry(addr.country || "Slovensko");
          }
        }
      } catch (err) {
        console.error("Error loading subscription in BillingInvoiceSection:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchSubscription();

    return () => {
      active = false;
    };
  }, [user]);

  // Live validators
  const handleIcoChange = (val: string) => {
    setIco(val);
    if (!val.trim()) {
      setIcoError("");
    } else if (!isValidICO(val)) {
      setIcoError("Neplatné IČO (8 číslic s kontrolným súčtom modulo 11).");
    } else {
      setIcoError("");
    }
  };

  const handleDicChange = (val: string) => {
    setDic(val);
    if (!val.trim()) {
      setDicError("");
    } else if (!isValidDIC(val)) {
      setDicError("Neplatné DIČ (10 číslic, začína 10, 20 alebo 21 a deliteľné 11).");
    } else {
      setDicError("");
    }
  };

  const handleIcDphChange = (val: string) => {
    setIcDph(val);
    if (!val.trim()) {
      setIcDphError("");
    } else if (!isValidICDPH(val)) {
      setIcDphError("Neplatné IČ DPH (očakávaný formát: SK + 10-miestne DIČ).");
    } else {
      setIcDphError("");
    }
  };

  const handleSaveBilling = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error("Pre uloženie fakturačných údajov sa musíte prihlásiť.");
      return;
    }

    if (ico && !isValidICO(ico)) {
      toast.error("Zadané IČO má neplatný formát.");
      return;
    }
    if (dic && !isValidDIC(dic)) {
      toast.error("Zadané DIČ má neplatný formát.");
      return;
    }
    if (icDph && !isValidICDPH(icDph)) {
      toast.error("Zadané IČ DPH má neplatný formát.");
      return;
    }

    setSaving(true);
    try {
      await updateCompanyBillingDetails({
        data: {
          companyName: companyName.trim() || undefined,
          ico: ico.trim() || undefined,
          dic: dic.trim() || undefined,
          icDph: icDph.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          zip: zip.trim() || undefined,
          country: country.trim() || "Slovensko",
        },
      });
      toast.success("Fakturačné údaje boli úspešne uložené.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Uloženie fakturačných údajov zlyhalo.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-[#2c2c2c] bg-[#212121] p-6 flex items-center justify-center gap-3 text-zinc-400 text-sm shadow-xl shadow-black/40">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none text-emerald-400" />
        <span>Načítavam fakturačné údaje a predplatné…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header Card: Current Plan & Invoice Download */}
      <div className="rounded-xl border border-[#2c2c2c] bg-[#212121] p-5 md:p-6 shadow-xl shadow-black/40">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CreditCard className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-white">
                  Fakturačné údaje a predplatné
                </h3>
                <Badge
                  variant="outline"
                  className={
                    plan === "agency"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-400 font-bold"
                      : plan === "pro"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-bold"
                        : "border-[#333333] bg-[#262626] text-zinc-400"
                  }
                >
                  {plan.toUpperCase()}
                </Badge>
                {status === "active" && (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]"
                  >
                    Aktívne
                  </Badge>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {currentPeriodEnd
                  ? `Predplatné je aktívne do ${new Date(currentPeriodEnd).toLocaleDateString("sk-SK")}`
                  : "Bezplatný plán (1 projekt, 1 mesačný snapshot)"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {plan === "free" ? (
              <Button
                size="sm"
                onClick={() => setPaywallOpen(true)}
                className="gap-1.5 text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200"
              >
                <Sparkles className="size-3.5 text-emerald-600" />
                Aktivovať balík Pro (39 €)
              </Button>
            ) : lastInvoiceUrl ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="gap-2 text-xs font-semibold border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              >
                <a href={lastInvoiceUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="size-3.5" />
                  Stiahnuť poslednú faktúru (PDF)
                </a>
              </Button>
            ) : (
              <div className="text-xs text-zinc-400 italic flex items-center gap-1.5">
                <FileText className="size-3.5" />
                Faktúra sa vystaví pri najbližšej platbe
              </div>
            )}
          </div>
        </div>

        {/* Invoice Summary Pill */}
        {lastInvoiceNumber && (
          <div className="mt-4 pt-4 border-t border-[#2c2c2c] flex flex-wrap items-center justify-between text-xs text-zinc-400 gap-2">
            <span className="flex items-center gap-1.5 font-medium text-zinc-200">
              <CheckCircle2 className="size-4 text-emerald-400" />
              Posledná vystavená faktúra:{" "}
              <strong className="font-mono text-white">{lastInvoiceNumber}</strong>
            </span>
            {lastInvoiceUrl && (
              <a
                href={lastInvoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 hover:underline font-semibold"
              >
                Otvoriť PDF na SuperFaktúra.sk <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* 2. Billing Details Form */}
      <div className="rounded-xl border border-[#2c2c2c] bg-[#212121] p-5 md:p-6 shadow-xl shadow-black/40">
        <div className="flex items-center gap-2 font-semibold text-sm mb-4 text-white">
          <Building2 className="size-4 text-emerald-400" />
          <span>Firemné fakturačné údaje (Slovensko a EÚ)</span>
        </div>

        <form onSubmit={handleSaveBilling} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Obchodné meno */}
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="billingCompanyName" className="text-xs font-medium text-zinc-300">
                Obchodné meno spoločnosti / Živnostník
              </Label>
              <Input
                id="billingCompanyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="napr. Moja SEO Agentúra s.r.o."
                className="bg-[#1a1a1a] border-[#333333] text-[#f4f4f5] placeholder:text-zinc-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500"
              />
            </div>

            {/* IČO */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="billingIco" className="text-xs font-medium text-zinc-300">
                  IČO (8 číslic)
                </Label>
                {ico && !icoError && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Platné
                  </span>
                )}
              </div>
              <Input
                id="billingIco"
                value={ico}
                onChange={(e) => handleIcoChange(e.target.value)}
                placeholder="12345678"
                className={`bg-[#1a1a1a] text-[#f4f4f5] placeholder:text-zinc-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500 ${
                  icoError ? "border-rose-500 focus-visible:ring-rose-500" : "border-[#333333]"
                }`}
              />
              {icoError && (
                <p className="text-[11px] text-rose-400 flex items-center gap-1">
                  <ShieldAlert className="size-3" /> {icoError}
                </p>
              )}
            </div>

            {/* DIČ */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="billingDic" className="text-xs font-medium text-zinc-300">
                  DIČ (10 číslic)
                </Label>
                {dic && !dicError && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Platné
                  </span>
                )}
              </div>
              <Input
                id="billingDic"
                value={dic}
                onChange={(e) => handleDicChange(e.target.value)}
                placeholder="2021234567"
                className={`bg-[#1a1a1a] text-[#f4f4f5] placeholder:text-zinc-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500 ${
                  dicError ? "border-rose-500 focus-visible:ring-rose-500" : "border-[#333333]"
                }`}
              />
              {dicError && (
                <p className="text-[11px] text-rose-400 flex items-center gap-1">
                  <ShieldAlert className="size-3" /> {dicError}
                </p>
              )}
            </div>

            {/* IČ DPH */}
            <div className="sm:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="billingIcDph" className="text-xs font-medium text-zinc-300">
                  IČ DPH (nepovinné, formát SK + DIČ alebo CZ...)
                </Label>
                {icDph && !icDphError && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Platný formát
                  </span>
                )}
              </div>
              <Input
                id="billingIcDph"
                value={icDph}
                onChange={(e) => handleIcDphChange(e.target.value)}
                placeholder="SK2021234567 (alebo CZ12345678 pre Reverse Charge)"
                className={`bg-[#1a1a1a] text-[#f4f4f5] placeholder:text-zinc-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500 ${
                  icDphError ? "border-rose-500 focus-visible:ring-rose-500" : "border-[#333333]"
                }`}
              />
              {icDphError ? (
                <p className="text-[11px] text-rose-400 flex items-center gap-1">
                  <ShieldAlert className="size-3" /> {icDphError}
                </p>
              ) : (
                <p className="text-[11px] text-zinc-400">
                  Zahraničné firmy z EÚ s overeným IČ DPH automaticky uplatňujú prenesenie daňovej
                  povinnosti (Reverse Charge 0% DPH).
                </p>
              )}
            </div>

            {/* Ulica a číslo */}
            <div className="space-y-1.5">
              <Label htmlFor="billingAddress" className="text-xs font-medium text-zinc-300">
                Ulica a súpisné číslo
              </Label>
              <Input
                id="billingAddress"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Hlavná 42"
                className="bg-[#1a1a1a] border-[#333333] text-[#f4f4f5] placeholder:text-zinc-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500"
              />
            </div>

            {/* Mesto */}
            <div className="space-y-1.5">
              <Label htmlFor="billingCity" className="text-xs font-medium text-zinc-300">
                Mesto
              </Label>
              <Input
                id="billingCity"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Bratislava"
                className="bg-[#1a1a1a] border-[#333333] text-[#f4f4f5] placeholder:text-zinc-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500"
              />
            </div>

            {/* PSČ */}
            <div className="space-y-1.5">
              <Label htmlFor="billingZip" className="text-xs font-medium text-zinc-300">
                PSČ
              </Label>
              <Input
                id="billingZip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="811 01"
                className="bg-[#1a1a1a] border-[#333333] text-[#f4f4f5] placeholder:text-zinc-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500"
              />
            </div>

            {/* Krajina */}
            <div className="space-y-1.5">
              <Label htmlFor="billingCountry" className="text-xs font-medium text-zinc-300">
                Krajina sídla
              </Label>
              <select
                id="billingCountry"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-md border border-[#333333] bg-[#1a1a1a] text-[#f4f4f5] px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus:border-emerald-500"
              >
                <option value="Slovensko">Slovenská republika (SK)</option>
                <option value="Česká republika">Česká republika (CZ)</option>
                <option value="Nemecko">Nemecko (DE)</option>
                <option value="Rakúsko">Rakúsko (AT)</option>
                <option value="Poľsko">Poľsko (PL)</option>
                <option value="Maďarsko">Maďarsko (HU)</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end">
            <Button
              type="submit"
              disabled={saving || Boolean(icoError || dicError || icDphError)}
              className="gap-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Save className="size-3.5" />
              )}
              {saving ? "Ukladám údaje…" : "Uložiť fakturačné údaje"}
            </Button>
          </div>
        </form>
      </div>

      <PaywallModal
        open={paywallOpen}
        onOpenChange={setPaywallOpen}
        plan="pro"
        title="Prejdite na Pro balík SEO4WEB"
        description="Získajte 5 projektov, neobmedzený Decay Radar, CTR Booster a automatické slovenské faktúry pri každej platbe."
      />
    </div>
  );
}
