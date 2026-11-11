// Run only against seeded, local demonstration data. Two algorithm runs are saved.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hiddenPassword } from "../src/terminal.js";
const base = process.env.BROWSER_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error(
    "Browser checks are restricted to a local demonstration server.",
  );
const passwords = {
  admin:
    process.env.BROWSER_ADMIN_PASSWORD ||
    (await hiddenPassword("Administrator demo password")),
  student:
    process.env.BROWSER_STUDENT_PASSWORD ||
    (await hiddenPassword("Student demo password")),
};
const out = process.env.BROWSER_OUTPUT || "docs/browser-output";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
});
const page = await context.newPage();
const findings = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function capture(name, url = null) {
  if (url) {
    const response = await page.goto(base + url);
    if (response.status() >= 500) throw new Error(`${name}: server error`);
  }
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => window.__campusMotionReady !== false);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector(".collapsing"));
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
  )
    throw new Error("Page overflow: " + name);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  if (process.env.SNAPSHOT_STATIC_ROOT) {
    const html = (await page.content())
      .replaceAll(
        'href="/static/',
        `href="file://${process.env.SNAPSHOT_STATIC_ROOT}/`,
      )
      .replaceAll(
        'src="/static/',
        `src="file://${process.env.SNAPSHOT_STATIC_ROOT}/`,
      );
    const localHtml = html.replace(
      "</head>",
      `<style>@font-face{font-family:Inter;src:url("file://${process.env.SNAPSHOT_STATIC_ROOT}/fonts/InterVariable.woff2") format("woff2");font-weight:100 900;font-display:swap}</style></head>`,
    );
    await writeFile(`${out}/${name}.html`, localHtml);
  }
  findings.push({
    page: name,
    viewport: page.viewportSize(),
    pageOverflow: false,
  });
}
async function login(role) {
  await page.goto(base + "/login");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => window.__campusMotionReady === true);
  await page.locator("#identifier").fill(role + "@campus.test");
  await page.locator("#password").fill(passwords[role]);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
try {
  await capture("01-login", "/login");
  await page.locator("#identifier").fill("admin@campus.test");
  await page.locator("#password").fill("incorrect");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  if (!(await page.getByRole("alert").isVisible()))
    throw new Error("Missing login validation");
  await capture("02-login-error");
  await login("admin");
  await capture("03-admin-dashboard", "/dashboard");
  if (!(await page.evaluate(() => document.fonts.check("16px Inter"))))
    throw new Error("Local variable font failed to load");
  if (!(await page.evaluate(() => typeof window.gsap?.timeline === "function")))
    throw new Error("GSAP did not initialize");
  await capture("04-events", "/events");
  await capture("05-event-form", "/events/new");
  const title = "Browser QA event " + randomUUID().slice(0, 8);
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 20);
  async function fillEvent(name, start, end) {
    await page.locator("#title").fill(name);
    await page
      .locator("#description")
      .fill("Disposable browser verification event");
    await page.locator("#event_date").fill(day.toISOString().slice(0, 10));
    await page.locator("#start_time").fill(start);
    await page.locator("#end_time").fill(end);
    await page
      .locator("#venue_id")
      .selectOption({ label: "Innovation Lab · capacity 40" });
    await page.locator("#expected_attendance").fill("10");
  }
  await fillEvent(title, "10:00", "11:00");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page.waitForURL("**/events");
  await page.getByRole("status").filter({ hasText: "Event saved." }).waitFor();
  let card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card.getByRole("link", { name: "Edit event" }).click();
  await capture("06-event-edit");
  await page.locator("#title").fill(title + " updated");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/events");
  await page.goto(base + "/events/new");
  await fillEvent(title + " conflict", "10:30", "11:30");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  if (
    !(await page
      .getByRole("alert")
      .getByText(/Venue conflict/)
      .isVisible())
  )
    throw new Error("Overlap accepted");
  await capture("07-event-validation");
  await page.goto(base + "/events");
  card = page.locator("article").filter({
    has: page.getByRole("heading", { name: title + " updated", exact: true }),
  });
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await capture("08-venues", "/venues");
  await capture("09-venue-form", "/venues/new");
  const venueName = "Browser QA venue " + randomUUID().slice(0, 8);
  await page.locator("#venue_name").fill(venueName);
  await page.locator("#capacity").fill("20");
  await page.locator("#resources").fill("Whiteboard");
  await page.getByRole("button", { name: "Save venue" }).click();
  await page.waitForURL("**/venues");
  card = page.locator("article").filter({
    has: page.getByRole("heading", { name: venueName, exact: true }),
  });
  await card.getByRole("link", { name: "Edit venue" }).click();
  await capture("10-venue-edit");
  await page.locator("#capacity").fill("25");
  await page.getByRole("button", { name: "Save venue" }).click();
  await page.waitForURL("**/venues");
  card = page.locator("article").filter({
    has: page.getByRole("heading", { name: venueName, exact: true }),
  });
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await capture("11-simulator-input", "/simulator");
  await page.getByRole("button", { name: "Run comparison" }).click();
  await page.waitForLoadState("networkidle");
  if ((await page.locator(".schedule-result").count()) !== 2)
    throw new Error("Missing comparisons");
  await capture("12-simulator-results");
  await page
    .getByRole("button", { name: "Save FCFS run", exact: true })
    .click();
  await page.waitForURL("**/runs/*");
  await capture("13-saved-fcfs");
  await page.goto(base + "/simulator");
  await page.getByRole("button", { name: "Run comparison" }).click();
  await page.getByRole("button", { name: "Save SJF run", exact: true }).click();
  await page.waitForURL("**/runs/*");
  await capture("14-saved-sjf");
  await capture("15-run-history", "/runs");
  for (const [name, url] of [
    ["16-dbms-reports", "/reports"],
    ["17-student-roster", "/reports?query=student_roster"],
    ["18-event-report", "/reports?query=available_events"],
    ["19-run-comparison", "/reports?query=run_comparison"],
  ])
    await capture(name, url);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await login("student");
  await capture("20-student-dashboard", "/dashboard");
  await capture("21-student-events", "/events");
  const register = page.getByRole("button", {
    name: "Register for event",
    exact: true,
  });
  if (await register.count()) {
    await register.first().click();
    await page
      .getByRole("status")
      .filter({ hasText: "Registration confirmed." })
      .waitFor();
    await page.waitForLoadState("networkidle");
  }
  await capture("22-registrations", "/registrations");
  await capture("23-forbidden", "/venues");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("24-mobile-dashboard", "/dashboard");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  if (
    !(await page
      .getByRole("link", { name: "CPU simulator", exact: true })
      .isVisible())
  )
    throw new Error("Mobile navigation failed");
  await capture("25-mobile-menu");
  await capture("26-mobile-events", "/events");
  await capture("27-mobile-registrations", "/registrations");
  await page.goto(base + "/simulator");
  await page.getByRole("button", { name: "Run comparison" }).click();
  await page.waitForLoadState("networkidle");
  await capture("28-mobile-simulator");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await capture("29-mobile-login", "/login");
  await login("admin");
  await capture("30-mobile-event-form", "/events/new");
  await capture("31-mobile-reports", "/reports");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await capture("32-dark-dashboard", "/dashboard");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(base + "/events");
  await page.locator("#event-search").fill("no-such-campus-event-987654");
  if ((await page.locator("[data-event-card]:visible").count()) !== 0)
    throw new Error("Search filter failed");
  await capture("33-empty-search");
  await page.locator("#event-search").fill("Research");
  if ((await page.locator("[data-event-card]:visible").count()) !== 1)
    throw new Error("Search match failed");
  await capture("34-filtered-events");
  await page.locator("#event-search").fill("");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  if (
    (await page.evaluate(() => document.documentElement.dataset.theme)) !==
    "dark"
  )
    throw new Error("Theme switch failed");
  await capture("35-chosen-dark-theme");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base + "/dashboard");
  if (
    (await page
      .locator(".panel")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName)) !== "none"
  )
    throw new Error("Reduced motion failed");
  await capture("36-reduced-motion");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.locator("#password").fill("visibility-test-only");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  if ((await page.locator("#password").getAttribute("type")) !== "text")
    throw new Error("Password reveal failed");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await page.locator("#password").fill("");
  await capture("37-password-hidden");
  const fallback = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const fallbackPage = await fallback.newPage();
  const fallbackResponse = await fallbackPage.goto(base + "/login");
  if (
    fallbackResponse.status() !== 200 ||
    !(await fallbackPage.locator("#password").isVisible())
  )
    throw new Error("No-JavaScript login fallback failed");
  await fallbackPage.screenshot({
    path: `${out}/38-no-javascript-login.png`,
    fullPage: true,
  });
  findings.push({
    page: "38-no-javascript-login",
    viewport: { width: 390, height: 844 },
    pageOverflow: await fallbackPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
  });
  if (findings.at(-1).pageOverflow)
    throw new Error("No-JavaScript fallback overflow");
  await fallback.close();
  if (errors.length) throw new Error(errors.join("; "));
  await writeFile(
    `${out}/browser-checks.json`,
    JSON.stringify(
      {
        findings,
        javascriptErrors: errors,
        checks: [
          "Login/validation",
          "Event create/edit/conflict/delete",
          "Venue create/edit/delete",
          "FCFS/SJF compare/save/retrieve",
          "Student registration/history",
          "Role restriction",
          "Mobile navigation",
          "Dark mode",
          "Event search and empty state",
          "Theme preference",
          "Reduced motion",
          "Password reveal/hide",
        ],
        note: "Checks use seeded local demo accounts; two algorithm runs and a student registration may be retained.",
      },
      null,
      2,
    ),
  );
  console.log(
    `Browser checks passed: ${findings.length} page states; no page-level overflow or JavaScript errors.`,
  );
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
