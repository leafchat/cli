import { describe, expect, test } from "vitest";
import { fakeClock, fakeFetch } from "../test/fakes.ts";
import { createLeafchatSyncApi } from "./leafchat-api.ts";

const KEY = `lck_${"A".repeat(43)}`;

const REQUEST = {
  files: [],
  confirmedDeletes: [],
  dryRun: true,
  client: null,
} as const;

const create = (
  over: Partial<Parameters<typeof createLeafchatSyncApi>[0]> = {},
) =>
  createLeafchatSyncApi({
    baseUrl: "https://api.leafchat.app",
    apiKey: KEY,
    sourceId: "src-1",
    userAgent: "leafchat-cli/0.1.0 node/24.11.0",
    fetch: fakeFetch([]).fetch,
    sleep: fakeClock().clock.sleep,
    ...over,
  });

const problemResponse = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", ...headers },
  });

describe("leafchat の API の口", () => {
  test.each([
    { label: "http の URL", over: { baseUrl: "http://api.leafchat.app" } },
    { label: "URL でない値", over: { baseUrl: "api.leafchat.app" } },
    { label: "形の違う鍵", over: { apiKey: "lck_short" } },
    { label: "形の違うソースの ID", over: { sourceId: "src/1" } },
  ])("$label は作る時点で拒む", ({ over }) => {
    const creating = () => create(over);

    expect(creating).toThrow();
  });

  test.each([
    "https://api.leafchat.app",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
    "http://[::1]:8787",
  ])("%s は作れる（開発用の localhost を含む）", (baseUrl) => {
    const creating = () => create({ baseUrl });

    expect(creating).not.toThrow();
  });

  test("problem+json を読み、Retry-After を秒で返す", async () => {
    const fake = fakeFetch([
      () =>
        problemResponse(
          429,
          {
            type: "about:blank",
            title: "Too Many Requests",
            status: 429,
            code: "rate_limited",
            detail: "60 秒ほど待ってからやり直してください。",
          },
          { "retry-after": "60" },
        ),
    ]);
    const api = create({ fetch: fake.fetch });

    const result = await api.sync(REQUEST);

    expect(result).toEqual({
      ok: false,
      error: {
        status: 429,
        code: "rate_limited",
        detail: "60 秒ほど待ってからやり直してください。",
        retryAfterSeconds: 60,
        extensions: {},
      },
    });
  });

  test("problem+json の追加の項目を extensions に入れる", async () => {
    const fake = fakeFetch([
      () =>
        problemResponse(409, {
          status: 409,
          code: "delete_limit_exceeded",
          detail: "削除の数が上限を超えます。",
          unconfirmed: ["共通/旧料金表.pdf"],
        }),
    ]);
    const api = create({ fetch: fake.fetch });

    const result = await api.sync(REQUEST);

    expect(result).toMatchObject({
      ok: false,
      error: { extensions: { unconfirmed: ["共通/旧料金表.pdf"] } },
    });
  });

  test("通信の失敗を 2 回までやり直し、誤りの文に鍵が出ない", async () => {
    const failing = () => new Error(`connect ECONNREFUSED (Bearer ${KEY})`);
    const fake = fakeFetch([failing, failing, failing]);
    const clock = fakeClock();
    const api = create({ fetch: fake.fetch, sleep: clock.clock.sleep });

    const message = await api.sync(REQUEST).catch((e: Error) => e.message);

    expect({
      message,
      tries: fake.requests.length,
      sleeps: clock.sleeps,
    }).toEqual({
      message:
        "leafchat に接続できません（connect ECONNREFUSED (Bearer ***)）。",
      tries: 3,
      sleeps: [2000, 4000],
    });
  });

  test("同期の要求は、送り手の情報の null を省いた API の形で送り、鍵と転送の拒否を付ける", async () => {
    const fake = fakeFetch([() => problemResponse(404, { code: "not_found" })]);
    const api = create({ fetch: fake.fetch });

    await api.sync({
      files: [
        {
          path: "共通/営業時間.md",
          content: "# 営業時間\n",
          content_type: "text/markdown",
        },
      ],
      confirmedDeletes: ["共通/旧料金表.pdf"],
      dryRun: false,
      client: {
        name: "leafchat-cli",
        version: "0.1.0",
        ci: null,
        repository: null,
        runUrl: null,
      },
    });

    expect({
      url: fake.requests[0]?.url,
      authorization: fake.requests[0]?.headers.authorization,
      redirect: fake.requests[0]?.redirect,
      body: JSON.parse(fake.requests[0]?.body ?? "null"),
    }).toEqual({
      url: "https://api.leafchat.app/api/v1/knowledge/sources/src-1/sync",
      authorization: `Bearer ${KEY}`,
      redirect: "error",
      body: {
        files: [
          {
            path: "共通/営業時間.md",
            content: "# 営業時間\n",
            content_type: "text/markdown",
          },
        ],
        confirmed_deletes: ["共通/旧料金表.pdf"],
        allow_empty: false,
        dry_run: false,
        client: { name: "leafchat-cli", version: "0.1.0" },
      },
    });
  });
});
