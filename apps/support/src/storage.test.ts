import type { Firestore } from "@google-cloud/firestore"
import { expect, it } from "vitest"
import { getParticipantRepository, withDatabase } from "./storage.js"

it("binds shared repositories to each asynchronous database context", async () => {
  const database = (target: string) =>
    ({
      collection: (name: string) => ({ target, name }),
    }) as unknown as Firestore
  const observations = await Promise.all(
    ["first", "second"].map((target) =>
      withDatabase(database(target), async () => {
        const repository = getParticipantRepository()
        await new Promise((resolve) =>
          setTimeout(resolve, target === "first" ? 10 : 1),
        )
        return [
          repository.participationEvents(),
          getParticipantRepository().analysisQuestionnaires(),
        ]
      }),
    ),
  )
  expect(observations).toEqual([
    [
      { target: "first", name: "participationEvents" },
      { target: "first", name: "analysisQuestionnaires" },
    ],
    [
      { target: "second", name: "participationEvents" },
      { target: "second", name: "analysisQuestionnaires" },
    ],
  ])
  expect(() => getParticipantRepository()).toThrow(
    "Support database context missing",
  )
})
