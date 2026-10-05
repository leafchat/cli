import { Command, CommanderError } from "@commander-js/extra-typings";
import type { Finding } from "../domain/local-check.ts";
import {
  hasChanges,
  type Paint,
  type PlanView,
  planJson,
  renderCheckText,
  renderPlanText,
} from "../domain/report.ts";
import { err, ok, type Result } from "../domain/result.ts";
import type { SyncExecuted } from "../domain/sync-contract.ts";
import { clientInfoOf, isCi } from "../infrastructure/ci-env.ts";
import type { Clock } from "../infrastructure/clock.ts";
import type { TreeReader } from "../infrastructure/fs-tree.ts";
import type { GitHistory } from "../infrastructure/git-history.ts";
import type { LeafchatSyncApi } from "../infrastructure/leafchat-api.ts";
import { applySync, type ProgressEvent } from "../use-cases/apply-sync.ts";
import { checkTree } from "../use-cases/check-tree.ts";
import { planSync } from "../use-cases/plan-sync.ts";
import type { SyncFailure } from "../use-cases/sync-steps.ts";
import {
  appliedText,
  failureText,
  HELP_TITLES,
  MESSAGES,
  progressText,
} from "./messages.ts";
import { CLI_VERSION } from "./version.ts";

/** CLI の入出力と、具象の組み立て。bin.ts が本物を、テストがフェイクを渡す。 */
export type CliIo = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  stdout(text: string): void;
  stderr(text: string): void;
  /** stdin と stderr がどちらも端末か（確認を聞けるか）。 */
  interactive: boolean;
  /** stderr が端末か（進み具合を 1 行で書き換えるか）。 */
  stderrIsTty: boolean;
  ask(question: string): Promise<string>;
  /** 色を付ける口（端末と NO_COLOR を見る）。--no-color のときは使わない。 */
  paint: Paint;
  resolvePath(dir: string): string;
  tree(root: string): TreeReader;
  api(params: {
    baseUrl: string;
    apiKey: string;
    sourceId: string;
    userAgent: string;
  }): LeafchatSyncApi;
  git: GitHistory;
  clock: Clock;
}>;

const DEFAULT_API_URL = "https://api.leafchat.app";
const DEFAULT_WAIT_TIMEOUT_MINUTES = 20;
// Why \x0d と \x1b[2K か: 端末では進み具合を同じ行に書き換える（行頭へ戻り、行を消す）。
const REWRITE_LINE = "\x0d\x1b[2K";

const plain: Paint = (_style, text) => text;

const paintOf = (io: CliIo, color: boolean): Paint =>
  color ? io.paint : plain;

const USER_AGENT = `leafchat-cli/${CLI_VERSION} node/${process.versions.node}`;

const nonEmpty = (value: string | undefined) =>
  value === undefined || value === "" ? null : value;

type Connection = Readonly<{ api: LeafchatSyncApi; sourceId: string }>;

function connect(
  io: CliIo,
  options: { source?: string; apiUrl?: string },
): Result<Connection, string> {
  const apiKey = nonEmpty(io.env.LEAFCHAT_API_KEY);
  if (apiKey === null) return err(MESSAGES.apiKeyMissing);
  const sourceId =
    nonEmpty(options.source) ?? nonEmpty(io.env.LEAFCHAT_SOURCE_ID);
  if (sourceId === null) return err(MESSAGES.sourceMissing);
  const baseUrl =
    nonEmpty(options.apiUrl) ??
    nonEmpty(io.env.LEAFCHAT_API_URL) ??
    DEFAULT_API_URL;
  const api = io.api({ baseUrl, apiKey, sourceId, userAgent: USER_AGENT });
  return ok({ api, sourceId });
}

type JsonContext = Readonly<{
  command: "plan" | "apply";
  sourceId: string;
}>;

function writeJson(
  io: CliIo,
  context: JsonContext,
  result: {
    view: PlanView | null;
    findings: readonly Finding[];
    executed: readonly SyncExecuted[];
    error: { code: string; message: string } | null;
  },
): void {
  io.stdout(`${JSON.stringify(planJson({ ...context, ...result }))}\n`);
}

/** 失敗を stderr に書き（--json なら stdout に JSON も書き）、終了コード 1 を返す。 */
function fail(
  io: CliIo,
  json: JsonContext | null,
  code: string,
  message: string,
  findings: readonly Finding[] = [],
): number {
  io.stderr(`${message}\n`);
  if (json !== null) {
    writeJson(io, json, {
      view: null,
      findings,
      executed: [],
      error: { code, message },
    });
  }
  return 1;
}

function failSync(
  io: CliIo,
  json: JsonContext | null,
  failure: SyncFailure,
  waitTimeoutMinutes = DEFAULT_WAIT_TIMEOUT_MINUTES,
): number {
  return fail(
    io,
    json,
    failure.kind,
    failureText(failure, waitTimeoutMinutes),
    failure.kind === "local_check_failed" ? failure.findings : [],
  );
}

async function runCheck(
  io: CliIo,
  dir: string,
  options: { color: boolean },
): Promise<number> {
  const result = await checkTree({ tree: io.tree(io.resolvePath(dir)) });
  io.stdout(
    renderCheckText(
      { fileCount: result.files.length, findings: result.findings },
      paintOf(io, options.color),
    ),
  );
  return result.findings.some((f) => f.severity === "error") ? 1 : 0;
}

async function runPlan(
  io: CliIo,
  dir: string,
  options: {
    source?: string;
    apiUrl?: string;
    json?: true;
    detailedExitcode?: true;
    color: boolean;
  },
): Promise<number> {
  const connected = connect(io, options);
  const json = jsonContextOf(io, "plan", options);
  if (!connected.ok) return fail(io, json, "usage", connected.error);
  const result = await planSync(
    {
      tree: io.tree(io.resolvePath(dir)),
      api: connected.value.api,
      clock: io.clock,
    },
    {
      sourceId: connected.value.sourceId,
      client: clientInfoOf(io.env, CLI_VERSION),
    },
  );
  if (!result.ok) return failSync(io, json, result.error);
  const view = result.value;
  if (json !== null) {
    writeJson(io, json, {
      view,
      findings: view.findings,
      executed: [],
      error: null,
    });
  } else {
    io.stdout(renderPlanText(view, paintOf(io, options.color)));
  }
  return options.detailedExitcode && hasChanges(view.plan) ? 2 : 0;
}

const isMilestone = (event: ProgressEvent) =>
  event.kind !== "upload" || event.done === event.total;

async function runApply(
  io: CliIo,
  dir: string,
  options: {
    source?: string;
    apiUrl?: string;
    confirmDelete?: string[];
    confirmDeletedSince?: string;
    yes?: true;
    wait: boolean;
    waitTimeout?: string;
    json?: true;
    color: boolean;
  },
): Promise<number> {
  const json = jsonContextOf(io, "apply", options);
  // Why 先に止めるか: 計画やアップロードの後で「確認できない」と分かるより、CI の設定の誤りを最初に知らせる。
  if (!options.yes && !(io.interactive && !isCi(io.env))) {
    return fail(io, json, "usage", MESSAGES.cannotConfirm);
  }
  const waitTimeoutMinutes =
    options.waitTimeout === undefined
      ? DEFAULT_WAIT_TIMEOUT_MINUTES
      : /^[1-9]\d{0,3}$/.test(options.waitTimeout)
        ? Number(options.waitTimeout)
        : null;
  if (waitTimeoutMinutes === null) {
    return fail(io, json, "usage", MESSAGES.waitTimeoutInvalid);
  }
  const connected = connect(io, options);
  if (!connected.ok) return fail(io, json, "usage", connected.error);
  const paint = paintOf(io, options.color);
  let rewriting = false;
  const result = await applySync(
    {
      tree: io.tree(io.resolvePath(dir)),
      api: connected.value.api,
      git: io.git,
      clock: io.clock,
      confirm: async (view) => {
        const text = renderPlanText(view, paint);
        if (json !== null) io.stderr(text);
        else io.stdout(text);
        if (options.yes) return true;
        const answer = await io.ask(MESSAGES.confirmQuestion);
        return /^(y|yes)$/i.test(answer.trim());
      },
      progress: (event) => {
        if (io.stderrIsTty) {
          io.stderr(`${REWRITE_LINE}${progressText(event)}`);
          rewriting = true;
        } else if (isMilestone(event)) {
          io.stderr(`${progressText(event)}\n`);
        }
      },
    },
    {
      sourceId: connected.value.sourceId,
      root: io.resolvePath(dir),
      client: clientInfoOf(io.env, CLI_VERSION),
      named: (options.confirmDelete ?? []).map((path) => path.normalize("NFC")),
      confirmDeletedSince: options.confirmDeletedSince ?? null,
      wait: options.wait,
      waitTimeoutMs: waitTimeoutMinutes * 60_000,
    },
  );
  if (rewriting) io.stderr("\n");
  if (!result.ok) return failSync(io, json, result.error, waitTimeoutMinutes);
  const { view, executed, counts, outcome } = result.value;
  if (outcome === "unchanged" && json === null) {
    io.stdout(renderPlanText(view, paint));
  }
  if (outcome === "applied") {
    io.stderr(`${appliedText(counts)}\n`);
  }
  if (json !== null) {
    writeJson(io, json, {
      view,
      findings: view.findings,
      executed,
      error: null,
    });
  }
  return 0;
}

const jsonContextOf = (
  io: CliIo,
  command: "plan" | "apply",
  options: { source?: string; json?: true },
): JsonContext | null =>
  options.json
    ? {
        command,
        sourceId:
          nonEmpty(options.source) ?? nonEmpty(io.env.LEAFCHAT_SOURCE_ID) ?? "",
      }
    : null;

/** 例外（通信の失敗・フォルダが無い など）を文にして、終了コード 1 にする。鍵は伏せる。 */
async function guarded(
  io: CliIo,
  json: JsonContext | null,
  run: () => Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const apiKey = nonEmpty(io.env.LEAFCHAT_API_KEY);
    return fail(
      io,
      json,
      "error",
      apiKey === null ? message : message.replaceAll(apiKey, "***"),
    );
  }
}

/** leafchat の CLI。終了コード（0 成功・1 失敗・2 は plan --detailed-exitcode で変更があるとき）を返す。 */
export async function main(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  let exitCode = 0;
  const program = new Command("leafchat")
    .description("フォルダの資料を leafchat のナレッジに同期する。")
    .version(CLI_VERSION, "-v, --version", "版を出す")
    .helpOption("-h, --help", "使い方を出す")
    .helpCommand("help [command]", "コマンドの使い方を出す")
    .configureHelp({ styleTitle: (title) => HELP_TITLES[title] ?? title })
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
      // Why commander の誤りの文を出さないか: 英語の文の代わりに、日本語の文を main が出す。
      outputError: () => {},
    })
    .exitOverride();

  const sync = program
    .command("sync")
    .description("ナレッジの同期（check・plan・apply）")
    .helpCommand("help [command]", "コマンドの使い方を出す");

  sync
    .command("check")
    .description("送る前の検査だけをする（API キーは要らない）")
    .argument("<dir>", "同期するフォルダ")
    .option("--no-color", "色を付けない")
    .action(async (dir, options) => {
      exitCode = await guarded(io, null, () => runCheck(io, dir, options));
    });

  sync
    .command("plan")
    .description("サーバーの計画（dry-run）を見る。何も変えない")
    .argument("<dir>", "同期するフォルダ")
    .option(
      "--source <id>",
      "同期のソースの ID（環境変数 LEAFCHAT_SOURCE_ID でも指定できる）",
    )
    .option("--json", "結果を JSON で stdout に出す")
    .option("--detailed-exitcode", "変更があれば終了コード 2 にする")
    .option(
      "--api-url <url>",
      "leafchat の API の URL（既定は https://api.leafchat.app。環境変数 LEAFCHAT_API_URL でも指定できる）",
    )
    .option("--no-color", "色を付けない")
    .action(async (dir, options) => {
      exitCode = await guarded(io, jsonContextOf(io, "plan", options), () =>
        runPlan(io, dir, options),
      );
    });

  sync
    .command("apply")
    .description("変わったファイルを上げて、同期を実行する")
    .argument("<dir>", "同期するフォルダ")
    .option(
      "--source <id>",
      "同期のソースの ID（環境変数 LEAFCHAT_SOURCE_ID でも指定できる）",
    )
    .option(
      "--confirm-delete <path>",
      "消してよいファイルのパス（削除の安全弁に当たったときに使う。くり返し指定できる）",
      (value: string, previous: string[] | undefined) => [
        ...(previous ?? []),
        value,
      ],
    )
    .option(
      "--confirm-deleted-since <ref>",
      "この版から git の履歴で消したファイルを、消してよいものとして扱う",
    )
    .option("-y, --yes", "確認を聞かずに反映する（CI で使う）")
    .option("--no-wait", "取り込みが済むまで待たない")
    .option("--wait-timeout <minutes>", "取り込みを待つ時間（分。既定は 20）")
    .option("--json", "結果を JSON で stdout に出す")
    .option(
      "--api-url <url>",
      "leafchat の API の URL（既定は https://api.leafchat.app。環境変数 LEAFCHAT_API_URL でも指定できる）",
    )
    .option("--no-color", "色を付けない")
    .action(async (dir, options) => {
      exitCode = await guarded(io, jsonContextOf(io, "apply", options), () =>
        runApply(io, dir, options),
      );
    });

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    // Why これらは文を足さないか: ヘルプと版は commander が出し済み（誤りの終了でも、ヘルプは表示済み）。
    if (
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.help" ||
      error.code === "commander.version"
    ) {
      return error.exitCode;
    }
    io.stderr(`${MESSAGES.usage(error.message.replace(/^error: /, ""))}\n`);
    return 1;
  }
  return exitCode;
}
