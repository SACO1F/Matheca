import { expect, it } from "vitest";
import { inventory, framed } from "../electron/main/exchange-inventory";
import {
  exchangeInventory,
  exchangePlan,
  framed as browserFramed,
} from "../src/platform/exchange-rules";
import { newQuestion } from "../src/shared/types";
import type { BackupData } from "../src/domain/backup";
const fixture = (): BackupData => ({
  questions: [
    {
      ...newQuestion("q"),
      title: "函数中文 😀",
      body: "已知 x=1",
      createdAt: "9007199254740993",
    },
  ],
  collections: [
    {
      id: "c",
      title: "题集",
      createdAt: "1",
      paperTitle: "试卷",
      examInstructions: "",
      examMinutes: 90,
      totalScore: 100,
      questionLayout: { q: { answerSpaceMm: 80 } },
    },
  ],
  items: [{ collectionId: "c", questionId: "q", position: 0 }],
  customKnowledge: [],
  sources: { q: `sources/${"a".repeat(64)}.png` },
  currentSolutions: [],
  missingSources: 0,
});
it("matches the existing Android inventory protocol for Unicode and exact timestamps", async () => {
  const d = fixture();
  expect(await exchangeInventory(d)).toEqual(inventory(d));
  expect(browserFramed({ b: 20, a: "中文</😀" })).toEqual(
    framed({ b: 20, a: "中文</😀" }),
  );
});
it("classifies conflicts and copies deterministic IDs with remapped collection layouts", async () => {
  const local = fixture(),
    incoming = fixture();
  incoming.questions[0].body = "手机修改";
  const plan = await exchangePlan(local, incoming, "copy");
  expect(plan.details.map((d) => d.status)).toEqual(["conflict", "same"]);
  const id = plan.data.questions[0].id,
    cid = plan.data.collections[0].id;
  expect(id).toMatch(/^exchange-[a-f0-9]{40}$/);
  expect(cid).toMatch(/^exchange-[a-f0-9]{40}$/);
  expect(plan.data.collections[0].questionLayout?.[id]).toEqual({
    answerSpaceMm: 80,
  });
  expect(plan.data.items[0]).toMatchObject({
    questionId: id,
    collectionId: cid,
  });
  expect(plan.data.sources[id]).toBe(incoming.sources.q);
  expect((await exchangePlan(local, incoming, "copy")).data).toEqual(plan.data);
  expect(
    (await exchangePlan(local, incoming, "replace")).data.questions[0].id,
  ).toBe("q");
});
