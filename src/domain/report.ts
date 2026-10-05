import { RICH_MAX_BYTES } from "./limits.ts";
import type { Finding } from "./local-check.ts";
import type {
  SyncExecuted,
  SyncPlan,
  SyncWarning,
  UploadNeed,
} from "./sync-contract.ts";
import type { SyncPathError } from "./sync-path.ts";

/** 計画の表示に要るもの（サーバーの計画・警告・要るアップロードと、手元の検査の結果）。 */
export type PlanView = Readonly<{
  sourceId: string;
  plan: SyncPlan;
  warnings: readonly SyncWarning[];
  uploadsRequired: readonly UploadNeed[];
  /** 止めずに知らせる検査の結果（対応しない形式など）。 */
  findings: readonly Finding[];
  /** 本文の合計が大きく、本文を送らずに参照にしたテキスト。 */
  inlineSkipped: readonly string[];
  /** 削除の安全弁を超えたため、反映のときに確認が要る削除。 */
  needsConfirmation: readonly string[];
}>;

type Style = "green" | "red" | "yellow" | "bold";

/** 色を付ける口。domain は色の付け方（端末・NO_COLOR）を知らない。 */
export type Paint = (style: Style, text: string) => string;

const plain: Paint = (_style, text) => text;

const MIB = 1024 * 1024;
const KIB = 1024;

const sizeText = (bytes: number) =>
  bytes >= MIB
    ? `${(bytes / MIB).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / KIB))} KB`;

// Why 幅で揃えるか: 日本語の 1 文字は端末で 2 桁を占め、文字数で揃えると列がずれる。ラベルはどれも固定の日本語。
const widthOf = (text: string) =>
  [...text].reduce(
    (width, ch) => width + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1),
    0,
  );

const padTo = (text: string, width: number) =>
  `${text}${" ".repeat(Math.max(0, width - widthOf(text)))}`;

const operationCount = (plan: SyncPlan) =>
  plan.create.length +
  plan.update.length +
  plan.rename.length +
  plan.move.length +
  plan.delete.length;

export const hasChanges = (plan: SyncPlan) =>
  operationCount(plan) + plan.folders_to_create.length > 0;

const folderOf = (externalId: string) => {
  const slash = externalId.indexOf("/");
  return slash < 0 ? "直下" : externalId.slice(0, slash);
};

const PATH_REASON: Record<SyncPathError, string> = {
  empty: "パスが空です。",
  too_long:
    "パスが UTF-8 で 512 バイトを超えます。フォルダ名かファイル名を短くしてください。",
  malformed: "名前に読めない文字があります。名前を付け直してください。",
  not_nfc:
    "名前の濁点などの形がそろっていません（Unicode の NFC）。名前を付け直してください。",
  forbidden_char:
    "名前に使えない文字（制御文字・\\ など）があります。名前を付け直してください。",
  empty_segment: "空の名前は使えません。",
  dot_segment: "「.」「..」という名前は使えません。",
  segment_whitespace:
    "フォルダ名かファイル名の前後に空白があります。空白を取ってください。",
  depth: "フォルダは 1 階層までです。",
  folder_name: "フォルダ名が 60 文字を超えます。",
  extension: "対応しない形式です。",
  filename: "ファイル名が 40 文字を超えます。",
};

const isPathReason = (value: string): value is SyncPathError =>
  Object.hasOwn(PATH_REASON, value);

/** 検査の結果の 1 行（どのファイルが・なぜ・どう直すか）。 */
export function findingText(finding: Finding): string {
  const { path, detail } = finding;
  const at = `${path ?? ""}：`;
  switch (finding.code) {
    case "symlink":
      return `${at}シンボリックリンクは送りません。実体のファイルを置いてください。`;
    case "path_depth":
      return `${at}フォルダは 1 階層までです。「${detail ?? ""}」の直下へ移してください。`;
    case "path_invalid":
      return `${at}${detail !== null && isPathReason(detail) ? PATH_REASON[detail] : "パスの形が正しくありません。"}`;
    case "folder_name":
      return `${at}フォルダ名「${detail ?? ""}」が 60 文字を超えます。短くしてください。`;
    case "filename":
      return `${at}ファイル名「${detail ?? ""}」が 40 文字を超えます（回答の出典に出るため）。短くしてください。`;
    case "unsupported_format":
      return `${at}対応しない形式${detail === null ? "" : `（.${detail}）`}のため送りません。対応する形式は md・txt・json・html・csv・pdf・docx です。`;
    case "empty_file":
      return `${at}空のファイルです。中身を入れるか、消してください。`;
    case "too_large":
      return `${at}ファイルが大きすぎます（${Math.floor(Number(detail ?? RICH_MAX_BYTES) / MIB)} MB まで）。分けるか小さくしてください。`;
    case "lfs_pointer":
      return `${at}Git LFS のポインタファイルです。actions/checkout に lfs: true を付けるか、git lfs pull で実体を取ってください。`;
    case "not_utf8":
      return `${at}UTF-8 として読めません。文字コードを UTF-8 にして保存し直してください。`;
    case "duplicate":
      return `${at}同じフォルダに、leafchat で同じ名前（${detail ?? ""}）になるファイルがあります。どちらかの名前を変えてください。`;
    case "too_many_files":
      return detail === null
        ? "フォルダの中の項目が多すぎて、すべてを読めませんでした（20,000 個まで）。同期するフォルダを絞ってください。"
        : `送るファイルが ${detail} 件あります。1 つのソースには 500 件までです。`;
  }
}

/** 送る前の検査（check）の表示。 */
export function renderCheckText(
  result: Readonly<{ fileCount: number; findings: readonly Finding[] }>,
  paint: Paint = plain,
): string {
  const lines = result.findings.map((finding) =>
    finding.severity === "error"
      ? paint("red", `  x ${findingText(finding)}`)
      : paint("yellow", `  ! ${findingText(finding)}`),
  );
  const errors = result.findings.filter((f) => f.severity === "error").length;
  lines.push(
    errors > 0
      ? `エラーが ${errors} 件あります。直してから、もう一度実行してください。`
      : `問題はありません。送るファイルは ${result.fileCount} 件です。`,
  );
  return `${lines.join("\n")}\n`;
}

function warningLine(warning: SyncWarning): string {
  switch (warning.code) {
    case "chunk_boundary":
      return `! ${warning.external_id}：${warning.part} つ目の部分が節の途中から始まります（${warning.line} 行目）。見出しの前で切れるよう、節を短くしてください。`;
    case "same_filename_across_folders": {
      const folders = [...new Set(warning.external_ids.map(folderOf))];
      return `! 「${warning.filename}」が ${folders.length} つのフォルダ（${folders.join("・")}）にあります。サイトごとにナレッジを分けていないあいだは、AI が区別できません。ファイル名に店名などを入れてください。`;
    }
  }
}

function noteLines(view: PlanView): { text: string; warn: boolean }[] {
  const { plan } = view;
  const notes = view.warnings.map((w) => ({
    text: warningLine(w),
    warn: true,
  }));
  if (view.needsConfirmation.length > 0) {
    notes.push({
      text: "! 一度に消す資料が多いため、反映のときに確認が要ります（--confirm-delete か、push の前後の git の履歴で消えたファイル）。",
      warn: true,
    });
  }
  for (const finding of view.findings) {
    notes.push({ text: `! ${findingText(finding)}`, warn: true });
  }
  if (view.inlineSkipped.length > 0) {
    notes.push({
      text: `i 本文の合計が大きいため、次のテキストは本文を送らず、チャンク境界の検査を省きました：${view.inlineSkipped.join("、")}`,
      warn: false,
    });
  }
  // Why 組を名指ししないか: どの削除とどの作成が同じ文書だったかは分からない。推測で名指しすると誤る。
  if (plan.delete.length > 0 && plan.create.length > 0) {
    notes.push({
      text: "i 削除と作成が同時にあります。名前と中身を同じ同期で変えると、文書の履歴が切れます（名前の変更と中身の変更を別々の同期に分ければ保てます）。",
      warn: false,
    });
  }
  for (const folder of plan.folders_to_create) {
    notes.push({
      text:
        folder.similar_to === null
          ? `i フォルダ「${folder.name}」を作ります。`
          : `i フォルダ「${folder.name}」を作ります（似た名前の「${folder.similar_to}」があります）。`,
      warn: false,
    });
  }
  return notes;
}

/** アップロードの件数の単位と、要るときは合計の大きさ（「件（3.4 MB）」）。 */
const uploadUnit = (view: PlanView) => {
  const bytes = view.uploadsRequired.reduce((sum, u) => sum + u.size, 0);
  return view.uploadsRequired.length === 0 ? "件" : `件（${sizeText(bytes)}）`;
};

const COUNT_LABEL_WIDTH = 16;
const LINE_LABEL_WIDTH = 12;

const countLine = (label: string, count: number, rest = "") =>
  `  ${padTo(label, COUNT_LABEL_WIDTH)}${String(count).padStart(3)}${rest}`;

function operationLines(
  view: PlanView,
  paint: Paint,
  indent: string,
): string[] {
  const { plan } = view;
  const line = (symbol: string, label: string, text: string) =>
    `${indent}${symbol} ${padTo(label, LINE_LABEL_WIDTH)}${text}`;
  const confirmation = new Set(view.needsConfirmation);
  return [
    ...plan.create.map((op) =>
      paint("green", line("+", "作成", op.external_id)),
    ),
    ...plan.update.map((op) =>
      line(
        "~",
        "更新",
        op.to_folder_name === null
          ? op.external_id
          : `${op.external_id} → ${op.to_folder_name}`,
      ),
    ),
    ...plan.rename.map((op) =>
      line(">", "名前の変更", `${op.from_external_id} → ${op.external_id}`),
    ),
    ...plan.move.map((op) =>
      line(">", "移動", `${op.external_id} → ${op.to_folder_name}`),
    ),
    ...plan.delete.map((op) =>
      paint(
        "red",
        line(
          "-",
          "削除",
          confirmation.has(op.external_id)
            ? `${op.external_id}（確認が要る）`
            : op.external_id,
        ),
      ),
    ),
  ];
}

/** 計画の表示（端末）。件数の表 → 1 件ずつ → 注意の順。 */
export function renderPlanText(view: PlanView, paint: Paint = plain): string {
  const { plan } = view;
  const lines = [
    paint("bold", `leafchat の同期の計画  ソース ${view.sourceId}`),
    "",
  ];
  if (!hasChanges(plan)) {
    lines.push("  変更はありません。");
  } else {
    const folderNames = plan.folders_to_create.map((f) => f.name).join("・");
    lines.push(
      countLine(
        "フォルダの作成",
        plan.folders_to_create.length,
        folderNames === "" ? "" : `   ${folderNames}`,
      ),
      countLine("作成", plan.create.length),
      countLine("更新", plan.update.length),
      countLine("名前の変更", plan.rename.length),
      countLine("移動", plan.move.length),
      countLine("削除", plan.delete.length),
      countLine("変更なし", plan.unchanged.length),
      countLine(
        "アップロード",
        view.uploadsRequired.length,
        ` ${uploadUnit(view)}`,
      ),
      "",
      ...operationLines(view, paint, "  "),
    );
  }
  const notes = noteLines(view);
  if (notes.length > 0) {
    lines.push(
      "",
      "注意",
      ...notes.map((note) =>
        note.warn ? paint("yellow", `  ${note.text}`) : `  ${note.text}`,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** 囲いに使うバッククォートの数（中のどのバッククォートの並びよりも長く、3 以上）。 */
const fenceOf = (lines: readonly string[]) =>
  "`".repeat(
    Math.max(
      3,
      ...lines.flatMap((line) =>
        [...line.matchAll(/`+/g)].map((m) => m[0].length + 1),
      ),
    ),
  );

// Why 中のバッククォートより長い囲いにするか: ファイルの名前にバッククォートが続いても、ブロックを途中で閉じさせない。
const codeBlock = (lines: readonly string[], fence = fenceOf(lines)) => [
  `${fence}text`,
  ...lines,
  fence,
];

/** 1 行のコード（中のバッククォートより長い囲い。端のバッククォートと囲いが続かないよう空白を挟む）。 */
function inlineCode(text: string): string {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** 見出しの下に出す、どこで・いつ・どの版で作ったか。 */
export type MarkdownContext = Readonly<{
  /** 同期するフォルダ（Action の path の入力）。 */
  folder: string;
  /** 作った時刻（ISO 8601）。 */
  generatedAt: string;
  version: string;
}>;

export type MarkdownOptions = Readonly<{
  context?: MarkdownContext;
  /** これを超えるなら、1 件ずつの行を後ろから落とす（足りなければ注意も落とす）。 */
  maxChars?: number;
  /** 落とした行の数の案内。 */
  omitted?: (count: number) => string;
}>;

const contextLine = (context: MarkdownContext) =>
  `フォルダ ${inlineCode(context.folder)}・${context.generatedAt.slice(0, 16).replace("T", " ")} UTC・leafchat-cli ${context.version}`;

const headLines = (title: string, options: MarkdownOptions) => [
  title,
  ...(options.context === undefined ? [] : ["", contextLine(options.context)]),
];

/** コードのブロックに入れる行の並び。前後の行（見出しや折りたたみ）は、行が 1 つでも残るときだけ出す。 */
type Section = Readonly<{
  open: readonly string[];
  lines: readonly string[];
  close: readonly string[];
}>;

/**
 * 見出しと行の並びを Markdown にする。maxChars を超えるなら、後ろの並びの後ろの行から落とし、落とした数の案内を足す。
 * Why 文字数（UTF-16 の長さ）で測るか: GitHub の PR のコメントの上限は文字数。UTF-16 の長さは文字数より短くならない。
 */
function fitMarkdown(
  head: readonly string[],
  sections: readonly Section[],
  options: MarkdownOptions,
): string {
  const fences = sections.map((section) => fenceOf(section.lines));
  const total = sections.reduce(
    (sum, section) => sum + section.lines.length,
    0,
  );
  const omittedText =
    options.omitted ?? ((count: number) => `ほかに ${count} 件を省きました。`);
  const render = (kept: readonly number[]) => {
    const lines = [...head];
    sections.forEach((section, index) => {
      const count = kept[index] ?? 0;
      if (count === 0) return;
      lines.push(
        "",
        ...section.open,
        ...codeBlock(section.lines.slice(0, count), fences[index]),
        ...section.close,
      );
    });
    const omitted = total - kept.reduce((sum, count) => sum + count, 0);
    if (omitted > 0) lines.push("", omittedText(omitted));
    return `${lines.join("\n")}\n`;
  };
  const kept = sections.map((section) => section.lines.length);
  const { maxChars } = options;
  if (maxChars === undefined) return render(kept);
  const fits = (counts: readonly number[]) => render(counts).length <= maxChars;
  if (fits(kept)) return render(kept);
  for (let index = sections.length - 1; index >= 0; index--) {
    kept[index] = 0;
    if (!fits(kept)) continue;
    let low = 0;
    let high = sections[index]?.lines.length ?? 0;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      kept[index] = middle;
      if (fits(kept)) low = middle;
      else high = middle - 1;
    }
    kept[index] = low;
    return render(kept);
  }
  return render(kept);
}

/**
 * 計画の Markdown（GitHub の PR のコメントとジョブの要約）。件数の表 → 注意 → 1 件ずつ（折りたたみ）の順。
 * Why ファイルとフォルダの名前をコードのブロックに入れるか: 名前は送り手が決める。表や本文に置くと、Markdown の記法や @ のメンションとして読まれうる。
 */
export function renderPlanMarkdown(
  view: PlanView,
  options: MarkdownOptions = {},
): string {
  const { plan } = view;
  const head = headLines(
    `### leafchat の同期の計画（ソース ${view.sourceId}）`,
    options,
  );
  if (!hasChanges(plan)) {
    head.push("", "変更はありません。");
  } else {
    const deleteRow =
      plan.delete.length > 0
        ? `| **削除** | **${plan.delete.length}** |`
        : "| 削除 | 0 |";
    head.push(
      "",
      "| 操作 | 件数 |",
      "| --- | ---: |",
      `| フォルダの作成 | ${plan.folders_to_create.length} |`,
      `| 作成 | ${plan.create.length} |`,
      `| 更新 | ${plan.update.length} |`,
      `| 名前の変更 | ${plan.rename.length} |`,
      `| 移動 | ${plan.move.length} |`,
      deleteRow,
      `| 変更なし | ${plan.unchanged.length} |`,
      `| アップロード | ${view.uploadsRequired.length} ${uploadUnit(view)} |`,
    );
  }
  const operations = hasChanges(plan) ? operationLines(view, plain, "") : [];
  return fitMarkdown(
    head,
    [
      {
        open: ["**注意**", ""],
        lines: noteLines(view).map((note) => note.text),
        close: [],
      },
      {
        open: [
          "<details>",
          `<summary>1 件ずつ（${operations.length} 件）</summary>`,
          "",
        ],
        lines: operations,
        close: ["", "</details>"],
      },
    ],
    options,
  );
}

/** 送る前の検査（check）の Markdown。notice は検査に落とした理由など、見出しのすぐ下に出す 1 文。 */
export function renderCheckMarkdown(
  result: Readonly<{ fileCount: number; findings: readonly Finding[] }>,
  options: MarkdownOptions & Readonly<{ notice?: string }> = {},
): string {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.length - errors;
  const head = headLines("### leafchat の送る前の検査", options);
  if (options.notice !== undefined) head.push("", options.notice);
  head.push(
    "",
    errors > 0
      ? `エラーが ${errors} 件、注意が ${warnings} 件あります。エラーを直してから、もう一度実行してください。`
      : `問題はありません。送るファイルは ${result.fileCount} 件です。${warnings > 0 ? `注意が ${warnings} 件あります。` : ""}`,
  );
  return fitMarkdown(
    head,
    [
      {
        open: [],
        lines: result.findings.map(
          (f) => `${f.severity === "error" ? "x" : "!"} ${findingText(f)}`,
        ),
        close: [],
      },
    ],
    options,
  );
}

/** 失敗の Markdown（計画か反映が止まったとき）。text は CLI と同じ失敗の文。 */
export function renderFailureMarkdown(
  input: Readonly<{
    command: "plan" | "apply";
    sourceId: string;
    text: string;
  }>,
  options: MarkdownOptions = {},
): string {
  const head = headLines(
    `### leafchat の同期の${input.command === "plan" ? "計画" : "反映"}（ソース ${input.sourceId}）`,
    options,
  );
  head.push(
    "",
    input.command === "plan"
      ? "計画を作れませんでした。"
      : "反映が止まりました。",
  );
  return fitMarkdown(
    head,
    [{ open: [], lines: input.text.split("\n"), close: [] }],
    options,
  );
}

/** --json の形の版。形を変えるときに上げる。 */
const JSON_VERSION = 1;

/** --json で stdout に 1 つだけ出す JSON（Action の plan-file も同じ形）。check・plan・apply で同じ形にする。 */
export function planJson(input: {
  command: "check" | "plan" | "apply";
  sourceId: string | null;
  view: PlanView | null;
  findings: readonly Finding[];
  executed: readonly SyncExecuted[];
  error: Readonly<{ code: string; message: string }> | null;
}): Record<string, unknown> {
  const { view } = input;
  const plan = view?.plan ?? null;
  return {
    version: JSON_VERSION,
    command: input.command,
    source_id: input.sourceId,
    ok: input.error === null,
    summary:
      plan === null || view === null
        ? null
        : {
            folders_to_create: plan.folders_to_create.length,
            create: plan.create.length,
            update: plan.update.length,
            rename: plan.rename.length,
            move: plan.move.length,
            delete: plan.delete.length,
            unchanged: plan.unchanged.length,
            uploads: view.uploadsRequired.length,
          },
    plan,
    uploads_required: view?.uploadsRequired ?? [],
    warnings: view?.warnings ?? [],
    findings: input.findings,
    inline_skipped: view?.inlineSkipped ?? [],
    deletes_needing_confirmation: view?.needsConfirmation ?? [],
    executed: input.executed,
    error: input.error,
  };
}
