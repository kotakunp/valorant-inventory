// Optional CapMonster hCaptcha Enterprise solver for hosted password mode.
// In-browser widgets mint tokens for OUR origin (valorant.muur.app) — Riot
// rejects those. Solving with website_url = authenticate.riotgames.com works.
// Only enabled when CAPMONSTER_API_KEY is set. Never logs the API key.

const SITE_KEY = "019f1553-3845-481c-a6f5-5a60ccf6d830";
const WEBSITE_URL = "https://authenticate.riotgames.com/api/v1/login";
const CREATE_URL = "https://api.capmonster.cloud/createTask";
const RESULT_URL = "https://api.capmonster.cloud/getTaskResult";

function apiKey(): string | null {
  const k = process.env.CAPMONSTER_API_KEY?.trim();
  return k || null;
}

export function captchaSolverEnabled(): boolean {
  return apiKey() != null;
}

interface CapMonsterTask {
  type: string;
  websiteURL: string;
  websiteKey: string;
  enterprisePayload?: { rqdata: string };
}

function buildTask(rqdata: string | null): CapMonsterTask {
  const task: CapMonsterTask = {
    type: "HCaptchaTaskProxyless",
    websiteURL: WEBSITE_URL,
    websiteKey: SITE_KEY,
  };
  if (rqdata) task.enterprisePayload = { rqdata };
  return task;
}

async function postJson(url: string, body: Record<string, unknown>): Promise<any> {
  const key = apiKey();
  if (!key) throw new Error("CAPMONSTER_API_KEY not set");
  const payload: Record<string, unknown> = { clientKey: key, ...body };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  return res.json();
}

/**
 * Solve Riot's Enterprise hcaptcha for the authenticate.riotgames.com origin.
 * Returns the token string, or null when the solver is disabled / failed.
 */
export async function solveCaptcha(rqdata: string | null): Promise<string | null> {
  if (!apiKey()) return null;
  try {
    const created = await postJson(CREATE_URL, { task: buildTask(rqdata) });
    if (created?.errorId) {
      console.warn(`[capmonster] create error code=${created.errorCode}`);
      return null;
    }
    const taskId = created?.taskId;
    if (!taskId) return null;

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const result = await postJson(RESULT_URL, { taskId });
      if (result?.errorId) {
        if (result.errorCode === "ERROR_NO_SLOT_AVAILABLE") continue;
        console.warn(`[capmonster] result error code=${result.errorCode}`);
        return null;
      }
      if (result?.status === "ready") {
        const gRecaptchaResponse = result.solution?.gRecaptchaResponse;
        return typeof gRecaptchaResponse === "string" && gRecaptchaResponse
          ? gRecaptchaResponse
          : null;
      }
    }
    console.warn("[capmonster] solve timed out");
    return null;
  } catch (e) {
    console.warn(`[capmonster] solve failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
