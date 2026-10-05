export type PrCommentClient = {
  /** 目印を含み、トークンの主体が書いたコメントを直す。無ければ作る。 */
  upsert(params: {
    pr: number;
    marker: string;
    body: string;
  }): Promise<{ commentId: number; created: boolean }>;
};

type IssueComment = Readonly<{ id: number; body: string; login: string }>;

const PER_PAGE = 100;
// Why 上限を置くか: 応答が壊れていても終わるようにする。1 万件のコメントを超える PR は現実には無い。
const MAX_PAGES = 100;
// Why 2022-11-28 か: GHES でも通る版。github.com では 2028-03-10 まで使える。
const API_VERSION = "2022-11-28";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function issueCommentOf(value: unknown): IssueComment | null {
  if (!isRecord(value) || typeof value.id !== "number") return null;
  const user = isRecord(value.user) ? value.user : {};
  return {
    id: value.id,
    body: typeof value.body === "string" ? value.body : "",
    login: typeof user.login === "string" ? user.login : "",
  };
}

/**
 * PR の計画のコメントを 1 つに保つ。
 * Why 主体で絞るか: 目印は誰でも書ける。他人が目印を真似たコメントを、この Action が書き換えない。
 * Why viewer と viewer[bot] の両方と比べるか: GITHUB_TOKEN の主体は REST では github-actions[bot] で、GraphQL の viewer は [bot] の有無が定まらない（個人のトークンなら同じ名前）。
 */
export function createPrCommentClient(params: {
  token: string;
  /** GITHUB_API_URL（GHES でも動くように）。 */
  apiUrl: string;
  /** GITHUB_GRAPHQL_URL。 */
  graphqlUrl: string;
  /** owner/name。 */
  repository: string;
  fetch: typeof globalThis.fetch;
}): PrCommentClient {
  if (!REPOSITORY_PATTERN.test(params.repository)) {
    throw new Error(`リポジトリの名前の形が違います（${params.repository}）。`);
  }
  const repoPath = `/repos/${params.repository}`;

  async function request(
    method: "GET" | "POST" | "PATCH",
    url: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await params.fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${params.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        // Why user-agent を付けるか: GitHub の REST API は User-Agent の無い要求を拒む。
        "user-agent": "leafchat-cli",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
    });
    // Why 応答の本文を例外に入れないか: 例外の文は Actions のログと注釈に出る。中身を確かめられない外の文字列を、そのまま出さない。
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `GitHub API が ${response.status} を返しました（${method} ${path}）`,
      );
    }
    return response.json();
  }

  async function viewerLogin(): Promise<string> {
    const data = await request("POST", params.graphqlUrl, "/graphql", {
      query: "query { viewer { login } }",
    });
    const viewer =
      isRecord(data) && isRecord(data.data) && isRecord(data.data.viewer)
        ? data.data.viewer
        : {};
    if (typeof viewer.login !== "string" || viewer.login === "") {
      throw new Error(
        "GitHub の GraphQL API から、トークンの主体を読めませんでした。",
      );
    }
    return viewer.login;
  }

  async function findOwnComment(
    pr: number,
    marker: string,
    login: string,
  ): Promise<number | null> {
    const own = new Set([login, `${login}[bot]`]);
    const path = `${repoPath}/issues/${pr}/comments`;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const listed = await request(
        "GET",
        `${params.apiUrl}${path}?per_page=${PER_PAGE}&page=${page}`,
        path,
      );
      const comments = Array.isArray(listed) ? listed : [];
      const found = comments
        .map(issueCommentOf)
        .find(
          (comment) =>
            comment !== null &&
            own.has(comment.login) &&
            comment.body.includes(marker),
        );
      if (found) return found.id;
      if (comments.length < PER_PAGE) return null;
    }
    return null;
  }

  return {
    async upsert({ pr, marker, body }) {
      const login = await viewerLogin();
      const id = await findOwnComment(pr, marker, login);
      if (id !== null) {
        const path = `${repoPath}/issues/comments/${id}`;
        await request("PATCH", `${params.apiUrl}${path}`, path, { body });
        return { commentId: id, created: false };
      }
      const path = `${repoPath}/issues/${pr}/comments`;
      const created = issueCommentOf(
        await request("POST", `${params.apiUrl}${path}`, path, { body }),
      );
      if (created === null) {
        throw new Error(
          "GitHub API の応答から、作ったコメントを読めませんでした。",
        );
      }
      return { commentId: created.id, created: true };
    },
  };
}
