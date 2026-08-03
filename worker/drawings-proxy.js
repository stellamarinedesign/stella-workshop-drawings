/* =====================================================================
   Stella Marine — drawings PDF proxy  (Cloudflare Worker, free tier)

   WHY THIS EXISTS
   SharePoint refuses to be shown inside another page and sends no CORS
   headers, so a plain "Anyone with the link" PDF can't be displayed in the
   drawings app — the floor iPads get "refused to connect", and OneDrive's
   own Embed links demand a Microsoft sign-in the floor doesn't have.

   This worker fetches the file server-side (where those browser rules don't
   apply) and re-serves the bytes as an inline PDF that any page may frame.
   OneDrive stays the master copy: overwrite the file there and the floor
   sees the new revision, exactly as before.

   EXPOSURE: it will only fetch OneDrive/SharePoint URLs, and only ones you
   already shared as "Anyone with the link" — i.e. already readable by anyone
   holding the URL. It adds no new access to anything private. It is not an
   open proxy: any other host is refused.

   DEPLOY: see the README section "In-page PDF preview (Cloudflare Worker)".
   ===================================================================== */

/* The app origin allowed to call this worker. Add more if the app ever moves. */
const APP_ORIGINS = [
  "https://stellamarinedesign.github.io",
];

/* Only these upstreams may be fetched. Keeps this from becoming an open proxy. */
const ALLOWED_HOST_SUFFIXES = [".sharepoint.com"];
const ALLOWED_HOSTS         = ["1drv.ms"];

function corsHeaders(origin) {
  const allow = APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges, X-Proxy-Error, X-Proxy-Filename",
    "Vary": "Origin",
  };
}

/* Errors carry the reason in a header so the app can show it to the user. */
function fail(status, message, origin) {
  return new Response(message, {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type":  "text/plain; charset=utf-8",
      /* header values must be Latin-1 — a unicode char in an upstream error
         message must not turn this useful reply into a crash */
      "X-Proxy-Error": message.replace(/[^\x20-\x7E]/g, "?"),
      "Cache-Control": "no-store",
    },
  });
}

function allowedTarget(raw) {
  let t;
  try { t = new URL(raw); } catch { return null; }
  if (t.protocol !== "https:") return null;
  const h = t.hostname.toLowerCase();
  const ok = ALLOWED_HOSTS.includes(h)
          || ALLOWED_HOST_SUFFIXES.some(s => h.endsWith(s));
  return ok ? t : null;
}

/* SharePoint hands out several link shapes and they don't all honour the same
   download trick, so try the known ones in turn and keep the first that
   actually returns a file:
     1. the link itself with ?download=1   — works for /:b:/r/… path links
     2. /_layouts/15/download.aspx?share=TOKEN — the documented endpoint for
        short /:b:/g/personal/USER/TOKEN share links
   Order matters: cheapest/most general first. */
function candidateUrls(target) {
  const list = [];

  const direct = new URL(target.toString());
  direct.searchParams.set("download", "1");
  list.push(direct.toString());

  /* /:b:/g/personal/<user>/<token>  →  /personal/<user>/_layouts/15/download.aspx?share=<token> */
  const seg = target.pathname.split("/").filter(Boolean);   // [":b:", "g", "personal", user, token]
  const gIdx = seg.findIndex(s => s === "g");
  if (gIdx >= 0 && seg[gIdx + 1] === "personal" && seg.length >= gIdx + 4) {
    const user  = seg[gIdx + 2];
    const token = seg[seg.length - 1];
    list.push(`${target.origin}/personal/${user}/_layouts/15/download.aspx`
              + `?share=${encodeURIComponent(token)}`);
  }
  return list;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "GET" && request.method !== "HEAD")
      return fail(405, "Only GET and HEAD are supported.", origin);

    /* Only the app may use this service. Browser fetches from the app always
       carry an Origin (or at least a Referer) — requiring one stops drive-by
       reuse of this URL from burning the free request quota. (A determined
       curl user can spoof headers; this is a deterrent, not a vault — the
       files themselves are already "Anyone with the link".) */
    const src = request.headers.get("Origin") || request.headers.get("Referer") || "";
    if (!APP_ORIGINS.some(o => src === o || src.startsWith(o + "/")))
      return fail(403, "This preview service only answers the drawings app.", origin);

    const raw = new URL(request.url).searchParams.get("u");
    if (!raw) return fail(400, "Missing ?u= share link.", origin);

    const target = allowedTarget(raw);
    if (!target)
      return fail(403, "That isn't a OneDrive or SharePoint link.", origin);

    const headers = {
      /* SharePoint serves anonymous links differently to unknown agents */
      "User-Agent": "Mozilla/5.0 (compatible; StellaDrawings/1.0)",
      "Accept": "application/pdf,*/*",
    };
    const isHead = request.method === "HEAD";
    const range  = request.headers.get("Range");
    /* a HEAD only needs to prove the file is reachable — grab one byte */
    if (isHead)      headers["Range"] = "bytes=0-0";
    else if (range)  headers["Range"] = range;

    /* short edge cache so repeat views (the common case on the floor) skip the
       OneDrive round-trip entirely. Only full-file GETs are cached; a revised
       PDF is at most CACHE_SECONDS stale, and only for viewers, not downloads. */
    const CACHE_SECONDS = 300;
    const cacheable = !isHead && !range;
    const cacheKey = new Request(
      "https://cache.internal/?u=" + encodeURIComponent(target.toString()));
    if (cacheable) {
      const hit = await caches.default.match(cacheKey);
      if (hit) {
        const out2 = new Headers(hit.headers);
        for (const [k, v] of Object.entries(corsHeaders(origin))) out2.set(k, v);
        out2.set("Cache-Control", "no-store");
        return new Response(hit.body, { status: 200, headers: out2 });
      }
    }

    /* SharePoint link shapes don't all honour the same download form, so fire
       the known ones IN PARALLEL and answer with the FIRST that returns an
       actual file — never slower than one form alone. Late losers get their
       bodies cancelled after the response has gone out. */
    const isPdf = r => (r.ok || r.status === 206)
      && !(r.headers.get("Content-Type") || "").toLowerCase().includes("text/html");
    const attempts = candidateUrls(target).map(u =>
      fetch(u, { redirect: "follow", headers })
        .then(r => ({ res: r }), err => ({ err })));

    const upstream = await new Promise(resolve => {
      let pending = attempts.length, winner = null;
      let lastStatus = 0, sawHtml = false, netErr = null;
      for (const p of attempts) p.then(a => {
        if (winner) { a.res?.body?.cancel(); checkDone(); return; }
        if (a.res && isPdf(a.res)) { winner = a.res; resolve({ res: a.res }); checkDone(); return; }
        if (a.err) netErr = a.err;
        else if (!a.res.ok && a.res.status !== 206) { lastStatus = a.res.status; a.res.body?.cancel(); }
        else { sawHtml = true; a.res.body?.cancel(); }
        checkDone();
      });
      function checkDone() {
        if (--pending === 0 && !winner) resolve({ lastStatus, sawHtml, netErr });
      }
    });
    /* keep the worker alive until the losing fetches are tidied away */
    ctx.waitUntil(Promise.allSettled(attempts));

    if (!upstream.res) {
      if (upstream.sawHtml)
        return fail(403,
          'OneDrive sent a web page instead of the file. Check the drawing is '
          + 'still shared as "Anyone with the link", and that the link points at '
          + 'the PDF itself.', origin);
      if (upstream.lastStatus)
        return fail(502,
          `OneDrive returned ${upstream.lastStatus}. The link may have been `
          + `revoked, or the file renamed or moved.`, origin);
      return fail(502, "Couldn't reach OneDrive: "
        + (upstream.netErr ? upstream.netErr.message : "no response"), origin);
    }

    const out = new Headers(corsHeaders(origin));
    out.set("Content-Type", "application/pdf");
    out.set("Content-Disposition", "inline");
    /* browsers always revalidate with us; the freshness window lives at the edge */
    out.set("Cache-Control", "no-store");

    /* pass the original filename through — the app uses it to fill the
       drawing number and description from nothing but the share link.
       URI-encoded because header values must be Latin-1. */
    const cd = upstream.res.headers.get("Content-Disposition") || "";
    let fn = "";
    let m = cd.match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
    if (m) { try { fn = decodeURIComponent(m[1].trim().replace(/^"|"$/g, "")); } catch {} }
    if (!fn) {
      m = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
      if (m) fn = m[1].trim();
    }
    if (fn) out.set("X-Proxy-Filename", encodeURIComponent(fn));

    if (isHead)
      return new Response(null, { status: 200, headers: out });

    for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const v = upstream.res.headers.get(h);
      if (v) out.set(h, v);
    }

    /* full-file 200s: stream to the viewer and the edge cache at once */
    if (cacheable && upstream.res.status === 200 && upstream.res.body) {
      const [toClient, toCache] = upstream.res.body.tee();
      const cacheHeaders = new Headers(out);
      cacheHeaders.set("Cache-Control", "s-maxage=" + CACHE_SECONDS);
      ctx.waitUntil(caches.default.put(cacheKey,
        new Response(toCache, { status: 200, headers: cacheHeaders })));
      return new Response(toClient, { status: 200, headers: out });
    }
    return new Response(upstream.res.body, { status: upstream.res.status, headers: out });
  },
};
