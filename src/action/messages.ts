// Action だけの文言（日本語）。同期の失敗の文は CLI と同じもの（cli/messages.ts）を使う。

export const ACTION_MESSAGES = {
  input: (input: string, message: string) => `入力 ${input}：${message}`,
  pullRequestTarget:
    "この Action は pull_request_target では動きません（PR の中身を、秘密を持つ文脈で扱わないため）。pull_request で動かしてください。",
  applyOnPullRequest:
    "pull request では反映（mode: apply）しません。PR では mode: plan で計画を確かめ、反映は main への push で行ってください。",
  apiKeyMissing: (mode: "plan" | "apply") =>
    mode === "plan"
      ? "api-key を渡してください（用途「同期の確認」の鍵を secrets から）。"
      : "api-key を渡してください（用途「同期」の鍵を secrets から）。",
  sourceMissing: "source-id に同期のソースの ID を渡してください。",
  fallbackToCheck:
    "サーバーの計画を省きました（api-key がありません。フォークからの PR には GitHub が秘密を渡しません）。送る前の検査だけを行いました。",
  checkFailed: (errors: number) =>
    `送る前の検査でエラーが ${errors} 件あります。注釈かジョブの要約を見て直してください。`,
  checkPassed: (files: number) =>
    `送る前の検査に問題はありません。送るファイルは ${files} 件です。`,
  planned: (changes: boolean) =>
    changes ? "計画に変更があります。" : "計画に変更はありません。",
  unchanged: "変更はありませんでした。leafchat は変えていません。",
  commentFailed: (reason: string) =>
    `PR にコメントできませんでした（permissions に pull-requests: write が要ります）：${reason}`,
  summaryFailed: (reason: string) =>
    `ジョブの要約を書けませんでした：${reason}`,
  commentOmitted: (count: number, runUrl: string | null) =>
    runUrl === null
      ? `ほかに ${count} 件。すべてはジョブの要約を見てください。`
      : `ほかに ${count} 件。すべてはジョブの要約を見てください：${runUrl}`,
  summaryOmitted: (count: number) =>
    `ほかに ${count} 件。すべては出力 plan-file の JSON にあります。`,
  annotationTitle: (severity: "error" | "warning") =>
    severity === "error" ? "leafchat の検査のエラー" : "leafchat の検査の注意",
} as const;
