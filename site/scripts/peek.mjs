// Dev helper: screenshots of the home page at given scroll positions (px, or
// "Nvh" for multiples of the viewport), motion on, live WebGL via ?fx-force.
// node scripts/peek.mjs 1440 900 0 100vh 200vh ...
import { BASE, launch } from "./chrome.mjs";
const [w, h, ...stops] = process.argv.slice(2);
const out = process.env.OUT ?? "/tmp/peek/";
const browser = await launch(false, ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]);
const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem("motion", "on"));
await page.goto(`${BASE}?fx-force`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
for (const s of stops.length ? stops : ["0"]) {
  const y = s.endsWith("vh") ? (parseFloat(s) / 100) * +h : +s;
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(1300);
  const file = `${out}${w}-${s}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
