import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = "/opt/cursor/artifacts/carbitrage";
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8080";

const browser = await chromium.launch();
const notes = [];

async function run(name, viewport, walk) {
  const context = await browser.newContext({
    viewport,
    recordVideo: name === "desktop" ? { dir: out, size: viewport } : undefined,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await walk(page, async (file) => {
    await page.screenshot({ path: `${out}/${file}`, fullPage: true });
    notes.push(file);
  });
  await context.close();
  if (errors.length) {
    console.log(name, "pageerrors", errors);
    process.exitCode = 1;
  }
}

async function patrick(page, shot, prefix) {
  await page.goto(`${base}/portal/login`, { waitUntil: "networkidle" });
  await page.getByTestId("persona-patrick").waitFor();
  await shot(`${prefix}-01-login.png`);
  await page.getByTestId("persona-patrick").click();
  await page.getByTestId("finds-list").waitFor();
  await page.getByTestId("under-floor").first().waitFor();
  await shot(`${prefix}-02-finds.png`);
  await page.getByTestId("find-card").first().click();
  await page.getByTestId("find-detail").waitFor();
  await page.getByTestId("source-link").waitFor();
  await shot(`${prefix}-03-detail.png`);
  await page.getByRole("button", { name: "Shortlist" }).click();
  await page.getByRole("button", { name: "Shortlist" }).waitFor();
  await shot(`${prefix}-04-shortlisted.png`);
  await page.getByRole("link", { name: "DNA" }).click();
  await page.getByTestId("dna-page").waitFor();
  await page.getByText("No Ooglecars yard id").waitFor();
  await shot(`${prefix}-05-dna.png`);
  await page.getByRole("link", { name: "Alerts" }).click();
  await page.getByTestId("alerts-page").waitFor();
  await shot(`${prefix}-06-alerts.png`);
  await page.getByRole("link", { name: "Insights" }).click();
  await page.getByTestId("insights-page").waitFor();
  await shot(`${prefix}-07-insights.png`);
  await page.goto(`${base}/portal/finds?make=NoSuchMake`, { waitUntil: "networkidle" });
  await page.getByTestId("portal-empty").waitFor();
  await shot(`${prefix}-08-empty.png`);
  await page.goto(`${base}/portal/finds/does-not-exist`, { waitUntil: "networkidle" });
  await page.getByTestId("portal-error").waitFor();
  await shot(`${prefix}-09-error.png`);
}

await run("desktop", { width: 1440, height: 900 }, async (page, shot) => {
  await patrick(page, shot, "desktop");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByTestId("persona-outsider").waitFor();
  await page.getByTestId("persona-outsider").click();
  await page.getByTestId("finds-list").waitFor();
  await page.getByText("Other Motors buyer").waitFor();
  await shot("desktop-10-other-yard.png");
});

await run("mobile", { width: 390, height: 844 }, async (page, shot) => {
  await patrick(page, shot, "mobile");
});

await browser.close();
console.log(notes.join("\n"));
