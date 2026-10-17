// Screenshots of DevCat Mobile running in a browser against the mobile bridge + demo host.
// Needs: `cargo run --example remotedemo` (src-tauri), `cargo run --example bridge` (mobile/src-tauri),
// `pnpm mobile:bridge`. Usage: node mobile-capture.mjs <pair link> [out dir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const LINK = process.argv[2];
const OUT = (process.argv[3] ?? new URL("./public/mobile/", import.meta.url).pathname).replace(/\/?$/, "/");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "dark", isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) DevCat" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const shot = async (name) => { await sleep(500); await page.screenshot({ path: `${OUT}${name}.png` }); console.log(`✓ ${name}`); };
const tap = async (text, opts = {}) => { await page.getByText(text, { exact: true, ...opts }).first().click(); await sleep(700); };
const back = async () => { await page.getByLabel("Back").first().click(); await sleep(600); };

await page.goto("http://localhost:1442/");
await sleep(1500);
await shot("01-welcome");
await tap("Paste pairing link");
await page.locator("textarea").first().fill(LINK);
await shot("02-paste");
await tap("Continue");
await shot("03-pairing");
await page.getByRole("button", { name: "Connect" }).click();
await sleep(600);
await shot("04-approve");
await page.getByText("Agents", { exact: true }).first().waitFor({ timeout: 20000 });
await sleep(1500);
await shot("05-agents");

await page.getByText("needs your permission", { exact: false }).first().click();
await sleep(2000);
await shot("06-terminal");
await page.getByLabel("Terminal menu").click();
await shot("07-terminal-menu");
await page.mouse.click(195, 100);
await sleep(400);
await page.getByPlaceholder("Message Claude…").fill("1");
await page.getByLabel("Send").click();
await sleep(800);
await back();

await page.getByRole("button", { name: "New" }).click();
await sleep(1200);
await shot("08-newchat");
await back();
await tap("Session history");
await sleep(800);
await shot("09-sessions");
await tap("Fix checkout total with coupons");
await sleep(800);
await shot("10-transcript");
await back(); await back();

await tap("Data");
await sleep(1200);
await shot("11-data");
await tap("shop-db");
await shot("12-browse");
await tap("shop"); await tap("public"); await tap("Tables");
await shot("13-tables");
await tap("orders");
await sleep(800);
await shot("14-rows");
await page.locator("main button").nth(1).click();
await sleep(1200);
await shot("15-row");
await back(); await back();
await page.getByRole("button", { name: "Query" }).click();
await sleep(600);
await page.locator("textarea").fill("SELECT country, count(*) AS orders, sum(total) AS revenue\nFROM orders WHERE paid\nGROUP BY country ORDER BY revenue DESC;");
await page.getByRole("button", { name: "Run" }).click();
await sleep(1200);
await shot("16-query");
await page.locator("textarea").fill("DELETE FROM orders;");
await page.getByRole("button", { name: "Run" }).click();
await sleep(600);
await shot("17-confirm");
await page.getByRole("button", { name: "Cancel" }).last().click();
await sleep(300);

await page.goto("http://localhost:1442/");
await sleep(2500);
await tap("Data");
await sleep(1000);
await tap("shop-cache"); await tap("db0"); await tap("user");
await shot("18-redis");
await tap("1001");
await sleep(800);
await shot("19-rediskey");

await page.goto("http://localhost:1442/");
await sleep(2500);
await tap("Network");
await sleep(2500);
await shot("20-network");
await tap("Cluster");
await sleep(2500);
await shot("21-cluster");
await page.getByText("search-indexer", { exact: false }).first().click();
await sleep(3500);
await shot("22-pod");
await back();
await tap("Deployments");
await sleep(1200);
await shot("23-deployments");

await tap("More");
await sleep(1200);
await shot("24-more");
await tap("Notifications");
await sleep(800);
await shot("25-notify");
await back();
await tap("Activity log");
await sleep(800);
await shot("26-activity");
await back();
await tap("Help & troubleshooting");
await page.getByText("The computer shows Offline").click();
await shot("27-help");
await back();
await page.getByText("Switch computer").click();
await sleep(1200);
await shot("28-computers");

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
await browser.close();
