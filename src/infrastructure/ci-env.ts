import type { SyncClientInfo } from "../domain/sync-contract.ts";

// Why 形を確かめてから送るか: leafchat は形の違う送り手の情報を 400 で拒む。CI の値が想定と違っても、同期そのものは止めない。
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_ID_PATTERN = /^\d+$/;

/** CI の中か（環境変数 CI が真）。CI では確認を聞かない。 */
export const isCi = (env: Readonly<Record<string, string | undefined>>) => {
  const value = env.CI;
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
};

/** 送り手（leafchat のソースの画面の「最後の同期」に出る）。 */
export function clientInfoOf(
  env: Readonly<Record<string, string | undefined>>,
  version: string,
): SyncClientInfo {
  const base = { name: "leafchat-cli", version };
  if (env.GITHUB_ACTIONS === "true") {
    const repository = env.GITHUB_REPOSITORY ?? "";
    const server = env.GITHUB_SERVER_URL ?? "";
    const runId = env.GITHUB_RUN_ID ?? "";
    const validRepository = REPOSITORY_PATTERN.test(repository);
    return {
      ...base,
      ci: "github_actions",
      repository: validRepository ? repository : null,
      runUrl:
        validRepository &&
        server.startsWith("https://") &&
        RUN_ID_PATTERN.test(runId)
          ? `${server}/${repository}/actions/runs/${runId}`
          : null,
    };
  }
  return {
    ...base,
    ci: isCi(env) ? "other" : null,
    repository: null,
    runUrl: null,
  };
}
