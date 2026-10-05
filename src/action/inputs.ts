import { resolve, sep } from "node:path";
import { err, ok, type Result } from "../domain/result.ts";

type ActionMode = "check" | "plan" | "apply";

export type ActionInputs = Readonly<{
  mode: ActionMode;
  /** 同期するフォルダの実体の絶対パス（ワークスペースの中であることを確かめ済み）。 */
  path: string;
  /** 入力そのまま（表示・PR のコメントの目印・注釈のパスに使う）。 */
  displayPath: string;
  sourceId: string | null;
  apiKey: string | null;
  apiUrl: string;
  comment: boolean;
  githubToken: string | null;
  confirmDeletes: readonly string[];
  confirmDeletedFiles: boolean;
  wait: boolean;
}>;

export type InputError = Readonly<{ input: string; message: string }>;

const MODES: readonly ActionMode[] = ["check", "plan", "apply"];
const DEFAULT_API_URL = "https://api.leafchat.app";
// Why YAML 1.2 の 6 つか: @actions/core の getBooleanInput と同じ値を受ける。with: に true と書くと、ランナーは "true" を渡す。
const TRUE_VALUES = new Set(["true", "True", "TRUE"]);
const FALSE_VALUES = new Set(["false", "False", "FALSE"]);

const isMode = (value: string): value is ActionMode =>
  MODES.some((mode) => mode === value);

const nonEmpty = (value: string) => (value === "" ? null : value);

/**
 * Action の入力を読んで確かめる。
 * Why 空の値を既定とみなすか: action.yml の既定値はランナーが入れる。空になるのは `${{ vars.X }}` のような式が空のときで、既定の意味に読むのが自然。
 */
export function readInputs(params: {
  getInput: (name: string) => string;
  /** GITHUB_WORKSPACE。 */
  workspace: string;
  /** fs.realpathSync。無いパスは投げる。 */
  realpath: (path: string) => string;
}): Result<ActionInputs, InputError> {
  const input = (name: string) => params.getInput(name).trim();
  const flag = (
    name: string,
    fallback: boolean,
  ): Result<boolean, InputError> => {
    const value = input(name);
    if (value === "") return ok(fallback);
    if (TRUE_VALUES.has(value)) return ok(true);
    if (FALSE_VALUES.has(value)) return ok(false);
    return err({ input: name, message: "true か false にしてください。" });
  };

  const mode = nonEmpty(input("mode")) ?? "plan";
  if (!isMode(mode)) {
    return err({
      input: "mode",
      message: "check・plan・apply のどれかにしてください。",
    });
  }
  const located = locate(input("path"), params);
  if (!located.ok) return located;
  const comment = flag("comment", true);
  if (!comment.ok) return comment;
  const confirmDeletedFiles = flag("confirm-deleted-files", true);
  if (!confirmDeletedFiles.ok) return confirmDeletedFiles;
  const wait = flag("wait", true);
  if (!wait.ok) return wait;

  return ok({
    mode,
    path: located.value,
    displayPath: input("path"),
    sourceId: nonEmpty(input("source-id")),
    apiKey: nonEmpty(input("api-key")),
    apiUrl: nonEmpty(input("api-url")) ?? DEFAULT_API_URL,
    comment: comment.value,
    githubToken: nonEmpty(input("github-token")),
    confirmDeletes: params
      .getInput("confirm-deletes")
      .split(/\r?\n/)
      .map((line) => line.trim().normalize("NFC"))
      .filter((line) => line !== ""),
    confirmDeletedFiles: confirmDeletedFiles.value,
    wait: wait.value,
  });
}

/**
 * Why 実体のパスで比べるか: ../ だけでなく、ワークスペースの中のリンクがランナーの別の場所（~/.ssh など）を指していても送らない。
 * 走査はリンクをたどらないが、ルートそのものがリンクだと中を読んでしまう。
 */
function locate(
  path: string,
  params: { workspace: string; realpath: (path: string) => string },
): Result<string, InputError> {
  if (path === "") {
    return err({
      input: "path",
      message:
        "同期するフォルダを、リポジトリのルートからの相対パスで指定してください。",
    });
  }
  let real: string;
  try {
    real = params.realpath(resolve(params.workspace, path));
  } catch {
    return err({
      input: "path",
      message: `フォルダ「${path}」がありません。actions/checkout の後に動かしているか、パスを確かめてください。`,
    });
  }
  const workspace = params.realpath(params.workspace);
  if (real !== workspace && !real.startsWith(`${workspace}${sep}`)) {
    return err({
      input: "path",
      message: `「${path}」はワークスペースの外を指します。リポジトリの中のフォルダを指定してください。`,
    });
  }
  return ok(real);
}
