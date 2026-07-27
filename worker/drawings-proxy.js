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
      "Content-Length, Content-Range, Accept-Ranges, X-Proxy-Error",
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
      "X-Proxy-Error": message,
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
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "GET" && request.method !== "HEAD")
      return fail(405, "Only GET and HEAD are supported.", origin);

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

    let upstream = null, lastStatus = 0, sawHtml = false;
    for (const candidate of candidateUrls(target)) {
      let res;
      try {
        res = await fetch(candidate, { redirect: "follow", headers });
      } catch (err) {
        return fail(502, "Couldn't reach OneDrive: " + err.message, origin);
      }
      lastStatus = res.status;
      if (!res.ok && res.status !== 206) { await res.body?.cancel(); continue; }
      /* HTML means a sign-in or viewer page came back instead of the file */
      if ((res.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
        sawHtml = true;
        await res.body?.cancel();
        continue;
      }
      upstream = res;
      break;
    }

    if (!upstream)
      return fail(sawHtml ? 403 : 502, sawHtml
        ? 'OneDrive sent a web page instead of the file. Check the drawing is '
          + 'still shared as "Anyone with the link", and that the link points at '
          + 'the PDF itself.'
        : `OneDrive returned ${lastStatus}. The link may have been revoked, or `
          + `the file renamed or moved.`, origin);

    const out = new Headers(corsHeaders(origin));
    out.set("Content-Type", "application/pdf");
    out.set("Content-Disposition", "inline");
    /* drawings are revised in place, so never hand back a stale copy */
    out.set("Cache-Control", "no-store");

    if (isHead)
      return new Response(null, { status: 200, headers: out });

    for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
