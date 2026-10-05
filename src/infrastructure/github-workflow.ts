import * as core from "@actions/core";

/** 注釈の位置と見出し。file はリポジトリのルートからのパス。 */
export type Annotation = Readonly<{ title: string; file?: string }>;

/**
 * GitHub Actions のランナーとのやりとり（入力・ログ・注釈・出力・ジョブの要約・失敗）。
 * Why @actions/core を包むか: Action の振る舞いのテストにフェイクを渡す。注釈と出力の書き方（エスケープ・GITHUB_OUTPUT）は包みに任せる。
 */
export type GithubWorkflow = {
  getInput(name: string): string;
  /** 以後のログで、この値を *** に伏せる。 */
  setSecret(value: string): void;
  info(text: string): void;
  notice(text: string, annotation?: Annotation): void;
  warning(text: string, annotation?: Annotation): void;
  error(text: string, annotation?: Annotation): void;
  setOutput(name: string, value: string): void;
  appendSummary(markdown: string): Promise<void>;
  setFailed(text: string): void;
};

export const githubWorkflow: GithubWorkflow = {
  getInput: (name) => core.getInput(name),
  setSecret: (value) => core.setSecret(value),
  info: (text) => core.info(text),
  notice: (text, annotation) => core.notice(text, annotation),
  warning: (text, annotation) => core.warning(text, annotation),
  error: (text, annotation) => core.error(text, annotation),
  setOutput: (name, value) => core.setOutput(name, value),
  appendSummary: async (markdown) => {
    await core.summary.addRaw(markdown, true).write();
  },
  setFailed: (text) => core.setFailed(text),
};
