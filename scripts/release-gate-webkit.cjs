const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webkit } = require("playwright");

const baseUrl = process.env.RELEASE_GATE_BASE_URL || "http://127.0.0.1:3000";
const artifactDir =
  process.env.RELEASE_GATE_ARTIFACT_DIR ||
  path.join(process.cwd(), "artifacts", "webkit-mobile");

const viewports = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

fs.mkdirSync(artifactDir, { recursive: true });

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1 &&
      metrics.bodyScrollWidth <= metrics.innerWidth + 1,
    `${label}: horizontal overflow detected: ${JSON.stringify(metrics)}`,
  );
}

async function shot(page, viewport, name) {
  await page.screenshot({
    path: path.join(
      artifactDir,
      `${viewport.width}x${viewport.height}-${name}.png`,
    ),
    fullPage: false,
  });
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];

  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#onboarding-title").waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page, `${viewport.width} onboarding`);

  const dateInputs = page.locator('input[type="date"]');
  assert.ok((await dateInputs.count()) >= 2, "onboarding date fields missing");
  await dateInputs.nth(0).fill("2026-03-16");
  await page.waitForFunction(() => {
    const fields = document.querySelectorAll('input[type="date"]');
    return Boolean(fields[1] && fields[1].value);
  });

  const discharge = await dateInputs.nth(1).inputValue();
  assert.match(discharge, /^\d{4}-\d{2}-\d{2}$/, "auto discharge date missing");
  const formatted = await page
    .locator(".date-input__display")
    .first()
    .textContent();
  assert.match(
    formatted || "",
    /2026년\s*3월\s*16일/,
    "Korean date overlay missing",
  );

  const primary = page.getByRole("button", { name: "복무 현황 보기" });
  assert.equal(
    await primary.isEnabled(),
    true,
    "primary CTA should be enabled",
  );
  await shot(page, viewport, "onboarding");

  await primary.click();
  await page.locator(".progress-hero").waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page, `${viewport.width} home`);

  const tabBar = page.locator(".tab-bar");
  const tabBox = await tabBar.boundingBox();
  assert.ok(tabBox, "bottom tab bar missing");
  assert.ok(
    tabBox.y + tabBox.height <= viewport.height + 2,
    `tab bar falls below viewport: ${JSON.stringify(tabBox)}`,
  );
  await shot(page, viewport, "home");

  await tabBar.getByRole("button", { name: "캘린더", exact: true }).click();
  await page.locator(".calendar-page").waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page, `${viewport.width} calendar`);
  await shot(page, viewport, "calendar");

  await page.getByRole("button", { name: /기록 추가/ }).click();
  const sheet = page.locator("dialog.sheet");
  await sheet.waitFor({ state: "visible" });
  const sheetBox = await sheet.boundingBox();
  const actionsBox = await page.locator(".sheet__actions").boundingBox();
  assert.ok(sheetBox && actionsBox, "event editor geometry unavailable");
  assert.ok(
    sheetBox.y + sheetBox.height <= viewport.height + 2,
    `event sheet exceeds viewport: ${JSON.stringify(sheetBox)}`,
  );
  assert.ok(
    actionsBox.y + actionsBox.height <= viewport.height + 2,
    `event actions hidden below viewport: ${JSON.stringify(actionsBox)}`,
  );
  await assertNoHorizontalOverflow(page, `${viewport.width} event editor`);
  await shot(page, viewport, "event-editor");
  await page.getByRole("button", { name: "닫기" }).click();
  await sheet.waitFor({ state: "hidden" });

  await tabBar.getByRole("button", { name: "보수", exact: true }).click();
  await page.locator(".money-page").waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page, `${viewport.width} money`);

  await tabBar.getByRole("button", { name: "내 정보", exact: true }).click();
  await page.locator(".profile-page").waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page, `${viewport.width} profile`);
  await shot(page, viewport, "profile");

  assert.deepEqual(
    errors,
    [],
    `${viewport.width}: browser errors: ${errors.join(" | ")}`,
  );
  await context.close();
}

(async () => {
  const browser = await webkit.launch();
  try {
    for (const viewport of viewports) {
      await runViewport(browser, viewport);
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(
    `WebKit mobile release gate passed for ${viewports
      .map((item) => `${item.width}x${item.height}`)
      .join(", ")}.\n`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
