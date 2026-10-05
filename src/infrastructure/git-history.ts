import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ascending } from "../domain/order.ts";

/** コマンドを引数の並びで呼び（シェルを通さない）、標準出力を返す。 */
export type ExecFile = (
  file: string,
  args: readonly string[],
  options: { cwd: string },
) => Promise<Uint8Array>;

export type GitHistory = {
  /** ref から HEAD までに、root の下で消えたパス（root からの相対・NFC）。履歴が無い・読めなければ null。 */
  deletedSince(params: { ref: string; root: string }): Promise<string[] | null>;
};

// Why ref の形を絞るか: ref は git の引数になる。- で始まる値はオプションに化け、.. は範囲の指定になる。
const SAFE_REF = /^(?!-)[0-9A-Za-z._/-]{1,200}$/;
// Why 全て 0 を「履歴が無い」とするか: 新しいブランチへの push で、GitHub は before に 0 の並びを入れる。
const NO_HISTORY = /^0+$/;

const decoder = new TextDecoder();

export function createGitHistory(params: { exec: ExecFile }): GitHistory {
  return {
    async deletedSince({ ref, root }) {
      if (!SAFE_REF.test(ref) || ref.includes("..")) {
        throw new Error(
          `--confirm-deleted-since の「${ref}」は使えません。コミットの ID かブランチの名前を指定してください。`,
        );
      }
      if (NO_HISTORY.test(ref)) return null;
      let output: Uint8Array;
      try {
        // Why root を cwd にして --relative を付けるか: 出力のパスを root からの相対にし、root の外の変更を拾わない。
        output = await params.exec(
          "git",
          [
            "diff",
            "--name-status",
            "-z",
            "--no-renames",
            "--relative",
            ref,
            "HEAD",
            "--",
            ".",
          ],
          { cwd: root },
        );
      } catch {
        return null;
      }
      const fields = decoder.decode(output).split("\0");
      const deleted: string[] = [];
      for (let i = 0; i + 1 < fields.length; i += 2) {
        const path = fields[i + 1];
        if (fields[i] === "D" && path !== undefined && path.length > 0) {
          deleted.push(path.normalize("NFC"));
        }
      }
      return deleted.toSorted(ascending);
    },
  };
}

const execFileAsync = promisify(execFile);

export const realExecFile: ExecFile = async (file, args, options) => {
  const { stdout } = await execFileAsync(file, [...args], {
    cwd: options.cwd,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
};
