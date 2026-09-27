const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webkit } = require("playwright");
const fixtures = require("./fixtures/home-scenarios.json");
const baseURL = process.env.RELEASE_GATE_BASE_URL || "http://127.0.0.1:3000";
const output = process.env.RELEASE_GATE_ARTIFACT_DIR || "/tmp/horizon-qa";
fs.mkdirSync(output, { recursive: true });
const fixture = fixtures.find((item) => item.key === "mid-service");
const widths = [320, 360, 375, 390, 393, 430, 768, 1024, 1280];

async function noOverflow(page, label) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    label,
  );
  assert.equal(
    (await page.locator("body").innerText()).includes("원장"),
    false,
    `${label}: terminology`,
  );
}
async function capture(page, label) {
  await page.screenshot({
    path: path.join(output, `${label}.png`),
    fullPage: true,
  });
}
function nav(page, width) {
  return page.locator(width >= 960 ? ".desktop-nav" : ".tab-bar");
}
async function openTab(page, width, label) {
  await nav(page, width)
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function contrast(page) {
  const pairs = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const token = (name) => css.getPropertyValue(name).trim();
    return [
      ["--text-primary", "--surface"],
      ["--text-secondary", "--background"],
      ["--text-tertiary", "--surface-interactive"],
      ["--on-accent", "--accent-primary"],
      ["--hero-fg-3", "--hero-bg"],
      ["--accent-primary", "--surface"],
      ["--warning", "--warning-background"],
      ["--danger", "--danger-background"],
    ].map(([fg, bg]) => ({ fg, bg, a: token(fg), b: token(bg) }));
  });
  const luminance = (hex) => {
    assert.match(hex, /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i);
    const normalized =
      hex.length === 4
        ? `#${hex
            .slice(1)
            .split("")
            .map((part) => part + part)
            .join("")}`
        : hex;
    const c = [1, 3, 5]
      .map((i) => parseInt(normalized.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  for (const p of pairs) {
    const a = luminance(p.a),
      b = luminance(p.b);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, `${p.fg}/${p.bg}: ${ratio.toFixed(2)}:1`);
  }
}
async function run(browser, width, scheme) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await page.clock.install({ time: new Date(fixture.now) });
  const data = JSON.parse(fixture.storageValue);
  data.profile.liveProgressEnabled = true;
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem("horizon-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("horizon-seeded", "1");
      }
    },
    { key: fixture.storageKey, value: JSON.stringify(data) },
  );
  await page.goto(baseURL);
  await page.locator('.hero__readout[data-live="true"]').waitFor();
  const sample = () => page.locator(".hero__percent--live").textContent();
  const first = await sample();
  const time = await page.locator(".hero__countdown").textContent();
  const rect = await page.locator(".hero__countdown").boundingBox();
  const samples = [first];
  for (let index = 0; index < 5; index += 1) {
    await page.clock.runFor(1000);
    samples.push(await sample());
  }
  assert.match(first, /^\d+\.\d{6}%$/);
  assert.ok(
    samples.every(
      (value, index) =>
        index === 0 || parseFloat(value) >= parseFloat(samples[index - 1]),
    ),
    `live percentage regressed: ${samples.join(" → ")}`,
  );
  assert.ok(
    samples.some(
      (value, index) =>
        index > 0 && parseFloat(value) > parseFloat(samples[index - 1]),
    ),
    `live percentage did not advance across one-second samples: ${samples.join(" → ")}`,
  );
  assert.notEqual(await page.locator(".hero__countdown").textContent(), time);
  assert.deepEqual(
    await page.locator(".hero__countdown").boundingBox(),
    rect,
    "clock layout remains stable",
  );
  assert.match(await page.locator(".hero__pay").textContent(), /호봉/);
  await noOverflow(page, `${width} ${scheme} home`);
  await contrast(page);
  await capture(page, `horizon-${width}-${scheme}-home`);
  for (const [label, selector] of [
    ["캘린더", ".calendar-page"],
    ["급여", ".money-page"],
    ["내 정보", ".profile-page"],
  ]) {
    await openTab(page, width, label);
    await page.locator(selector).waitFor();
    await noOverflow(page, `${width} ${scheme} ${label}`);
    if (label === "급여")
      assert.match(
        await page.locator(".money-summary__steps").innerText(),
        /호봉/,
      );
    await capture(page, `horizon-${width}-${scheme}-${selector.slice(1)}`);
    if (label === "캘린더") {
      await page.getByRole("button", { name: /기록 추가/ }).click();
      await page.locator("dialog.sheet").waitFor();
      await noOverflow(page, `${width} ${scheme} sheet`);
      await capture(page, `horizon-${width}-${scheme}-sheet`);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog.sheet").isVisible(), false);
    }
  }
  // The real saved preference, not a mocked switch, controls mounting.
  const checkbox = page.getByRole("checkbox", {
    name: "D-day와 복무율을 초 단위로 실시간 표시",
  });
  await checkbox.uncheck();
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
  await page.reload();
  await page.locator('.hero__readout[data-live="false"]').waitFor();
  assert.equal(await page.locator(".hero__countdown").count(), 0);
  const frozen = await page.locator(".hero__percent").textContent();
  await page.clock.runFor(3000);
  assert.equal(await page.locator(".hero__percent").textContent(), frozen);
  await openTab(page, width, "내 정보");
  await checkbox.check();
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
  await page.reload();
  await page.locator('.hero__readout[data-live="true"]').waitFor();
  assert.deepEqual(errors, []);
  await context.close();
}
(async () => {
  const browser = await webkit.launch();
  try {
    for (const width of widths)
      for (const scheme of ["light", "dark"]) await run(browser, width, scheme);
  } finally {
    await browser.close();
  }
  console.log(
    `HORIZON release gate passed: ${widths.join(", ")}px, light/dark, live ticks under reduced motion, preference persistence, pay steps, dialogs, terminology and token contrast.`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
