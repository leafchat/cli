// Why 合成子を持たないか: use-case は「逐次 await と早期の return err」で足りる（knowledge・leafchat と同じ）。
export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
