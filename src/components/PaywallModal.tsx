import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Sparkles, ShieldCheck, Zap, Lock } from "lucide-react";
import { toast } from "sonner";
import { createCheckoutSession } from "@/lib/billing.functions";
import { isValidDIC, isValidICDPH, isValidICO } from "@/lib/slovak-billing";

interface PaywallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  feature?: string;
  plan?: "pro" | "agency";
}

export function PaywallModal({
  open,
  onOpenChange,
  title = "Odomknite neobmedzený SEO Audit s balíkom Pro",
  description = "Bezplatný plán umožňuje analýzu maximálne 3 URL adries. Upgradujte na Pro a získajte kompletný audit bez obmedzení.",
  feature = "Neobmedzený audit a exporty",
  plan = "pro",
}: PaywallModalProps) {
  const [loading, setLoading] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [ico, setIco] = useState("");
  const [dic, setDic] = useState("");
  const [icDph, setIcDph] = useState("");

  const isAgency = plan === "agency";
  const startCheckout = useServerFn(createCheckoutSession);

  const handleUpgrade = async () => {
    // Validate IČO if provided
    if (ico && !isValidICO(ico)) {
      toast.error("Zadané IČO má neplatný formát alebo kontrolnú číslicu.");
      return;
    }
    // Validate DIČ if provided
    if (dic && !isValidDIC(dic)) {
      toast.error("Neplatné DIČ (musí mať 10 číslic a byť deliteľné 11).");
      return;
    }
    // Validate IČ DPH if provided
    if (icDph && !isValidICDPH(icDph)) {
      toast.error("Neplatné IČ DPH (očakávaný formát: SK + 10-miestne DIČ).");
      return;
    }

    setLoading(true);
    try {
      const res = await startCheckout({
        data: {
          plan,
          companyName: companyName.trim() || undefined,
          ico: ico.trim() || undefined,
          dic: dic.trim() || undefined,
          icDph: icDph.trim() || undefined,
        },
      });

      if (res?.url) {
        window.location.href = res.url;
      } else {
        toast.error("Nepodarilo sa vytvoriť platobnú reláciu.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chyba pri inicializácii platby.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary font-semibold text-sm mb-1">
            <Sparkles className="size-4" />
            <span>
              {isAgency ? "SEO4WEB Agency (89 € / mesiac)" : "SEO4WEB Pro (39 € / mesiac)"}
            </span>
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight">{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-xl border bg-muted/30 p-4 space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isAgency ? "V balíku Agency získate:" : "V balíku Pro získate:"}
            </div>
            <div className="grid gap-2 text-sm">
              {isAgency ? (
                <>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Whitelabel mesačné PDF reporty s logom vašej agentúry</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Neobmedzený počet sledovaných klientskych webov a projektov</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Sledovanie konkurencie a prioritné AI SEO generovanie</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Fakturácia so slovenským IČO a odpočtom DPH pre agentúru</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Neobmedzená analýza URL a domén (žiadny limit 3 URL)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Plný Content Decay Radar so živými dátami z Google Search Console</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Generovanie 30-dňových obsahových plánov a WordPress exporty</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-success-foreground shrink-0" />
                    <span>Slovenská faktúra s odpočtom DPH alebo prenosom daňovej povinnosti</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowBilling(!showBilling)}
              className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
            >
              <ShieldCheck className="size-3.5" />
              {showBilling ? "Skryť firemné fakturačné údaje" : "Zadať firemné údaje (IČO, DIČ pre faktúru)"}
            </button>

            {showBilling && (
              <div className="mt-3 space-y-3 rounded-lg border p-3.5 bg-background">
                <div>
                  <Label htmlFor="companyName" className="text-xs">Názov firmy / SZČO</Label>
                  <Input
                    id="companyName"
                    placeholder="napr. Moja Firma s.r.o."
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="ico" className="text-xs">IČO</Label>
                    <Input
                      id="ico"
                      placeholder="8 číslic (napr. 35763469)"
                      value={ico}
                      onChange={(e) => setIco(e.target.value)}
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dic" className="text-xs">DIČ</Label>
                    <Input
                      id="dic"
                      placeholder="10 číslic (napr. 2020273893)"
                      value={dic}
                      onChange={(e) => setDic(e.target.value)}
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="icDph" className="text-xs">IČ DPH (nepovinné, pre platcov)</Label>
                  <Input
                    id="icDph"
                    placeholder="SK2020273893"
                    value={icDph}
                    onChange={(e) => setIcDph(e.target.value)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full gap-2 font-semibold shadow-sm"
          >
            {loading ? (
              <span>Pripravujem bezpečnú platbu...</span>
            ) : (
              <>
                <Zap className="size-4" />
                <span>Aktivovať SEO4WEB Pro (39 € / mesiac)</span>
              </>
            )}
          </Button>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="size-3" />
            <span>Zabezpečená platba kartou cez Stripe. Možnosť kedykoľvek zrušiť na 1 klik.</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
