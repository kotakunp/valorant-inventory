// Harvest Riot session cookies from the user's installed Chrome (macOS + Windows).
// macOS: Keychain secret ("Chrome Safe Storage") -> PBKDF2-SHA1 -> AES-128-CBC.
// Windows: Local State os_crypt.encrypted_key -> DPAPI (CurrentUser) -> AES-256-GCM.
// Newer Chromium prepends SHA-256(host_key) to plaintext — stripped when it matches.
// v20 (app-bound) cannot be decrypted externally -> skipped.
// RULES: copies the DB to a temp dir (never touches the original), decrypts in
// memory, returns values to the caller only — nothing here is ever logged.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AuthFlowError } from "./riotAuth";

const execFileAsync = promisify(execFile);

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
}

export type HarvestResult = { cookies: BrowserCookie[]; profile: string } | { skip: string };

let cachedSecret: string | null = null;
let cachedWinKeys = new Map<string, Buffer | null>();

/** Keychain -> raw secret (one GUI prompt unless Always Allow was chosen). */
export async function chromeKeychainSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Chrome Safe Storage", "-w"],
      { timeout: 60_000 }
    ));
  } catch {
    throw new AuthFlowError(
      "macOS Keychain access was denied — a prompt for “Chrome Safe Storage” will appear: choose Always Allow, then click AUTO LOGIN again. " +
        "Or fall back to the login window / manual cookie paste.",
      403
    );
  }
  cachedSecret = stdout.replace(/\n$/, "");
  if (!cachedSecret) throw new AuthFlowError("Chrome Keychain secret was empty — use the login window instead.", 403);
  return cachedSecret;
}

/** PBKDF2-SHA1(secret, "saltysalt", 1003) -> 16-byte AES key (Chromium macOS). */
export function deriveMacKey(keychainSecret: string): Buffer {
  return crypto.pbkdf2Sync(keychainSecret, "saltysalt", 1003, 16, "sha1");
}

/** Cookie values are printable ASCII; a wrong decrypt yields binary garbage. */
export function isPrintableCookie(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** Strip the SHA-256(host) domain-hash prefix when present; validate printability. */
function stripDomainHash(out: Buffer, hostKey?: string): string | null {
  if (out.length > 32 && hostKey !== undefined) {
    const hash = crypto.createHash("sha256").update(hostKey).digest();
    if (Buffer.compare(out.subarray(0, 32), hash) === 0) {
      const s = out.subarray(32).toString("utf8");
      return isPrintableCookie(s) ? s : null;
    }
  }
  const s = out.toString("utf8");
  return isPrintableCookie(s) ? s : null;
}

function versionOf(blob: Buffer): string {
  return blob.subarray(0, 3).toString("latin1");
}

function isLegacyVersion(v: string): boolean {
  return v === "v10" || v === "v11";
}

/** Decrypt a Chromium "v10"/"v11" AES-128-CBC value (macOS/Linux). Null for v20/undecryptable. */
export function decryptChromiumValue(blob: Buffer, key: Buffer, hostKey?: string): string | null {
  if (blob.length < 19 || !isLegacyVersion(versionOf(blob))) return null; // includes v20
  const body = blob.subarray(3);
  // macOS classic: ciphertext only, IV = sixteen spaces; newer: IV embedded.
  const variants: Array<{ iv: Buffer; data: Buffer }> = [{ iv: Buffer.alloc(16, 0x20), data: body }];
  if (body.length > 16 && (body.length - 16) % 16 === 0) {
    variants.push({ iv: body.subarray(0, 16), data: body.subarray(16) });
  }
  for (const { iv, data } of variants) {
    if (data.length === 0 || data.length % 16 !== 0) continue;
    try {
      const dec = crypto.createDecipheriv("aes-128-cbc", key, iv);
      const out = Buffer.concat([dec.update(data), dec.final()]);
      const s = stripDomainHash(out, hostKey);
      if (s !== null) return s;
    } catch {
      /* wrong variant — try next */
    }
  }
  return null;
}

/** Decrypt a Chromium Windows "v10" AES-256-GCM value (v10 + 12B nonce + ct + 16B tag). */
export function decryptWindowsValue(blob: Buffer, key: Buffer, hostKey?: string): string | null {
  if (blob.length < 3 + 12 + 16 || !isLegacyVersion(versionOf(blob))) return null; // includes v20
  if (key.length !== 32) return null;
  const nonce = blob.subarray(3, 15);
  const data = blob.subarray(15);
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  try {
    const dec = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    dec.setAuthTag(tag);
    const out = Buffer.concat([dec.update(ct), dec.final()]);
    return stripDomainHash(out, hostKey);
  } catch {
    return null;
  }
}

/** Strip the "DPAPI" magic from Local State's os_crypt.encrypted_key payload. */
export function parseOsCryptWrappedKey(encryptedKeyB64: string): Buffer | null {
  const wrapped = Buffer.from(encryptedKeyB64, "base64");
  if (wrapped.length <= 5 || wrapped.subarray(0, 5).toString("latin1") !== "DPAPI") return null;
  return wrapped.subarray(5);
}

const PS_DPAPI =
  "Add-Type -AssemblyName System.Security; " +
  "$b=[Convert]::FromBase64String($env:VSDPAPI); " +
  "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[Convert]::ToBase64String($p)";

/** Unwrap a DPAPI blob with the current Windows user's credentials. Null on failure/non-Windows. */
export async function unwrapDpapi(blob: Buffer): Promise<Buffer | null> {
  if (process.platform !== "win32") return null;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PS_DPAPI],
      {
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 1 << 20,
        env: { ...process.env, VSDPAPI: blob.toString("base64") },
      }
    );
    const key = Buffer.from(stdout.trim(), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/** Windows: Local State -> DPAPI-unwrapped 32-byte AES-256-GCM key (cached per root). */
export async function windowsAesKey(userDataRoot: string): Promise<Buffer | null> {
  if (cachedWinKeys.has(userDataRoot)) return cachedWinKeys.get(userDataRoot) ?? null;
  let key: Buffer | null = null;
  try {
    const raw = fs.readFileSync(path.join(userDataRoot, "Local State"), "utf8");
    const cfg = JSON.parse(raw);
    const b64 = cfg?.os_crypt?.encrypted_key;
    if (typeof b64 === "string" && b64) {
      const dpapiBlob = parseOsCryptWrappedKey(b64);
      if (dpapiBlob) key = await unwrapDpapi(dpapiBlob);
    }
  } catch {
    key = null;
  }
  cachedWinKeys.set(userDataRoot, key);
  return key;
}

function chromeRoots(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") return [path.join(home, "Library/Application Support/Google/Chrome")];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    return local ? [path.join(local, "Google/Chrome/User Data")] : [];
  }
  return [path.join(home, ".config/google-chrome")];
}

/** Cookies DB lives at <profile>/Network/Cookies (modern) or <profile>/Cookies (legacy/mac). */
export function cookieDbPath(profileDir: string): string | null {
  for (const p of [path.join(profileDir, "Network", "Cookies"), path.join(profileDir, "Cookies")]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function listProfiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && cookieDbPath(path.join(root, d.name)))
    .map((d) => d.name);
  return dirs.sort((a, b) => {
    if (a === "Default") return -1;
    if (b === "Default") return 1;
    return a.localeCompare(b);
  });
}

interface CookieRow {
  host_key: string;
  name: string;
  value: string | null;
  encrypted_value: Uint8Array | null;
}

/** Copy one profile's Cookies DB (+WAL) to a temp dir and read Riot rows. */
async function readRiotRows(profileDir: string): Promise<{ rows: CookieRow[]; prefixes: Set<string> }> {
  // dynamic: vite/vitest don't treat node:sqlite as a builtin yet
  const { DatabaseSync } = await import("node:sqlite");
  const dbPath = cookieDbPath(profileDir);
  if (!dbPath) return { rows: [], prefixes: new Set() };
  const dir = path.dirname(dbPath);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-chrome-"));
  try {
    for (const f of ["Cookies", "Cookies-wal", "Cookies-shm"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) fs.copyFileSync(p, path.join(tmp, f));
    }
    const db = new DatabaseSync(path.join(tmp, "Cookies"));
    try {
      const rows = db
        .prepare("SELECT host_key, name, value, encrypted_value FROM cookies WHERE host_key LIKE '%riotgames%'")
        .all() as unknown as CookieRow[];
      const prefixes = new Set<string>();
      for (const r of rows) {
        if (r.encrypted_value && r.encrypted_value.length >= 3) {
          prefixes.add(Buffer.from(r.encrypted_value.subarray(0, 3)).toString("latin1"));
        }
      }
      return { rows, prefixes };
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Find a usable Riot cookie set in installed Chrome profiles (macOS + Windows). */
export async function harvestChromeRiotCookies(): Promise<HarvestResult> {
  const plat = process.platform;
  if (plat !== "darwin" && plat !== "win32") {
    return { skip: `cookie harvest supports macOS and Windows only (this platform: ${plat})` };
  }
  let lastSkip = "no Riot session found in installed Chrome profiles";
  for (const root of chromeRoots()) {
    for (const name of listProfiles(root)) {
      const { rows, prefixes } = await readRiotRows(path.join(root, name));
      if (!rows.length) continue;
      let key: Buffer | null;
      if (plat === "darwin") {
        key = deriveMacKey(await chromeKeychainSecret());
      } else {
        key = await windowsAesKey(root);
        if (!key) {
          lastSkip = "could not unwrap Chrome's DPAPI key (Local State) — use the login window";
          continue;
        }
      }
      const decrypt = plat === "darwin" ? decryptChromiumValue : decryptWindowsValue;
      const cookies: BrowserCookie[] = [];
      for (const r of rows) {
        let value: string | null = r.value && r.value.length ? r.value : null;
        if (!value && r.encrypted_value && r.encrypted_value.length) {
          value = decrypt(Buffer.from(r.encrypted_value), key, r.host_key);
        }
        if (value) cookies.push({ name: r.name, value, domain: r.host_key });
      }
      if (cookies.some((c) => c.name === "ssid")) return { cookies, profile: name };
      lastSkip = prefixes.has("v20")
        ? "Chrome uses app-bound encryption (v20) — cannot read externally"
        : `profile “${name}” has Riot cookies but no usable ssid`;
    }
  }
  return { skip: lastSkip };
}
