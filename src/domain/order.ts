// Why localeCompare でないか: leafchat の同期は UTF-16 のコード単位の順で並べる（source-sync-plan.ts の ascending）。同じ順にしないと、計画の並びがサーバーと食い違う。
export const ascending = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
