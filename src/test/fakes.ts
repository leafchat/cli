import type {
  ApiDocument,
  SyncRequestBody,
  SyncResponse,
  UploadAccepted,
} from "../domain/sync-contract.ts";
import type { TreeReader } from "../infrastructure/fs-tree.ts";
import type { GitHistory } from "../infrastructure/git-history.ts";
import type { PrCommentClient } from "../infrastructure/github-pr-comment.ts";
import type {
  Annotation,
  GithubWorkflow,
} from "../infrastructure/github-workflow.ts";
import type {
  ApiResult,
  LeafchatSyncApi,
} from "../infrastructure/leafchat-api.ts";

// ポートの手書きのフェイク。呼ばれたことではなく、外への出力（HTTP の要求・git に渡した引数）を記録する。

type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  redirect: string | null;
};

/**
 * 応答の列を順に返す fetch。要求を requests に積む（ヘッダーの名前は小文字）。
 * 列の要素が Error なら、その要求で投げる（通信の失敗）。列を使い切ったら失敗する。
 */
export function fakeFetch(responses: readonly (() => Response | Error)[]): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];
  return {
    requests,
    fetch: async (input, init) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        headers: Object.fromEntries(new Headers(init?.headers)),
        body: typeof init?.body === "string" ? init.body : null,
        redirect: init?.redirect ?? null,
      });
      const next = queue.shift();
      if (next === undefined) throw new Error("fakeFetch: 応答を使い切った");
      const response = next();
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

/** now は、start に sleep に渡した時間の合計を足した値。待った時間を sleeps に積む。 */
export function fakeClock(start = 0): {
  clock: { now(): number; sleep(ms: number): Promise<void> };
  sleeps: number[];
} {
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => start + sleeps.reduce((sum, ms) => sum + ms, 0),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  };
}

const encoder = new TextEncoder();

type FakeFile = Readonly<{
  path: string;
  content: string | Uint8Array;
  /** 既定は 0 の並び。アップロードを見分けるテストでは違う値を入れる。 */
  sha256?: string;
  kind?: "file" | "symlink";
}>;

/** 決まったファイルを返すツリー。パスは NFC のまま originalPath にも使う。 */
export function fakeTree(files: readonly FakeFile[]): TreeReader {
  const bytesOf = (file: FakeFile) =>
    typeof file.content === "string"
      ? encoder.encode(file.content)
      : file.content;
  const find = (path: string) => {
    const file = files.find((f) => f.path === path);
    if (file === undefined) throw new Error(`fakeTree: ${path} はありません`);
    return file;
  };
  return {
    list: async () => ({
      entries: files.map((file) => ({
        path: file.path,
        originalPath: file.path,
        size: file.kind === "symlink" ? 0 : bytesOf(file).byteLength,
        kind: file.kind ?? "file",
        head: bytesOf(file).subarray(0, 1024),
      })),
      truncated: false,
    }),
    sha256: async (path) => find(path).sha256 ?? "0".repeat(64),
    read: async (path) => bytesOf(find(path)),
  };
}

/** 列の先頭から順に返し、最後の 1 つは使い切らずに返し続ける。 */
function sticky<T>(values: readonly T[], name: string): () => T {
  const queue = [...values];
  return () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) throw new Error(`${name}: 応答がありません`);
    return next;
  };
}

/**
 * leafchat の同期の API。sync・upload・listDocuments は、それぞれの応答の列を順に返す（最後の応答は繰り返す）。
 * 同期の要求を syncRequests に、上げたファイルを uploads に積む。
 */
export function fakeSyncApi(responses: {
  sync?: readonly ApiResult<SyncResponse>[];
  upload?: readonly ApiResult<UploadAccepted>[];
  documents?: readonly ApiResult<ApiDocument[]>[];
}): {
  api: LeafchatSyncApi;
  syncRequests: SyncRequestBody[];
  uploads: { sha256: string; contentType: string; text: string }[];
} {
  const nextSync = sticky(responses.sync ?? [], "fakeSyncApi.sync");
  const nextUpload = sticky(responses.upload ?? [], "fakeSyncApi.upload");
  const nextDocuments = sticky(
    responses.documents ?? [],
    "fakeSyncApi.listDocuments",
  );
  const syncRequests: SyncRequestBody[] = [];
  const uploads: { sha256: string; contentType: string; text: string }[] = [];
  const decoder = new TextDecoder();
  return {
    syncRequests,
    uploads,
    api: {
      sync: async (body) => {
        syncRequests.push(body);
        return nextSync();
      },
      upload: async ({ sha256, contentType, bytes }) => {
        uploads.push({ sha256, contentType, text: decoder.decode(bytes) });
        return nextUpload();
      },
      listDocuments: async () => nextDocuments(),
    },
  };
}

/** git の履歴。消えたパス（null は履歴が読めない）を返し、聞かれた ref を refs に積む。 */
export function fakeGitHistory(deleted: readonly string[] | null): {
  git: GitHistory;
  refs: string[];
} {
  const refs: string[] = [];
  return {
    refs,
    git: {
      deletedSince: async ({ ref }) => {
        refs.push(ref);
        return deleted === null ? null : [...deleted];
      },
    },
  };
}

/** 実体のパスの表を引く realpath。表に無いパスは、無いものとして投げる（fs.realpathSync と同じ）。 */
export function fakeRealpath(
  realPaths: Readonly<Record<string, string>>,
): (path: string) => string {
  return (path) => {
    const real = realPaths[path];
    if (real === undefined) {
      throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
    }
    return real;
  };
}

type RecordedAnnotation = {
  level: "notice" | "warning" | "error";
  text: string;
  title: string | null;
  file: string | null;
};

/**
 * GitHub Actions のランナー。inputs に無い入力は空文字（@actions/core と同じ）。
 * ランナーへの出力（注釈・ログ・出力・要約・失敗・伏せた値）を積む。
 */
export function fakeWorkflow(inputs: Readonly<Record<string, string>>): {
  workflow: GithubWorkflow;
  annotations: RecordedAnnotation[];
  logs: string[];
  outputs: Record<string, string>;
  summaries: string[];
  failures: string[];
  secrets: string[];
} {
  const annotations: RecordedAnnotation[] = [];
  const logs: string[] = [];
  const outputs: Record<string, string> = {};
  const summaries: string[] = [];
  const failures: string[] = [];
  const secrets: string[] = [];
  const annotate =
    (level: RecordedAnnotation["level"]) =>
    (text: string, annotation?: Annotation) => {
      annotations.push({
        level,
        text,
        title: annotation?.title ?? null,
        file: annotation?.file ?? null,
      });
    };
  return {
    annotations,
    logs,
    outputs,
    summaries,
    failures,
    secrets,
    workflow: {
      getInput: (name) => inputs[name] ?? "",
      setSecret: (value) => {
        secrets.push(value);
      },
      info: (text) => {
        logs.push(text);
      },
      notice: annotate("notice"),
      warning: annotate("warning"),
      error: annotate("error"),
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      appendSummary: async (markdown) => {
        summaries.push(markdown);
      },
      setFailed: (text) => {
        failures.push(text);
      },
    },
  };
}

/** PR のコメント。書いたコメントを upserts に積む。error を渡すと、その例外で失敗する（権限が無い など）。 */
export function fakePrComments(error: Error | null = null): {
  client: PrCommentClient;
  upserts: { pr: number; marker: string; body: string }[];
} {
  const upserts: { pr: number; marker: string; body: string }[] = [];
  return {
    upserts,
    client: {
      upsert: async (params) => {
        if (error !== null) throw error;
        upserts.push(params);
        return { commentId: upserts.length, created: upserts.length === 1 };
      },
    },
  };
}
