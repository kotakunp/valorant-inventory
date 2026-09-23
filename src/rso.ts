export const RSO_STATE_KEY = "rso_state";
export const RSO_REGION_KEY = "rso_region";

export function makeState(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export type RsoCallback = { kind: "none" } | { kind: "error"; message: string } | { kind: "code"; code: string };

export function parseCallback(search: string, expectedState: string | null): RsoCallback {
  const p = new URLSearchParams(search);
  if (!p.has("code") && !p.has("error")) return { kind: "none" };
  if (p.has("error")) {
    return { kind: "error", message: p.get("error_description") ?? `Riot sign-in failed: ${p.get("error")}` };
  }
  const code = p.get("code");
  if (!code) return { kind: "error", message: "Riot sign-in failed: missing authorization code." };
  if (!expectedState || p.get("state") !== expectedState) {
    return { kind: "error", message: "Riot sign-in failed: state mismatch — please try again." };
  }
  return { kind: "code", code };
}
