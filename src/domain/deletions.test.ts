import { expect, test } from "vitest";
import { decideConfirmedDeletes } from "./deletions.ts";

test.each([
  {
    label: "名指しと git の履歴で全部が確かめられれば、その一覧を返す",
    named: ["共通/旧料金表.pdf"],
    deletedInGit: ["渋谷店/旧メニュー.pdf"],
    expected: {
      ok: true,
      value: ["共通/旧料金表.pdf", "渋谷店/旧メニュー.pdf"],
    },
  },
  {
    label: "1 つでも無ければ、無いものを挙げて止める",
    named: ["共通/旧料金表.pdf"],
    deletedInGit: [],
    expected: { ok: false, error: { missing: ["渋谷店/旧メニュー.pdf"] } },
  },
  {
    label: "git の履歴が無ければ名指しだけで決める",
    named: ["渋谷店/旧メニュー.pdf", "共通/旧料金表.pdf"],
    deletedInGit: null,
    expected: {
      ok: true,
      value: ["共通/旧料金表.pdf", "渋谷店/旧メニュー.pdf"],
    },
  },
])("確かめた削除（$label）", ({ named, deletedInGit, expected }) => {
  const result = decideConfirmedDeletes({
    unconfirmed: ["渋谷店/旧メニュー.pdf", "共通/旧料金表.pdf"],
    named,
    deletedInGit,
  });

  expect(result).toEqual(expected);
});
