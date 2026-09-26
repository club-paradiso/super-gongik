const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// WebKit in CI. RELEASE_GATE_BROWSER=chromium lets a machine without the
// WebKit runtime run the same assertions; it does not replace the CI gate.
const browserType =
  playwright[process.env.RELEASE_GATE_BROWSER || "webkit"] || playwright.webkit;

const scenarios = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "home-scenarios.json"),
    "utf8",
  ),
);

const baseUrl = process.env.RELEASE_GATE_BASE_URL || "http://127.0.0.1:3000";
const artifactDir =
  process.env.RELEASE_GATE_ARTIFACT_DIR ||
  path.join(process.cwd(), "artifacts", "webkit-mobile");

const viewports = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
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
  await page.locator(".hero").waitFor({ state: "visible" });
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

  await tabBar.getByRole("button", { name: "급여", exact: true }).click();
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

function seoulMidnightMinus(nowIso, seconds) {
  // Fixture instants are 09:00 KST; 00:00 KST next day is 15 h later.
  return new Date(Date.parse(nowIso) + 15 * 3_600_000 - seconds * 1000);
}

async function seededPage(browser, viewport, scenario, errors, install) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    errors.push(`${scenario.key} pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`${scenario.key} console: ${message.text()}`);
  });
  if (install) await page.clock.install({ time: install });
  else await page.clock.setFixedTime(new Date(scenario.now));
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("gate-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("gate-seeded", "1");
      }
    },
    [scenario.storageKey, scenario.storageValue],
  );
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".hero").waitFor({ state: "visible" });
  return { context, page };
}

async function runHomeStates(browser, viewport) {
  const errors = [];
  for (const scenario of scenarios) {
    const label = `${viewport.width} ${scenario.key}`;
    const { context, page } = await seededPage(
      browser,
      viewport,
      scenario,
      errors,
    );
    const headline = page.locator("#hero-headline [aria-hidden]");
    assert.equal(
      (await headline.textContent())?.trim(),
      scenario.expect.headline,
      `${label}: hero headline`,
    );
    assert.equal(
      await page.locator(".hero").getAttribute("data-phase"),
      scenario.expect.phase,
      `${label}: hero phase`,
    );

    // One-second comprehension: the D-day sits in the top half of the
    // first screen, above any card.
    const box = await headline.boundingBox();
    assert.ok(
      box && box.y + box.height <= viewport.height / 2,
      `${label}: D-day not in the top half: ${JSON.stringify(box)}`,
    );

    const bar = page.getByRole("progressbar", { name: "복무 진행률" });
    assert.equal(
      await bar.count(),
      scenario.expect.progressbar ? 1 : 0,
      `${label}: progressbar presence`,
    );
    if (scenario.expect.progressbar) {
      assert.match(
        (await bar.getAttribute("aria-valuetext")) || "",
        /^복무 \d+\.\d% 완료, \d+일 지남, \d+일 남음$/,
        `${label}: progress text alternative`,
      );
    }

    // Every home control is a comfortable touch target.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll(".home button")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent.trim().slice(0, 20),
            width: rect.width,
            height: rect.height,
          };
        })
        .filter((rect) => rect.width < 44 || rect.height < 44),
    );
    assert.deepEqual(small, [], `${label}: touch targets under 44px`);

    await assertNoHorizontalOverflow(page, `${label} home`);
    await page.screenshot({
      path: path.join(
        artifactDir,
        `${viewport.width}x${viewport.height}-home-${scenario.key}.png`,
      ),
      fullPage: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, [], `${viewport.width}: ${errors.join(" | ")}`);
}

/**
 * The D-day must turn over at 00:00 Asia/Seoul while the app stays open,
 * without a reload or leaving the screen.
 */
async function runMidnightRollover(browser, viewport) {
  const errors = [];
  for (const scenario of scenarios.filter(
    (item) => item.expect.headline !== item.expect.headlineTomorrow,
  )) {
    const { context, page } = await seededPage(
      browser,
      viewport,
      scenario,
      errors,
      seoulMidnightMinus(scenario.now, 5),
    );
    const headline = page.locator("#hero-headline [aria-hidden]");
    assert.equal(
      (await headline.textContent())?.trim(),
      scenario.expect.headline,
      `${scenario.key}: headline before midnight`,
    );
    await page.clock.runFor(10_000);
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector("#hero-headline [aria-hidden]")
          ?.textContent?.trim() === expected,
      scenario.expect.headlineTomorrow,
      { timeout: 5_000 },
    );
    await context.close();
  }
  assert.deepEqual(errors, [], `midnight: ${errors.join(" | ")}`);
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const viewport of viewports) {
      await runViewport(browser, viewport);
      await runHomeStates(browser, viewport);
    }
    await runMidnightRollover(browser, viewports[0]);
  } finally {
    await browser.close();
  }

  process.stdout.write(
    `${browserType.name()} mobile release gate passed (${scenarios.length} home states, midnight rollover) for ${viewports
      .map((item) => `${item.width}x${item.height}`)
      .join(", ")}.\n`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
