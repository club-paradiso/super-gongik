// Deterministic visual snapshots for design review (not a pass/fail gate).
// Seeds the unit-tested "mid-service" fixture with a pinned Seoul clock and
// captures the representative screens in light and dark.
//
//   RELEASE_GATE_BASE_URL=http://127.0.0.1:3000 \
//   VISUAL_SNAPSHOT_DIR=artifacts/visual node scripts/visual-snapshots.cjs
//
// RELEASE_GATE_BROWSER=webkit|chromium picks the engine (chromium default).
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");
const fixtures = require("./fixtures/home-scenarios.json");

const browserType =
  playwright[process.env.RELEASE_GATE_BROWSER || "chromium"] ||
  playwright.chromium;
const baseURL = process.env.RELEASE_GATE_BASE_URL || "http://127.0.0.1:3000";
const output =
  process.env.VISUAL_SNAPSHOT_DIR ||
  path.join(process.cwd(), "artifacts", "visual");
fs.mkdirSync(output, { recursive: true });

const fixture = fixtures.find((item) => item.key === "mid-service");

async function open(browser, { width, height, scheme, seed = true }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: width >= 960 ? 1 : 2,
    isMobile: width < 960 && browserType !== playwright.firefox,
    hasTouch: width < 960,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`pageerror: ${e.message}`));
  await page.clock.setFixedTime(new Date(fixture.now));
  if (seed) {
    await page.addInitScript(
      ({ key, value }) => {
        if (!sessionStorage.getItem("visual-seeded")) {
          localStorage.setItem(key, value);
          sessionStorage.setItem("visual-seeded", "1");
        }
      },
      { key: fixture.storageKey, value: fixture.storageValue },
    );
  }
  await page.goto(baseURL);
  return { context, page };
}

async function shot(page, name, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
  console.log(`captured ${name}`);
}

async function openTab(page, width, label) {
  await page
    .locator(width >= 960 ? ".desktop-nav" : ".tab-bar")
    .getByRole("button", { name: label, exact: true })
    .click();
}

const mobile = [320, 390, 430];
const desktop = [768, 1440];

(async () => {
  const browser = await browserType.launch();
  try {
    for (const scheme of ["light", "dark"]) {
      const onboarding = await open(browser, {
        width: 390,
        height: 844,
        scheme,
        seed: false,
      });
      await onboarding.page.locator("#onboarding-title").waitFor();
      await shot(onboarding.page, `onboarding-390-${scheme}`, true);
      await onboarding.context.close();

      for (const width of [...mobile, ...desktop]) {
        const height = width >= 960 ? 900 : width === 768 ? 1024 : 844;
        const { context, page } = await open(browser, {
          width,
          height,
          scheme,
        });
        await page.locator(".hero").waitFor();
        await shot(page, `home-${width}-${scheme}`);
        if (width === 390 || width === 1440) {
          await shot(page, `home-${width}-${scheme}-full`, true);
          for (const [label, selector, name] of [
            ["캘린더", ".calendar-page", "calendar"],
            ["급여", ".money-page", "money"],
            ["내 정보", ".profile-page", "profile"],
          ]) {
            await openTab(page, width, label);
            await page.locator(selector).waitFor();
            await shot(page, `${name}-${width}-${scheme}`);
            await shot(page, `${name}-${width}-${scheme}-full`, true);
            if (name === "calendar") {
              await page.getByRole("button", { name: /기록 추가/ }).click();
              await page.locator("dialog.sheet").waitFor();
              await shot(page, `sheet-${width}-${scheme}`);
              await page.keyboard.press("Escape");
            }
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
