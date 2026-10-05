import type { z } from "zod";
import { err, ok, type Result } from "../domain/result.ts";
import type {
  ApiDocument,
  ApiProblem,
  SyncRequestBody,
  SyncResponse,
  UploadAccepted,
} from "../domain/sync-contract.ts";
import type { components } from "./generated/leafchat-api.d.ts";
import {
  documentPageSchema,
  syncResponseSchema,
  uploadAcceptedSchema,
} from "./leafchat-schemas.ts";

export type ApiResult<T> = Result<T, ApiProblem>;

export type LeafchatSyncApi = {
  sync(body: SyncRequestBody): Promise<ApiResult<SyncResponse>>;
  upload(params: {
    sha256: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<ApiResult<UploadAccepted>>;
  /** 同期のソースの文書を全部読む（ページをたどる）。 */
  listDocuments(): Promise<ApiResult<ApiDocument[]>>;
};

type WireSyncRequest = components["schemas"]["SyncRequest"];

const API_KEY_PATTERN = /^lck_[A-Za-z0-9_-]{43}$/;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RETRY_DELAYS_MS = [2_000, 4_000];
// Why 90 秒か: leafchat は 1 回の実行を 30 秒前後で区切って remaining を返す。十分な余裕を見る。
const SYNC_TIMEOUT_MS = 90_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const PROBLEM_FIELDS = new Set(["type", "title", "status", "detail", "code"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProblem = (response: Response) =>
  (response.headers.get("content-type") ?? "").includes(
    "application/problem+json",
  );

function retryAfterSeconds(headers: Headers): number | null {
  const value = headers.get("retry-after")?.trim() ?? "";
  return /^\d+$/.test(value) ? Number(value) : null;
}

async function problemOf(response: Response): Promise<ApiProblem> {
  const { status } = response;
  const base = {
    status,
    retryAfterSeconds: retryAfterSeconds(response.headers),
  };
  const body = isProblem(response)
    ? await response.json().catch(() => null)
    : await response.body?.cancel().then(() => null);
  if (!isRecord(body)) {
    return {
      ...base,
      code: "http_error",
      detail: `HTTP ${status}`,
      extensions: {},
    };
  }
  return {
    ...base,
    code: typeof body.code === "string" ? body.code : "http_error",
    detail: typeof body.detail === "string" ? body.detail : null,
    extensions: Object.fromEntries(
      Object.entries(body).filter(([key]) => !PROBLEM_FIELDS.has(key)),
    ),
  };
}

function reasonOf(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") {
    return `${timeoutMs / 1000} 秒で応答がありませんでした`;
  }
  const { cause } = error;
  const code =
    isRecord(cause) && typeof cause.code === "string" ? cause.code : null;
  return code === null ? error.message : `${error.message}：${code}`;
}

function toWireSyncRequest(request: SyncRequestBody): WireSyncRequest {
  const { client } = request;
  return {
    files: request.files.map((file) => ({ ...file })),
    confirmed_deletes: [...request.confirmedDeletes],
    // Why 常に false か: 取込済みが 0 件になると、ウィジェットが自動で非公開になる。空の一式は送らない。
    allow_empty: false,
    dry_run: request.dryRun,
    ...(client === null
      ? {}
      : {
          client: {
            name: client.name,
            version: client.version,
            ...(client.ci === null ? {} : { ci: client.ci }),
            ...(client.repository === null
              ? {}
              : { repository: client.repository }),
            ...(client.runUrl === null ? {} : { run_url: client.runUrl }),
          },
        }),
  };
}

function originOf(baseUrl: string): string {
  const url = URL.canParse(baseUrl) ? new URL(baseUrl) : null;
  // Why localhost だけ http を許すか: 開発で手元の leafchat に向けるため。それ以外は鍵を平文で流さない。
  const allowed =
    url !== null &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)));
  if (!allowed) {
    throw new Error(
      "leafchat の URL は https にしてください（開発用の http://localhost を除く）。",
    );
  }
  return url.origin;
}

export function createLeafchatSyncApi(params: {
  baseUrl: string;
  apiKey: string;
  sourceId: string;
  userAgent: string;
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
}): LeafchatSyncApi {
  const origin = originOf(params.baseUrl);
  if (!API_KEY_PATTERN.test(params.apiKey)) {
    throw new Error(
      "LEAFCHAT_API_KEY の形が違います（lck_ で始まる 47 文字）。",
    );
  }
  if (!SOURCE_ID_PATTERN.test(params.sourceId)) {
    throw new Error("ソースの ID の形が違います。");
  }
  const { apiKey } = params;
  const sourcePath = `/api/v1/knowledge/sources/${encodeURIComponent(params.sourceId)}`;
  const baseHeaders = {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json, application/problem+json",
    "user-agent": params.userAgent,
  };

  async function send(
    method: "GET" | "POST" | "PUT",
    path: string,
    timeoutMs: number,
    body?: { contentType: string; data: string | Uint8Array },
  ): Promise<Response> {
    let reason = "";
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay !== undefined) await params.sleep(delay);
      try {
        const response = await params.fetch(`${origin}${path}`, {
          method,
          headers:
            body === undefined
              ? baseHeaders
              : { ...baseHeaders, "content-type": body.contentType },
          body: body?.data,
          // Why 転送を拒むか: 鍵を付けた要求を、ほかの送り先へ運ばせない。
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Why problem+json でない 5xx を通信の失敗として扱うか: Cloudflare の 520 番台などの HTML で、leafchat が返した誤りではない。
        if (response.status < 500 || isProblem(response)) return response;
        reason = `HTTP ${response.status}`;
        await response.body?.cancel();
      } catch (error) {
        reason = reasonOf(error, timeoutMs);
      }
    }
    // Why 鍵を伏せるか: 誤りの文は端末と CI のログに出る。通信の誤りの文に鍵が混ざっても漏らさない。
    throw new Error(
      `leafchat に接続できません（${reason.replaceAll(apiKey, "***")}）。`,
    );
  }

  async function parse<T>(
    response: Response,
    schema: z.ZodType<T>,
    path: string,
  ): Promise<ApiResult<T>> {
    if (!response.ok) return err(await problemOf(response));
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new Error(`leafchat の応答の形が想定と違います（${path}）。`);
    }
    return ok(parsed.data);
  }

  return {
    async sync(request) {
      const path = `${sourcePath}/sync`;
      const response = await send("POST", path, SYNC_TIMEOUT_MS, {
        contentType: "application/json",
        data: JSON.stringify(toWireSyncRequest(request)),
      });
      return parse(response, syncResponseSchema, path);
    },

    async upload({ sha256, contentType, bytes }) {
      const path = `${sourcePath}/uploads/${encodeURIComponent(sha256)}`;
      const response = await send("PUT", path, UPLOAD_TIMEOUT_MS, {
        contentType,
        data: bytes,
      });
      return parse(response, uploadAcceptedSchema, path);
    },

    async listDocuments() {
      const path = "/api/v1/knowledge/documents";
      const documents: ApiDocument[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({
          source_id: params.sourceId,
          limit: String(PAGE_SIZE),
        });
        if (cursor !== null) query.set("cursor", cursor);
        const response = await send("GET", `${path}?${query}`, LIST_TIMEOUT_MS);
        const result = await parse(response, documentPageSchema, path);
        if (!result.ok) return result;
        documents.push(...result.value.documents);
        cursor = result.value.next_cursor;
        if (cursor === null) return ok(documents);
      }
      throw new Error(
        `同期のソースの文書が ${MAX_PAGES * PAGE_SIZE} 件を超え、一覧を読み切れません。`,
      );
    },
  };
}
