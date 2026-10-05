import type { KnowledgeMime, TextMime } from "./formats.ts";

/*
  leafchat の公開 REST の同期の要求・応答の型。応答の検証は infrastructure の zod が行い、
  サーバーの OpenAPI の生成物（generated/leafchat-api.d.ts）との突き合わせも infrastructure が型で行う。
*/

type SyncFileInline = Readonly<{
  path: string;
  content: string;
  content_type: TextMime;
}>;

type SyncFileRef = Readonly<{
  path: string;
  sha256: string;
  size: number;
  content_type: KnowledgeMime;
}>;

export type SyncFile = SyncFileInline | SyncFileRef;

export type SyncClientInfo = Readonly<{
  name: string;
  version: string;
  ci: "github_actions" | "other" | null;
  repository: string | null;
  runUrl: string | null;
}>;

export type SyncRequestBody = Readonly<{
  files: readonly SyncFile[];
  confirmedDeletes: readonly string[];
  dryRun: boolean;
  client: SyncClientInfo | null;
}>;

export type SyncPlan = Readonly<{
  folders_to_create: readonly Readonly<{
    name: string;
    similar_to: string | null;
  }>[];
  create: readonly Readonly<{
    external_id: string;
    filename: string;
    parts: number | null;
    folder_id: string | null;
    folder_name: string;
  }>[];
  update: readonly Readonly<{
    external_id: string;
    document_id: string;
    filename: string;
    parts: number | null;
    to_folder_id: string | null;
    to_folder_name: string | null;
  }>[];
  move: readonly Readonly<{
    external_id: string;
    document_id: string;
    to_folder_id: string | null;
    to_folder_name: string;
  }>[];
  rename: readonly Readonly<{
    from_external_id: string;
    external_id: string;
    document_id: string;
    filename: string;
    to_folder_id: string | null;
    to_folder_name: string | null;
  }>[];
  delete: readonly Readonly<{
    external_id: string;
    document_id: string;
    filename: string;
  }>[];
  unchanged: readonly string[];
  unmanaged: readonly string[];
}>;

export type UploadNeed = Readonly<{
  sha256: string;
  size: number;
  content_type: string;
  external_ids: readonly string[];
}>;

export type SyncWarning =
  | Readonly<{
      code: "same_filename_across_folders";
      external_ids: readonly string[];
      filename: string;
    }>
  | Readonly<{
      code: "chunk_boundary";
      external_id: string;
      part: number;
      line: number;
    }>;

export type SyncExecuted = Readonly<{
  kind: "create" | "update" | "rename" | "move" | "delete";
  external_id: string;
  document_id: string;
  revision_id: string | null;
}>;

export type SyncResponse = Readonly<{
  dry_run: boolean;
  plan: SyncPlan;
  uploads_required: readonly UploadNeed[];
  warnings: readonly SyncWarning[];
  executed: readonly SyncExecuted[];
  remaining: number;
}>;

export type UploadAccepted = Readonly<{
  sha256: string;
  size: number;
  already_uploaded: boolean;
}>;

type RevisionRef = Readonly<{
  id: string;
  state: string;
  error_message: string | null;
}>;

export type ApiDocument = Readonly<{
  id: string;
  external_id: string | null;
  current_revision: RevisionRef | null;
  head_revision: RevisionRef | null;
}>;

export type ApiProblem = Readonly<{
  status: number;
  /** problem+json の code。problem+json でなければ "http_error"。 */
  code: string;
  detail: string | null;
  retryAfterSeconds: number | null;
  extensions: Readonly<Record<string, unknown>>;
}>;
