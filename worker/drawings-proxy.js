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

    /* ask SharePoint for the file itself rather than its viewer page */
    target.searchParams.set("download", "1");

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

    let upstream;
    try {
      upstream = await fetch(target.toString(), { redirect: "follow", headers });
    } catch (err) {
      return fail(502, "Couldn't reach OneDrive: " + err.message, origin);
    }

    if (!upstream.ok && upstream.status !== 206)
      return fail(502,
        `OneDrive returned ${upstream.status}. The link may have been revoked, `
        + `or the file renamed or moved.`, origin);

    /* An HTML body means OneDrive served a sign-in or error page instead of
       the file — the usual cause is the share not being "Anyone with the link". */
    const type = (upstream.headers.get("Content-Type") || "").toLowerCase();
    if (type.includes("text/html"))
      return fail(403,
        "OneDrive wants a sign-in for this file. Re-share it as "
        + '"Anyone with the link" and paste the new link.', origin);

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
