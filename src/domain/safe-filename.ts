// leafchat のサーバーの safeFilename の写し。leafchat のファイル名（画面と出典に出る名前）を決める。
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[<>:"/\\|?*\s]/g, "_").trim();
  const limited = cleaned.slice(0, 200);
  return limited.length > 0 ? limited : "file";
}
