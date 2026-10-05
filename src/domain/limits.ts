/*
  leafchat のサーバーの上限の写し。
  Why 写すか: 送る前に止めて、直す場所を手元で示すため。サーバーが最終の判定をするので、ずれても止まる場所が変わるだけで壊れはしない。
*/

export const SYNC_PATH_MAX_BYTES = 512;

export const SYNC_MAX_FILES = 500;

const SYNC_MAX_BODY_BYTES = 8 * 1024 * 1024;

// Why 1 MiB 残すか: 本文の JSON の枠・参照の項目・確認した削除・送り手の情報の分。
export const INLINE_BUDGET_BYTES = SYNC_MAX_BODY_BYTES - 1024 * 1024;

export const FILENAME_MAX_CHARS = 40;

export const FOLDER_NAME_MAX_CHARS = 60;

export const TEXT_MAX_BYTES = 4 * 1024 * 1024;

export const RICH_MAX_BYTES = 15 * 1024 * 1024;
