#!/usr/bin/env node
// Unit check for worker.js: single-range requests answer 206 with the right
// bytes and headers, bad ranges answer 416, no Range header answers 200.
import assert from "node:assert/strict";
import { parseRange, serveMedia } from "../worker.js";

const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
const env = {
  ASSETS: {
    fetch: async () => new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": "1000" } }),
  },
};
const get = (range, method = "GET") =>
  serveMedia(new Request("https://x.test/media/a.mp4", { method, headers: range ? { range } : {} }), env);

assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
assert.deepEqual(parseRange("bytes=500-5000", 1000), { start: 500, end: 999 });
assert.equal(parseRange("bytes=2000-", 1000), "unsatisfiable");
assert.equal(parseRange("bytes=0-1,5-9", 1000), null);
assert.equal(parseRange("items=0-1", 1000), null);

let r = await get("bytes=10-19");
assert.equal(r.status, 206);
assert.equal(r.headers.get("content-range"), "bytes 10-19/1000");
assert.equal(r.headers.get("content-length"), "10");
assert.equal(r.headers.get("accept-ranges"), "bytes");
assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...bytes.slice(10, 20)]);

r = await get("bytes=5000-");
assert.equal(r.status, 416);
assert.equal(r.headers.get("content-range"), "bytes */1000");

r = await get(null);
assert.equal(r.status, 200);
assert.equal(r.headers.get("accept-ranges"), "bytes");
assert.equal((await r.arrayBuffer()).byteLength, 1000);

r = await get("bytes=0-9", "HEAD");
assert.equal(r.status, 206);
assert.equal(r.headers.get("content-length"), "10");
console.log("media range checks passed");
