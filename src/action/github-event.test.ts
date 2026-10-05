import { describe, expect, test } from "vitest";
import { githubEventOf } from "./github-event.ts";

const BEFORE = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const pullRequest = (headRepo: { full_name: string } | null) => ({
  number: 7,
  pull_request: {
    number: 7,
    head: { repo: headRepo },
    base: { repo: { full_name: "acme/handbook" } },
  },
});

describe("GitHub のイベント", () => {
  test.each([
    {
      label: "同じリポジトリからの PR",
      name: "pull_request",
      payload: pullRequest({ full_name: "acme/handbook" }),
      expected: { kind: "pull_request", number: 7, fromFork: false },
    },
    {
      label: "フォークからの PR",
      name: "pull_request",
      payload: pullRequest({ full_name: "someone/handbook" }),
      expected: { kind: "pull_request", number: 7, fromFork: true },
    },
    {
      label: "フォークが消された PR（head.repo が null）",
      name: "pull_request",
      payload: pullRequest(null),
      expected: { kind: "pull_request", number: 7, fromFork: true },
    },
    {
      label: "中身の読めない PR（番号もリポジトリも無い）",
      name: "pull_request",
      payload: {},
      expected: { kind: "pull_request", number: null, fromFork: true },
    },
    {
      label: "PR のレビュー（PR と同じに扱う）",
      name: "pull_request_review",
      payload: pullRequest({ full_name: "acme/handbook" }),
      expected: { kind: "pull_request", number: 7, fromFork: false },
    },
    {
      label: "pull_request_target",
      name: "pull_request_target",
      payload: pullRequest({ full_name: "someone/handbook" }),
      expected: { kind: "pull_request_target" },
    },
    {
      label: "push（before を読む）",
      name: "push",
      payload: { before: BEFORE },
      expected: { kind: "push", before: BEFORE },
    },
    {
      label: "新しいブランチへの push（before が全て 0 なら無い）",
      name: "push",
      payload: { before: "0".repeat(40) },
      expected: { kind: "push", before: null },
    },
    {
      label: "workflow_dispatch",
      name: "workflow_dispatch",
      payload: { inputs: {} },
      expected: { kind: "other" },
    },
  ])("$label を見分ける", ({ name, payload, expected }) => {
    const event = githubEventOf({ name, payload });

    expect(event).toEqual(expected);
  });
});
