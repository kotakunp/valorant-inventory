import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  deriveMacKey,
  decryptChromiumValue,
  decryptWindowsValue,
  isPrintableCookie,
  parseOsCryptWrappedKey,
} from "./chromeCookies";

const KEY = deriveMacKey("unit-test-secret");
const WIN_KEY = crypto.randomBytes(32);
const HOST = "auth.riotgames.com";

function domainHash(host: string): Buffer {
  return crypto.createHash("sha256").update(host).digest();
}

function encryptSpacesIv(plain: string | Buffer, key: Buffer): Buffer {
  const iv = Buffer.alloc(16, 0x20);
  const c = crypto.createCipheriv("aes-128-cbc", key, iv);
  const buf = typeof plain === "string" ? Buffer.from(plain, "utf8") : plain;
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("v10", "latin1"), ct]);
}

function encryptEmbeddedIv(plain: string | Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-128-cbc", key, iv);
  const buf = typeof plain === "string" ? Buffer.from(plain, "utf8") : plain;
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("v11", "latin1"), iv, ct]);
}

function encryptWindowsGcm(plain: string | Buffer, key: Buffer): Buffer {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const buf = typeof plain === "string" ? Buffer.from(plain, "utf8") : plain;
  const ct = Buffer.concat([c.update(buf), c.final()]);
  const tag = c.getAuthTag(); // 16 bytes, only after final()
  return Buffer.concat([Buffer.from("v10", "latin1"), nonce, ct, tag]);
}

describe("deriveMacKey", () => {
  it("derives a stable 16-byte key", () => {
    const a = deriveMacKey("secret-a");
    const b = deriveMacKey("secret-a");
    expect(a.length).toBe(16);
    expect(Buffer.compare(a, b)).toBe(0);
    expect(Buffer.compare(a, deriveMacKey("secret-b"))).not.toBe(0);
  });
});

describe("isPrintableCookie", () => {
  it("accepts printable values and rejects control bytes", () => {
    expect(isPrintableCookie("abcXYZ012+/=_-")).toBe(true);
    expect(isPrintableCookie("")).toBe(false);
    expect(isPrintableCookie("bad" + String.fromCharCode(0) + "x")).toBe(false);
  });
});

describe("decryptChromiumValue", () => {
  it("round-trips the macOS spaces-IV v10 format", () => {
    const blob = encryptSpacesIv("ssid-value.123", KEY);
    expect(decryptChromiumValue(blob, KEY)).toBe("ssid-value.123");
  });
  it("round-trips the embedded-IV v11 format", () => {
    const blob = encryptEmbeddedIv("asid=should-not-matter;value", KEY);
    expect(decryptChromiumValue(blob, KEY)).toBe("asid=should-not-matter;value");
  });
  it("strips the SHA-256(host) domain-hash prefix (newer Chromium)", () => {
    const plain = Buffer.concat([domainHash(HOST), Buffer.from("ssid.abc123", "utf8")]);
    const blob = encryptSpacesIv(plain, KEY);
    expect(decryptChromiumValue(blob, KEY, HOST)).toBe("ssid.abc123");
  });
  it("returns null when a domain-hashed value is read with the wrong host", () => {
    const plain = Buffer.concat([domainHash(HOST), Buffer.from("ssid.abc123", "utf8")]);
    const blob = encryptSpacesIv(plain, KEY);
    expect(decryptChromiumValue(blob, KEY, "other.example")).toBeNull();
  });
  it("still handles legacy (no domain-hash) plaintext", () => {
    const blob = encryptSpacesIv("clid-legacy", KEY);
    expect(decryptChromiumValue(blob, KEY, HOST)).toBe("clid-legacy");
  });
  it("returns null for v20 (app-bound) blobs", () => {
    const blob = Buffer.concat([Buffer.from("v20", "latin1"), crypto.randomBytes(32)]);
    expect(decryptChromiumValue(blob, KEY)).toBeNull();
  });
  it("returns null when the key is wrong", () => {
    const blob = encryptSpacesIv("ssid-value", KEY);
    expect(decryptChromiumValue(blob, deriveMacKey("wrong"))).toBeNull();
  });
  it("returns null for truncated blobs", () => {
    expect(decryptChromiumValue(Buffer.from("v10short", "latin1"), KEY)).toBeNull();
  });
});

describe("decryptWindowsValue (AES-256-GCM)", () => {
  it("round-trips a v10 GCM value", () => {
    const blob = encryptWindowsGcm("ssid.win-value", WIN_KEY);
    expect(decryptWindowsValue(blob, WIN_KEY)).toBe("ssid.win-value");
  });
  it("strips the domain-hash prefix", () => {
    const plain = Buffer.concat([domainHash(HOST), Buffer.from("ssid.win", "utf8")]);
    const blob = encryptWindowsGcm(plain, WIN_KEY);
    expect(decryptWindowsValue(blob, WIN_KEY, HOST)).toBe("ssid.win");
  });
  it("returns null for v20 (app-bound) blobs", () => {
    const blob = Buffer.concat([Buffer.from("v20", "latin1"), crypto.randomBytes(48)]);
    expect(decryptWindowsValue(blob, WIN_KEY)).toBeNull();
  });
  it("returns null when the key is wrong", () => {
    const blob = encryptWindowsGcm("ssid.win", WIN_KEY);
    expect(decryptWindowsValue(blob, crypto.randomBytes(32))).toBeNull();
  });
  it("returns null for non-32-byte keys or truncated blobs", () => {
    const blob = encryptWindowsGcm("ssid.win", WIN_KEY);
    expect(decryptWindowsValue(blob, KEY)).toBeNull(); // 16-byte mac key
    expect(decryptWindowsValue(Buffer.from("v10short", "latin1"), WIN_KEY)).toBeNull();
  });
});

describe("parseOsCryptWrappedKey", () => {
  it("strips the DPAPI magic prefix", () => {
    const dpapiBlob = Buffer.concat([Buffer.from("DPAPI", "latin1"), crypto.randomBytes(40)]);
    const out = parseOsCryptWrappedKey(dpapiBlob.toString("base64"));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(40);
    expect(Buffer.compare(out!, dpapiBlob.subarray(5))).toBe(0);
  });
  it("rejects payloads without the DPAPI prefix (e.g. app-bound key)", () => {
    const other = Buffer.concat([Buffer.from("APPB", "latin1"), crypto.randomBytes(40)]);
    expect(parseOsCryptWrappedKey(other.toString("base64"))).toBeNull();
    expect(parseOsCryptWrappedKey("")).toBeNull();
  });
});
