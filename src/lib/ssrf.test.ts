import { describe, expect, it } from "vitest";
import { assertSafePublicUrl, isSafePublicUrl } from "./ssrf";

describe("SSRF Protection & URL Safety Validator", () => {
  it("blocks localhost, loopback and private networks", () => {
    expect(isSafePublicUrl("http://localhost/wp-json")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.1:8080/wp-json")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.2")).toBe(false);
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafePublicUrl("http://10.1.2.3/api")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.100/posts")).toBe(false);
    expect(isSafePublicUrl("http://172.20.0.5/api")).toBe(false);
    expect(isSafePublicUrl("http://0.0.0.0")).toBe(false);
    expect(isSafePublicUrl("ftp://example.com/api")).toBe(false);
    expect(isSafePublicUrl("http://internal.server.local")).toBe(false);
    expect(isSafePublicUrl("http://dev.internal")).toBe(false);
    expect(isSafePublicUrl("http://myhost.lan")).toBe(false);
  });

  it("blocks IPv6 loopback and link-local addresses", () => {
    expect(isSafePublicUrl("http://[::1]/")).toBe(false);
    expect(isSafePublicUrl("http://[fe80::1]/")).toBe(false);
    expect(isSafePublicUrl("http://[fc00::1]/")).toBe(false);
  });

  it("permits legitimate public web URLs", () => {
    expect(isSafePublicUrl("https://mojweb.sk")).toBe(true);
    expect(isSafePublicUrl("https://blog.firma.cz/wp-json/wp/v2/posts")).toBe(true);
    expect(isSafePublicUrl("http://google.com")).toBe(true);
    expect(isSafePublicUrl("https://eshop.subdomain.eu/kategoria")).toBe(true);
  });

  it("assertSafePublicUrl throws on blocked addresses and passes on valid ones", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1:8080")).toThrow(/loopback IP/);
    expect(() => assertSafePublicUrl("http://169.254.169.254")).toThrow(/metadata service/);
    expect(() => assertSafePublicUrl("http://10.0.0.1")).toThrow(/privátna sieť/);
    expect(() => assertSafePublicUrl("https://mojweb.sk")).not.toThrow();
  });
});
