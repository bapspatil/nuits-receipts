// Serves /media/* with HTTP Range support. Workers static assets ignore the
// Range header and answer 200 with the whole file, which Safari and every
// browser on iPhone treat as "cannot stream", so the demo video would never
// start there. Everything else on the site is still served straight from the
// assets without running this Worker (see run_worker_first in wrangler.jsonc).

const RANGE = /^bytes=(\d*)-(\d*)$/;

export function parseRange(header, size) {
  const m = RANGE.exec((header ?? "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start;
  let end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start >= size || start > end ? "unsatisfiable" : { start, end };
}

export async function serveMedia(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
  const wanted = request.headers.get("range");
  const full = await env.ASSETS.fetch(new Request(request.url, { method: "GET" }));
  const headers = new Headers(full.headers);
  headers.set("accept-ranges", "bytes");
  if (!full.ok || full.status !== 200 || !wanted) {
    return new Response(request.method === "HEAD" ? null : full.body, { status: full.status, headers });
  }
  const body = await full.arrayBuffer();
  const range = parseRange(wanted, body.byteLength);
  if (range === null) return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${body.byteLength}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${range.start}-${range.end}/${body.byteLength}`);
  headers.set("content-length", String(range.end - range.start + 1));
  return new Response(request.method === "HEAD" ? null : body.slice(range.start, range.end + 1), {
    status: 206,
    headers,
  });
}

export default {
  fetch: (request, env) => serveMedia(request, env),
};
