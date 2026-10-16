import { expect, test } from "../test-support/e2e/fixtures"

test("an open page switches to reception closure without clearing stored data", async ({
  page,
  localServices,
}) => {
  await page.clock.install()
  await page.goto("/")
  await expect(
    page.getByRole("button", { name: "次に進む", exact: true }),
  ).toBeEnabled()
  await page.evaluate(() =>
    localStorage.setItem("synthetic-retained-at-closure", "retained"),
  )
  const before = await localServices.state()
  // Use an absolute jump: this runner truncates fastForward durations to 32 bits.
  await page.clock.pauseAt(new Date("2100-01-01T00:00:00Z"))
  await expect(
    page.getByRole("heading", { name: "受付は終了しました", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "次に進む", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("link", { name: "保存データを初期化する", exact: true }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      localStorage.getItem("synthetic-retained-at-closure"),
    ),
  ).toBe("retained")
  const contact = page.getByRole("link", {
    name: "support@example.invalid",
    exact: true,
  })
  await expect(contact).toHaveAttribute(
    "href",
    "mailto:support@example.invalid",
  )
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(contact).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  }
  const after = await localServices.state()
  expect(after.withdrawalHashes).toEqual(before.withdrawalHashes)
})
