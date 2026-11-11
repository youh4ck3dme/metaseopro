/**
 * SSRF Protection & URL Safety Validation
 * Protects server-side fetchers from requesting internal/private IP ranges,
 * cloud metadata endpoints (AWS/GCP/Azure), and loopback interfaces.
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    const host = url.hostname.toLowerCase().trim();
    // Zakáž localhost a interné domény
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.endsWith(".home") ||
      host.endsWith(".arpa")
    ) {
      return false;
    }

    // Zakáž privátne a vyhradené IPv4 rozsahy (RFC 1918, loopback, link-local, cloud metadata)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = host.match(ipv4Regex);
    if (match) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      const c = Number(match[3]);
      const d = Number(match[4]);
      if (a > 255 || b > 255 || c > 255 || d > 255) return false;
      if (a === 127) return false; // Loopback (127.0.0.0/8)
      if (a === 10) return false; // Private class A (10.0.0.0/8)
      if (a === 172 && b >= 16 && b <= 31) return false; // Private class B (172.16.0.0/12)
      if (a === 192 && b === 168) return false; // Private class C (192.168.0.0/16)
      if (a === 169 && b === 254) return false; // Link-local / Cloud metadata AWS/GCP/Azure (169.254.0.0/16)
      if (a === 0 || a >= 224) return false; // Broadcast / Multicast / Invalid
      if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT (100.64.0.0/10)
    }

    // Zakáž IPv6 loopback a link-local
    if (
      host === "::1" ||
      host === "[::1]" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc00:") ||
      host.startsWith("[fe8") ||
      host.startsWith("[fc") ||
      host.startsWith("[fd")
    ) {
      return false;
    }

    // Musí obsahovať aspoň jednu bodku (verejná TLD)
    if (!host.includes(".")) return false;

    return true;
  } catch {
    return false;
  }
}

export function assertSafePublicUrl(rawUrl: string): void {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Chýbajúca URL adresa.");
  }
  let parsed: URL;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl);
    parsed = new URL(hasScheme ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new Error("Neplatný formát URL adresy.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Povolené sú iba protokoly http:// a https://.");
  }

  if (!isSafePublicUrl(parsed.toString())) {
    const host = parsed.hostname.toLowerCase().trim();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      throw new Error("Nepovolená sieťová adresa (SSRF ochrana): lokálne adresy nie sú povolené.");
    }
    const ipMatch = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipMatch) {
      const a = Number(ipMatch[1]);
      const b = Number(ipMatch[2]);
      if (a === 127) throw new Error("Nepovolená sieťová adresa: loopback IP (127.0.0.0/8).");
      if (a === 10) throw new Error("Nepovolená sieťová adresa: privátna sieť (10.0.0.0/8).");
      if (a === 172 && b >= 16 && b <= 31)
        throw new Error("Nepovolená sieťová adresa: privátna sieť (172.16.0.0/12).");
      if (a === 192 && b === 168)
        throw new Error("Nepovolená sieťová adresa: privátna sieť (192.168.0.0/16).");
      if (a === 169 && b === 254)
        throw new Error(
          "Nepovolená sieťová adresa: link-local / metadata service (169.254.0.0/16).",
        );
      if (a === 0) throw new Error("Nepovolená sieťová adresa: 0.0.0.0/8.");
    }
    throw new Error("Nepovolená sieťová adresa (SSRF ochrana).");
  }
}
