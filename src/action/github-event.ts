export type GithubEvent =
  | Readonly<{
      kind: "pull_request";
      /** PR の番号（読めなければ null。コメントしない）。 */
      number: number | null;
      fromFork: boolean;
    }>
  | Readonly<{ kind: "pull_request_target" }>
  | Readonly<{
      kind: "push";
      /** push の前のコミット。新しいブランチへの push などで無ければ null。 */
      before: string | null;
    }>
  | Readonly<{ kind: "other" }>;

const COMMIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// Why 全て 0 を「無い」とするか: 新しいブランチへの push で、GitHub は before に 0 の並びを入れる。
const NO_COMMIT = /^0+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fullNameOf = (repo: unknown) =>
  isRecord(repo) && typeof repo.full_name === "string" ? repo.full_name : null;

/**
 * GITHUB_EVENT_NAME と GITHUB_EVENT_PATH の JSON から、Action の振る舞いを決めるイベントの種類を読む。
 * Why pull_request_review なども PR とみなすか: どれも PR の中身で動き、フォークからなら秘密が渡らない。PR のイベントでは反映しない。
 */
export function githubEventOf(params: {
  name: string;
  payload: unknown;
}): GithubEvent {
  const payload = isRecord(params.payload) ? params.payload : {};
  if (params.name === "pull_request_target") {
    return { kind: "pull_request_target" };
  }
  if (params.name.startsWith("pull_request")) {
    const pr = isRecord(payload.pull_request) ? payload.pull_request : {};
    const head = isRecord(pr.head) ? fullNameOf(pr.head.repo) : null;
    const base = isRecord(pr.base) ? fullNameOf(pr.base.repo) : null;
    return {
      kind: "pull_request",
      number:
        typeof pr.number === "number" && Number.isSafeInteger(pr.number)
          ? pr.number
          : null,
      // Why 名前が読めなければフォークとみなすか: フォークが消された PR では head.repo が null になる。秘密が無い前提で動くほうが安全。
      fromFork: head === null || base === null || head !== base,
    };
  }
  if (params.name === "push") {
    const before = typeof payload.before === "string" ? payload.before : "";
    return {
      kind: "push",
      before:
        COMMIT_SHA.test(before) && !NO_COMMIT.test(before) ? before : null,
    };
  }
  return { kind: "other" };
}
