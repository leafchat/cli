import { describe, expect, test } from "vitest";
import { fakeFetch } from "../test/fakes.ts";
import { createPrCommentClient } from "./github-pr-comment.ts";

const MARKER = "<!-- leafchat-cli:plan source=src-1 path=knowledge -->";
const API = "https://api.github.com";
const COMMENTS = `${API}/repos/acme/handbook/issues/7/comments`;

/** GITHUB_TOKEN の主体（GraphQL の viewer）。 */
const viewer = (login: string) => () =>
  Response.json({ data: { viewer: { login } } });

const comment = (id: number, login: string, body: string) => ({
  id,
  body,
  user: { login },
});

const othersComments = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) =>
    comment(from + index, "octocat", "よさそうです"),
  );

const clientWith = (responses: Array<() => Response>) => {
  const fake = fakeFetch(responses);
  return {
    requests: () => fake.requests.map(({ method, url }) => `${method} ${url}`),
    client: createPrCommentClient({
      token: "ghs_token",
      apiUrl: API,
      graphqlUrl: `${API}/graphql`,
      repository: "acme/handbook",
      fetch: fake.fetch,
    }),
  };
};

describe("PR の固定のコメント", () => {
  test.each([
    { label: "GraphQL の viewer に [bot] が無い", login: "github-actions" },
    {
      label: "GraphQL の viewer に [bot] が有る",
      login: "github-actions[bot]",
    },
  ])("目印を含み、主体が自分のコメントを直す（$label）", async ({ login }) => {
    const { client, requests } = clientWith([
      viewer(login),
      () =>
        Response.json([
          comment(11, "octocat", "よさそうです"),
          comment(12, "github-actions[bot]", `${MARKER}\n古い計画`),
        ]),
      () => Response.json({ id: 12 }),
    ]);

    const result = await client.upsert({
      pr: 7,
      marker: MARKER,
      body: `${MARKER}\n新しい計画`,
    });

    expect({ result, requests: requests() }).toEqual({
      result: { commentId: 12, created: false },
      requests: [
        `POST ${API}/graphql`,
        `GET ${COMMENTS}?per_page=100&page=1`,
        `PATCH ${API}/repos/acme/handbook/issues/comments/12`,
      ],
    });
  });

  test("他人が書いた同じ目印のコメントは直さず、新しく作る", async () => {
    const { client, requests } = clientWith([
      viewer("github-actions"),
      () => Response.json([comment(21, "mallory", `${MARKER}\n偽の計画`)]),
      () => Response.json({ id: 22 }, { status: 201 }),
    ]);

    const result = await client.upsert({
      pr: 7,
      marker: MARKER,
      body: `${MARKER}\n計画`,
    });

    expect({ result, requests: requests() }).toEqual({
      result: { commentId: 22, created: true },
      requests: [
        `POST ${API}/graphql`,
        `GET ${COMMENTS}?per_page=100&page=1`,
        `POST ${COMMENTS}`,
      ],
    });
  });

  test("コメントの一覧を最後のページまで読み、3 ページ目の自分のコメントを直す", async () => {
    const { client, requests } = clientWith([
      viewer("github-actions"),
      () => Response.json(othersComments(100)),
      () => Response.json(othersComments(100, 101)),
      () =>
        Response.json([comment(201, "github-actions[bot]", `${MARKER}\n計画`)]),
      () => Response.json({ id: 201 }),
    ]);

    const result = await client.upsert({
      pr: 7,
      marker: MARKER,
      body: `${MARKER}\n新しい計画`,
    });

    expect({ result, requests: requests() }).toEqual({
      result: { commentId: 201, created: false },
      requests: [
        `POST ${API}/graphql`,
        `GET ${COMMENTS}?per_page=100&page=1`,
        `GET ${COMMENTS}?per_page=100&page=2`,
        `GET ${COMMENTS}?per_page=100&page=3`,
        `PATCH ${API}/repos/acme/handbook/issues/comments/201`,
      ],
    });
  });

  test("コメントの作成が 403 なら、状態とパスを示し、トークンを含まない例外にする", async () => {
    const { client } = clientWith([
      viewer("github-actions"),
      () => Response.json([]),
      () =>
        Response.json(
          { message: "Resource not accessible by integration" },
          { status: 403 },
        ),
    ]);

    const upserting = client.upsert({ pr: 7, marker: MARKER, body: MARKER });

    await expect(upserting).rejects.toThrow(
      /^GitHub API が 403 を返しました（POST \/repos\/acme\/handbook\/issues\/7\/comments）$/,
    );
  });
});
