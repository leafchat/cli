import type { Result } from "../domain/result.ts";

// Why 投げるか: テストに if を書かずに Result の中身を取り出す。想定と違う腕なら、その中身を文に出して落とす。
export const expectOk = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) {
    throw new Error(
      `Expected Ok, but got Err: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
};

export const expectErr = <T, E>(result: Result<T, E>): E => {
  if (result.ok) {
    throw new Error(
      `Expected Err, but got Ok: ${JSON.stringify(result.value)}`,
    );
  }
  return result.error;
};
