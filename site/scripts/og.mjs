#!/usr/bin/env node
// Renders public/og.png from src/og.html, public/og-changelog.png from
// src/og-changelog.html, and public/apple-touch-icon.png from
// the favicon, through a throwaway Vite dev server so the real fonts and
// tokens are used. Run after shoot-pile.mjs, which makes the heap image.
import { createServer } from "vite";
import { launch } from "./chrome.mjs";

const server = await createServer({ server: { port: 4399, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await launch();

const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.goto("http://localhost:4399/src/og.html");
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: "public/og.png" });

// The changelog's own card: the cover slip with the newest version, curling.
await og.goto("http://localhost:4399/src/og-changelog.html");
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: "public/og-changelog.png" });

const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(`<body style="margin:0"><img src="http://localhost:4399/favicon.svg" width="180" height="180"></body>`);
await icon.waitForTimeout(200);
await icon.screenshot({ path: "public/apple-touch-icon.png" });

await browser.close();
await server.close();
console.log("wrote public/og.png, public/og-changelog.png and public/apple-touch-icon.png");
