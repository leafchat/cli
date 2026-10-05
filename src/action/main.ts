import { posix } from "node:path";
import { appliedText, failureText, progressText } from "../cli/messages.ts";
import { CLI_VERSION } from "../cli/version.ts";
import type { Finding } from "../domain/local-check.ts";
import {
  findingText,
  hasChanges,
  type MarkdownContext,
  type MarkdownOptions,
  type PlanView,
  planJson,
  renderCheckMarkdown,
  renderFailureMarkdown,
  renderPlanMarkdown,
} from "../domain/report.ts";
import { err, ok, type Result } from "../domain/result.ts";
import type { SyncExecuted } from "../domain/sync-contract.ts";
import { clientInfoOf } from "../infrastructure/ci-env.ts";
import type { Clock } from "../infrastructure/clock.ts";
import type { TreeReader } from "../infrastructure/fs-tree.ts";
import type { GitHistory } from "../infrastructure/git-history.ts";
import type { PrCommentClient } from "../infrastructure/github-pr-comment.ts";
import type { GithubWorkflow } from "../infrastructure/github-workflow.ts";
import type { LeafchatSyncApi } from "../infrastructure/leafchat-api.ts";
import { applySync, type ProgressEvent } from "../use-cases/apply-sync.ts";
import { checkTree } from "../use-cases/check-tree.ts";
import { planSync } from "../use-cases/plan-sync.ts";
import type { SyncFailure } from "../use-cases/sync-steps.ts";
import { type GithubEvent, githubEventOf } from "./github-event.ts";
import { type ActionInputs, readInputs } from "./inputs.ts";
import { ACTION_MESSAGES } from "./messages.ts";

/** Action の入出力と、具象の組み立て。entry.ts が本物を、テストがフェイクを渡す。 */
export type ActionIo = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  /** GITHUB_WORKSPACE。 */
  workspace: string;
  workflow: GithubWorkflow;
  /** GITHUB_EVENT_PATH の JSON（無い・読めなければ null）。 */
  eventPayload: unknown;
  realpath(path: string): string;
  tree(root: string): TreeReader;
  api(params: {
    baseUrl: string;
    apiKey: string;
    sourceId: string;
    userAgent: string;
  }): LeafchatSyncApi;
  git: GitHistory;
  clock: Clock;
  prComments(token: string): PrCommentClient;
  /** 計画の JSON を書き、そのパスを返す。 */
  writePlanFile(json: string): Promise<string>;
}>;

type Run =
  | Readonly<{ kind: "check"; notice: string | null }>
  | Readonly<{ kind: "plan" | "apply"; apiKey: string; sourceId: string }>;

// Why 65,000 か: GitHub の PR のコメントは 65,536 文字まで。目印の行の分を残す。
const COMMENT_MAX_CHARS = 65_000;
// Why 340,000 か: ジョブの要約は 1 MiB まで。UTF-16 の 1 単位は UTF-8 で 3 バイトまでなので、文字数で 1 MiB の 3 分の 1 を下回る。
const SUMMARY_MAX_CHARS = 340_000;
const WAIT_TIMEOUT_MINUTES = 20;

const USER_AGENT = `leafchat-cli/${CLI_VERSION} (github-action) node/${process.versions.node}`;

/**
 * イベントと入力から、何をするかを決める。
 * Why PR では反映しないか: PR の中身はまだ main に入っていない。反映は main への push で行う。
 * Why 鍵が無い PR は検査に落とすか: フォークと Dependabot からの PR には、GitHub が秘密を渡さない。失敗にすると、外からの PR がいつも赤くなる。
 */
function runOf(inputs: ActionInputs, event: GithubEvent): Result<Run, string> {
  if (event.kind === "pull_request_target") {
    return err(ACTION_MESSAGES.pullRequestTarget);
  }
  if (event.kind === "pull_request" && inputs.mode === "apply") {
    return err(ACTION_MESSAGES.applyOnPullRequest);
  }
  if (inputs.mode === "check") return ok({ kind: "check", notice: null });
  if (
    event.kind === "pull_request" &&
    (event.fromFork || inputs.apiKey === null)
  ) {
    return ok({ kind: "check", notice: ACTION_MESSAGES.fallbackToCheck });
  }
  if (inputs.apiKey === null) {
    return err(ACTION_MESSAGES.apiKeyMissing(inputs.mode));
  }
  if (inputs.sourceId === null) return err(ACTION_MESSAGES.sourceMissing);
  return ok({
    kind: inputs.mode,
    apiKey: inputs.apiKey,
    sourceId: inputs.sourceId,
  });
}

const isMilestone = (event: ProgressEvent) =>
  event.kind !== "upload" || event.done === event.total;

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** 要約とコメントの Markdown を、それぞれの上限で作る。 */
type Render = (options: Required<MarkdownOptions>) => string;

/** 1 回の Action の実行で共有するもの。 */
type Session = Readonly<{
  io: ActionIo;
  inputs: ActionInputs;
  event: GithubEvent;
  context: MarkdownContext;
  runUrl: string | null;
}>;

function annotate(session: Session, findings: readonly Finding[]): void {
  const { workflow } = session.io;
  for (const finding of findings) {
    const annotation = {
      title: ACTION_MESSAGES.annotationTitle(finding.severity),
      ...(finding.path === null
        ? {}
        : { file: posix.join(session.inputs.displayPath, finding.path) }),
    };
    const text = findingText(finding);
    if (finding.severity === "error") workflow.error(text, annotation);
    else workflow.warning(text, annotation);
  }
}

async function writeSummary(session: Session, render: Render): Promise<void> {
  try {
    await session.io.workflow.appendSummary(
      render({
        context: session.context,
        maxChars: SUMMARY_MAX_CHARS,
        omitted: ACTION_MESSAGES.summaryOmitted,
      }),
    );
  } catch (error) {
    session.io.workflow.warning(ACTION_MESSAGES.summaryFailed(reasonOf(error)));
  }
}

/**
 * PR の固定のコメントを書く（同じリポジトリからの PR で、comment が true のときだけ）。
 * Why フォークの PR では書かないか: GITHUB_TOKEN が読み取りだけで、書けずに注意が出るだけになる。
 * Why 失敗にしないか: コメントは計画を見やすくするだけ。権限の設定漏れで同期の確認そのものを赤くしない。
 */
async function writeComment(
  session: Session,
  sourceId: string | null,
  render: Render,
): Promise<void> {
  const { inputs, event, io } = session;
  if (
    !inputs.comment ||
    inputs.githubToken === null ||
    event.kind !== "pull_request" ||
    event.number === null ||
    event.fromFork
  ) {
    return;
  }
  // Why 入力を URL の形に符号化するか: 目印は HTML のコメント。パスに --> があってもコメントを閉じさせない。
  const marker = `<!-- leafchat-cli:plan source=${encodeURIComponent(sourceId ?? "")} path=${encodeURIComponent(inputs.displayPath)} -->`;
  const body = render({
    context: session.context,
    maxChars: COMMENT_MAX_CHARS - marker.length - 1,
    omitted: (count) => ACTION_MESSAGES.commentOmitted(count, session.runUrl),
  });
  try {
    await io
      .prComments(inputs.githubToken)
      .upsert({ pr: event.number, marker, body: `${marker}\n${body}` });
  } catch (error) {
    io.workflow.warning(ACTION_MESSAGES.commentFailed(reasonOf(error)));
  }
}

async function writeOutputs(
  session: Session,
  input: Parameters<typeof planJson>[0],
): Promise<void> {
  const { workflow } = session.io;
  const changes = input.view !== null && hasChanges(input.view.plan);
  workflow.setOutput("has-changes", changes ? "true" : "false");
  const path = await session.io.writePlanFile(
    `${JSON.stringify(planJson(input), null, 2)}\n`,
  );
  workflow.setOutput("plan-file", path);
}

async function runCheck(session: Session, notice: string | null) {
  const { io, inputs } = session;
  const result = await checkTree({ tree: io.tree(inputs.path) });
  const errors = result.findings.filter((f) => f.severity === "error").length;
  if (notice !== null) io.workflow.notice(notice);
  annotate(session, result.findings);
  const render = (options: Parameters<typeof renderCheckMarkdown>[1]) =>
    renderCheckMarkdown(
      { fileCount: result.files.length, findings: result.findings },
      { ...options, ...(notice === null ? {} : { notice }) },
    );
  await writeSummary(session, render);
  await writeComment(session, inputs.sourceId, render);
  await writeOutputs(session, {
    command: "check",
    sourceId: inputs.sourceId,
    view: null,
    findings: result.findings,
    executed: [],
    error:
      errors > 0
        ? {
            code: "local_check_failed",
            message: ACTION_MESSAGES.checkFailed(errors),
          }
        : null,
  });
  if (errors > 0) io.workflow.setFailed(ACTION_MESSAGES.checkFailed(errors));
  else io.workflow.info(ACTION_MESSAGES.checkPassed(result.files.length));
}

async function fail(
  session: Session,
  command: "plan" | "apply",
  sourceId: string,
  failure: SyncFailure,
): Promise<void> {
  const text = failureText(failure, WAIT_TIMEOUT_MINUTES);
  const findings =
    failure.kind === "local_check_failed" ? failure.findings : [];
  annotate(session, findings);
  const render = (options: Parameters<typeof renderCheckMarkdown>[1]) =>
    failure.kind === "local_check_failed"
      ? renderCheckMarkdown({ fileCount: 0, findings }, options)
      : renderFailureMarkdown({ command, sourceId, text }, options);
  await writeSummary(session, render);
  if (command === "plan") await writeComment(session, sourceId, render);
  await writeOutputs(session, {
    command,
    sourceId,
    view: null,
    findings,
    executed: [],
    error: { code: failure.kind, message: text },
  });
  session.io.workflow.setFailed(text);
}

async function runPlan(
  session: Session,
  run: { apiKey: string; sourceId: string },
) {
  const { io, inputs } = session;
  const result = await planSync(
    {
      tree: io.tree(inputs.path),
      api: connect(io, inputs, run),
      clock: io.clock,
    },
    { sourceId: run.sourceId, client: clientInfoOf(io.env, CLI_VERSION) },
  );
  if (!result.ok) return fail(session, "plan", run.sourceId, result.error);
  const view = result.value;
  annotate(session, view.findings);
  const render = (options: Parameters<typeof renderPlanMarkdown>[1]) =>
    renderPlanMarkdown(view, options);
  await writeSummary(session, render);
  await writeComment(session, run.sourceId, render);
  await writeOutputs(session, planOutput("plan", run.sourceId, view, []));
  io.workflow.info(ACTION_MESSAGES.planned(hasChanges(view.plan)));
}

async function runApply(
  session: Session,
  run: { apiKey: string; sourceId: string },
) {
  const { io, inputs, event } = session;
  const result = await applySync(
    {
      tree: io.tree(inputs.path),
      api: connect(io, inputs, run),
      git: io.git,
      clock: io.clock,
      // Why 確かめずに進むか: Action は対話できない。CLI の --yes と同じ（計画は PR のコメントで確かめる）。
      confirm: async () => true,
      progress: (progress) => {
        if (isMilestone(progress)) io.workflow.info(progressText(progress));
      },
    },
    {
      sourceId: run.sourceId,
      root: inputs.path,
      client: clientInfoOf(io.env, CLI_VERSION),
      named: inputs.confirmDeletes,
      confirmDeletedSince:
        inputs.confirmDeletedFiles && event.kind === "push"
          ? event.before
          : null,
      wait: inputs.wait,
      waitTimeoutMs: WAIT_TIMEOUT_MINUTES * 60_000,
    },
  );
  if (!result.ok) return fail(session, "apply", run.sourceId, result.error);
  const { view, executed, counts, outcome } = result.value;
  annotate(session, view.findings);
  const done =
    outcome === "applied" ? appliedText(counts) : ACTION_MESSAGES.unchanged;
  await writeSummary(
    session,
    (options) => `${renderPlanMarkdown(view, options)}\n${done}\n`,
  );
  await writeOutputs(
    session,
    planOutput("apply", run.sourceId, view, executed),
  );
  io.workflow.info(done);
}

const planOutput = (
  command: "plan" | "apply",
  sourceId: string,
  view: PlanView,
  executed: readonly SyncExecuted[],
): Parameters<typeof planJson>[0] => ({
  command,
  sourceId,
  view,
  findings: view.findings,
  executed,
  error: null,
});

const connect = (
  io: ActionIo,
  inputs: ActionInputs,
  run: { apiKey: string; sourceId: string },
) =>
  io.api({
    baseUrl: inputs.apiUrl,
    apiKey: run.apiKey,
    sourceId: run.sourceId,
    userAgent: USER_AGENT,
  });

/** leafchat の GitHub Action。結果はランナーへの出力（注釈・要約・出力・失敗）で返す。 */
export async function runAction(io: ActionIo): Promise<void> {
  const { workflow } = io;
  const read = readInputs({
    getInput: workflow.getInput,
    workspace: io.workspace,
    realpath: io.realpath,
  });
  if (!read.ok) {
    workflow.setFailed(
      ACTION_MESSAGES.input(read.error.input, read.error.message),
    );
    return;
  }
  const inputs = read.value;
  if (inputs.apiKey !== null) workflow.setSecret(inputs.apiKey);
  if (inputs.githubToken !== null) workflow.setSecret(inputs.githubToken);
  const event = githubEventOf({
    name: io.env.GITHUB_EVENT_NAME ?? "",
    payload: io.eventPayload,
  });
  const decided = runOf(inputs, event);
  if (!decided.ok) {
    workflow.setFailed(decided.error);
    return;
  }
  const session: Session = {
    io,
    inputs,
    event,
    context: {
      folder: inputs.displayPath,
      generatedAt: new Date(io.clock.now()).toISOString(),
      version: CLI_VERSION,
    },
    runUrl: clientInfoOf(io.env, CLI_VERSION).runUrl,
  };
  const run = decided.value;
  try {
    if (run.kind === "check") await runCheck(session, run.notice);
    else if (run.kind === "plan") await runPlan(session, run);
    else await runApply(session, run);
  } catch (error) {
    // Why 鍵を伏せるか: setSecret はログを伏せるが、誤りの文は注釈にも出る。伏せた上で失敗にする。
    const message = reasonOf(error);
    workflow.setFailed(
      inputs.apiKey === null
        ? message
        : message.replaceAll(inputs.apiKey, "***"),
    );
  }
}
