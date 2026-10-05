import { findingText } from "../domain/report.ts";
import type { ApiProblem } from "../domain/sync-contract.ts";
import type { AppliedCounts, ProgressEvent } from "../use-cases/apply-sync.ts";
import type { Stage, SyncFailure } from "../use-cases/sync-steps.ts";

// CLI の文言（日本語）。誤りは「何が・なぜ・どうすればよいか」を書く。

export const MESSAGES = {
  apiKeyMissing:
    "環境変数 LEAFCHAT_API_KEY に API キーを入れてください（用途「同期」か「同期の確認」の鍵）。鍵はコマンドの引数では受けません。",
  sourceMissing:
    "ソースの ID を --source か、環境変数 LEAFCHAT_SOURCE_ID で指定してください。",
  cannotConfirm:
    "確認できない環境です（端末でない・CI）。内容を確かめた上で反映するなら --yes を付けてください。",
  waitTimeoutInvalid:
    "--wait-timeout は 1 以上の分数（整数）で指定してください。",
  confirmQuestion: "この内容で反映しますか？ [y/N] ",
  declined: "反映をやめました。leafchat は変えていません。",
  usage: (detail: string) =>
    `使い方が違います（${detail}）。leafchat --help で使い方を確かめてください。`,
} as const;

/** commander の英語の見出しを日本語にする（ヘルプの表示）。 */
export const HELP_TITLES: Readonly<Record<string, string>> = {
  "Usage:": "使い方：",
  "Arguments:": "引数：",
  "Options:": "オプション：",
  "Global Options:": "共通のオプション：",
  "Commands:": "コマンド：",
};

const STAGE_LABEL: Record<Stage, string> = {
  dry_run: "計画",
  upload: "アップロード",
  execute: "実行",
  status: "反映の確認",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function problemText(stage: Stage, problem: ApiProblem): string {
  if (problem.code === "folder_not_found") {
    const folders = Array.isArray(problem.extensions.folders)
      ? problem.extensions.folders.filter((f) => typeof f === "string")
      : [];
    const similar = Array.isArray(problem.extensions.similar)
      ? problem.extensions.similar.flatMap((item) =>
          isRecord(item) && typeof item.existing === "string"
            ? [item.existing]
            : [],
        )
      : [];
    return [
      `leafchat に無いフォルダがあります。ダッシュボードの『ナレッジ』でフォルダ『${folders.join("』『")}』を作り、使うサイトを選んでから、もう一度実行してください。`,
      ...(similar.length === 0
        ? []
        : [`似た名前の『${similar.join("』『")}』があります。`]),
    ].join("");
  }
  return `leafchat が誤りを返しました（${STAGE_LABEL[stage]}・${problem.status} ${problem.code}）：${problem.detail ?? "詳しい説明はありません"}`;
}

/** 失敗の理由の文（複数行）。 */
export function failureText(
  failure: SyncFailure,
  waitTimeoutMinutes: number,
): string {
  switch (failure.kind) {
    case "local_check_failed": {
      const errors = failure.findings.filter((f) => f.severity === "error");
      return [
        ...failure.findings.map(
          (f) => `${f.severity === "error" ? "x" : "!"} ${findingText(f)}`,
        ),
        `送る前の検査でエラーが ${errors.length} 件あります。直してから、もう一度実行してください。leafchat は変えていません。`,
      ].join("\n");
    }
    case "unconfirmed_deletes":
      return [
        `一度に消す資料が多いため、確かめた削除だけを反映します。次の削除を確かめられませんでした：${failure.missing.join("、")}`,
        "消してよければ --confirm-delete <パス> を付けるか、--confirm-deleted-since <コミット> で git の履歴から確かめてください。leafchat は変えていません。",
        ...(failure.historyUnavailable
          ? [
              "git の履歴を読めなかったので、削除の確認に使いませんでした（浅い clone なら fetch-depth を増やしてください）。",
            ]
          : []),
      ].join("\n");
    case "api_error":
      return problemText(failure.stage, failure.problem);
    case "gave_up":
      return `leafchat が混み合っていて、${STAGE_LABEL[failure.stage]}を続けられませんでした（${failure.code}）。しばらくしてから、もう一度実行してください。`;
    case "too_many_rounds":
      return `実行が進まなくなりました（残り ${failure.remaining} 操作）。しばらくしてから、もう一度実行してください。済んだ操作は除いて続きから実行します。`;
    case "ingest_failed":
      return [
        "取り込みに失敗した文書があります。ファイルを直して、もう一度実行してください。",
        ...failure.readiness.failed.map(
          ({ externalId, message }) => `x ${externalId}：${message}`,
        ),
      ].join("\n");
    case "not_ready":
      return `${waitTimeoutMinutes} 分待っても反映が終わりませんでした：${failure.readiness.pending.join("、")}。ダッシュボードの『ナレッジ』で状態を確かめてください。`;
    case "declined":
      return MESSAGES.declined;
  }
}

export function progressText(event: ProgressEvent): string {
  switch (event.kind) {
    case "upload":
      return `アップロード ${event.done}/${event.total}`;
    case "execute":
      return `実行 ${event.executed} 件済み（残り ${event.remaining} 操作）`;
    case "wait":
      return `反映を待っています（公開 ${event.live} 件・処理中 ${event.pending} 件）`;
  }
}

/** 反映の後の 1 行（CLI の stderr と Action の要約）。 */
export function appliedText(counts: AppliedCounts): string {
  return `反映しました（作成 ${counts.create}・更新 ${counts.update}・名前の変更 ${counts.rename}・移動 ${counts.move}・削除 ${counts.delete}）。`;
}
