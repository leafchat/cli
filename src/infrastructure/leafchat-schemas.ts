import { z } from "zod";
import type { components } from "./generated/leafchat-api.d.ts";

type Schemas = components["schemas"];

/*
  Why z.object（知らない項目を捨てる）か: leafchat が後方互換で応答に項目を足しても、同期を止めない。
  Why satisfies で生成物の型に当てるか: サーバーが項目の名前や型を変えたら、pnpm gen:api の後の pnpm check-types で落とす。
*/

const uploadNeedSchema = z.object({
  sha256: z.string(),
  size: z.number().int(),
  content_type: z.string(),
  external_ids: z.array(z.string()),
}) satisfies z.ZodType<Schemas["UploadNeed"]>;

const knownWarningSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("same_filename_across_folders"),
    external_ids: z.array(z.string()),
    filename: z.string(),
  }),
  z.object({
    code: z.literal("chunk_boundary"),
    external_id: z.string(),
    part: z.number().int(),
    line: z.number().int(),
  }),
]);

// Why 知らない警告を捨てるか: 警告は止めずに知らせるもの。サーバーが新しい種類を足しても、同期を止めない。
const warningsSchema = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = knownWarningSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);

export const syncResponseSchema = z.object({
  dry_run: z.boolean(),
  plan: z.object({
    folders_to_create: z.array(
      z.object({ name: z.string(), similar_to: z.string().nullable() }),
    ),
    create: z.array(
      z.object({
        external_id: z.string(),
        filename: z.string(),
        parts: z.number().int().nullable(),
        folder_id: z.string().nullable(),
        folder_name: z.string(),
      }),
    ),
    update: z.array(
      z.object({
        external_id: z.string(),
        document_id: z.string(),
        filename: z.string(),
        parts: z.number().int().nullable(),
        to_folder_id: z.string().nullable(),
        to_folder_name: z.string().nullable(),
      }),
    ),
    move: z.array(
      z.object({
        external_id: z.string(),
        document_id: z.string(),
        to_folder_id: z.string().nullable(),
        to_folder_name: z.string(),
      }),
    ),
    rename: z.array(
      z.object({
        from_external_id: z.string(),
        external_id: z.string(),
        document_id: z.string(),
        filename: z.string(),
        to_folder_id: z.string().nullable(),
        to_folder_name: z.string().nullable(),
      }),
    ),
    delete: z.array(
      z.object({
        external_id: z.string(),
        document_id: z.string(),
        filename: z.string(),
      }),
    ),
    unchanged: z.array(z.string()),
    unmanaged: z.array(z.string()),
  }),
  limits: z.object({
    delete_cap: z.number().int(),
    max_files: z.number().int(),
    source_count: z.number().int(),
    total_count: z.number().int(),
  }),
  uploads_required: z.array(uploadNeedSchema),
  warnings: warningsSchema,
  created_folders: z.array(
    z.object({ name: z.string(), folder_id: z.string() }),
  ),
  executed: z.array(
    z.object({
      kind: z.enum(["create", "update", "rename", "move", "delete"]),
      external_id: z.string(),
      document_id: z.string(),
      revision_id: z.string().nullable(),
    }),
  ),
  remaining: z.number().int().nonnegative(),
}) satisfies z.ZodType<
  Pick<
    Schemas["SyncResponse"],
    | "dry_run"
    | "plan"
    | "limits"
    | "uploads_required"
    | "warnings"
    | "created_folders"
    | "executed"
    | "remaining"
  >
>;

export const uploadAcceptedSchema = z.object({
  sha256: z.string(),
  size: z.number().int(),
  already_uploaded: z.boolean(),
}) satisfies z.ZodType<Schemas["UploadAccepted"]>;

const revisionRefSchema = z
  .object({
    id: z.string(),
    state: z.string(),
    error_message: z.string().nullable(),
  })
  .nullable();

export const documentPageSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      external_id: z.string().nullable(),
      current_revision: revisionRefSchema,
      head_revision: revisionRefSchema,
    }),
  ),
  next_cursor: z.string().nullable(),
});
