# Stella Marine — Drawings (v3.1)

Shop-floor drawing lookup. PDFs stay in OneDrive; this app stores only metadata
and "Anyone with the link" share URLs in Firestore. Updating a PDF in OneDrive
under the same filename updates what the floor sees automatically — no re-upload.

**v3:** one page for everyone. The floor signs in and browses a collapsible
folder tree filtered by workstation category; drawings open in an in-page
viewer. Signing in with the design account unlocks editing on the same page —
add/edit drawings in an overlay, manage folders inline, drag things around.

## Files
- `index.html` — the whole app. Folder tree, category pills, search, in-page
  PDF viewer, flag-a-problem, and (for the design account) all editing tools.
- `setup.html` — redirect stub only; v3 merged setup into the main page.
  Kept so old bookmarks don't 404.
- `assets/logo.svg` / `assets/logo.png` — Alternate logo (the version approved
  for online use). SVG renders in the header; PNG is the favicon and iPad
  home-screen icon.
- `worker/drawings-proxy.js` — Cloudflare Worker that makes OneDrive PDFs
  displayable inside the app. Deployed separately (see below); not served by
  GitHub Pages.

## How editing works (design account)
- **＋ Drawing / ＋ Folder** in the toolbar, or the **＋ Dwg / ＋ Sub** buttons
  on any folder row to add directly into it.
- **👁 View as floor** switches the design account into the read-only floor
  view to check how things look; the same button switches back. No second
  login needed.
- The drawing form is an overlay. Paste the OneDrive link, then paste the PDF
  filename into the **Paste the PDF filename** field. Two naming conventions
  are hardcoded: **part codes** (2-3 letters + 4 digits + up to 2 letters,
  always the whole first hyphen-segment — `ST0071D-ClampPlate-Triple-316` →
  `ST0071D` / "Clamp Plate Triple 316") and **series numbers** ending at the
  first pure 4-digit segment (`SL-Galaxy-2002-LowerArm-A` → `SL-Galaxy-2002` /
  "Lower Arm A"). CamelCase descriptions split into words. The field shows
  what it decided; correct the two fields below if a name breaks the pattern.
- **History** button in the edit overlay lists every save of that drawing —
  when, by which account, the revision, and whether it replaced a newer rev
  or was forced past the warning. Read from the append-only audit trail.
- **Search** covers folders too (tap a folder hit to jump to its place in the
  tree), with tight fuzzy matching on words — one typo, swap, or missing
  letter still hits. Terms containing digits never fuzz: a part number can't
  quietly match a neighbouring part.
- **Part info** on each drawing is a free-form key/value list. The suggested
  keys are **Material code** and **Material description** — set those and they
  lead the viewer's header strip in stores order ("SL0325 · 16mm x 6m Solid
  Round Bar 316 S/S") and show on the tile. Pasting a full stores line like
  `SL0325 - 16mm x 6m Solid Round Bar 316 S/S` into the Material code value
  splits itself across both fields. Other keys (finish, notes…) follow after.
  Folders have their own info too, for whole-project notes.
- **Delete** in the drawing form removes the record for good (the OneDrive PDF
  is untouched). **Hide from floor** is the softer option — the record stays,
  the floor stops seeing it. Deleting closes any open flags on that drawing;
  its revision history stays in Firestore as an audit record.
- Changing a drawing's number just updates it — records are keyed by an
  internal id, so renumbering never creates a second copy. Two drawings can't
  share a number; the form says so if you try.
- **Categories** are workstation types (Machining, Fabrication, …). Manage them
  from the ⚙ pill; assign one per drawing in the form. The pills filter the
  floor view: a category hides non-matching drawings and any folder branch
  with nothing left in it.
- Move drawings and whole folder branches by dragging onto a folder row
  (desktop), or via the folder field in their edit overlays (works on iPad).
- Deleting a folder that has contents offers "move contents to parent" —
  nothing is ever orphaned, and OneDrive links are never affected.
- Flags reported from the floor appear as a red badge in the header.

## In-page PDF preview (Cloudflare Worker)
Browsers won't let this app display a SharePoint PDF directly: SharePoint
refuses to be framed by another site and sends no CORS headers, and OneDrive's
own Embed links demand a Microsoft sign-in that the floor accounts don't have.
None of that is fixable from the page itself.

`worker/drawings-proxy.js` solves it. It fetches the "Anyone with the link"
PDF server-side, where those browser rules don't apply, and re-serves the bytes
with CORS. **OneDrive stays the master copy** — overwrite a file there and the
floor sees the new revision, same as always.

The app then renders those bytes itself with pdf.js (canvas pages, fit-to-width,
＋/−/Fit zoom) rather than leaving PDF display to the browser — iPad Safari's
native PDF handling inside pages is broken (top-left corner, no scroll or zoom),
so every device gets the same viewer. The library loads from cdnjs on first use.

Speed: the worker tries SharePoint's download forms in parallel and answers with
the first real file, and keeps a **5-minute edge cache** per link so repeat
views skip OneDrive entirely. The trade-off: after overwriting a PDF in
OneDrive, floor previews can lag up to 5 minutes behind (the "Open in
OneDrive" button always serves the live file). `CACHE_SECONDS` in the worker
sets the window. Saving a drawing also pre-fetches its PDF (to count pages),
which primes this cache — the floor's first view of a new drawing is instant.

Zoom: −/＋/Fit buttons, pinch on touch screens, Ctrl+scroll (trackpad pinch)
on desktops.

### Deploy it (once, free, no command line)
1. Sign up at [cloudflare.com](https://cloudflare.com) — the free plan is
   ample (100,000 requests/day; this app will use a tiny fraction).
2. **Workers & Pages → Create → Workers → Create Worker**. Name it
   `stella-drawings-proxy` → **Deploy**.
3. **Edit code** → delete the sample → paste all of
   `worker/drawings-proxy.js` → **Deploy**.
4. Copy the worker URL (`https://stella-drawings-proxy.<something>.workers.dev`).
5. Paste it into `PROXY_BASE` at the top of the script block in `index.html`,
   then push. Leave `PROXY_BASE` empty to turn previewing off — drawings then
   open in OneDrive instead.

### What it will and won't fetch
It only fetches `*.sharepoint.com` and `1drv.ms` URLs, so it can't be used as a
general-purpose proxy, and it only reaches files you already shared as "Anyone
with the link" — it grants no access to anything private. If a link needs a
sign-in, the app shows the OneDrive button with the reason instead of a broken
frame. Responses are `no-store`, so a revised PDF is never served stale.

If the proxy is unreachable or a link stops working, tapping a drawing shows a
full-screen **Open in OneDrive** button with the reason, rather than a broken
frame. (OneDrive "Embed" links were tried and dropped: they demand a Microsoft
sign-in the floor accounts don't have.)

## One-time Firebase setup
1. Firebase console → project `stella-workshop-drawings`.
2. **Enable Auth**: Authentication → Sign-in method → enable **Email/Password**
   (leave "Email link" off).
3. **Create the two accounts** (Authentication → Users → Add user):
   - `design@stellamarine.com.au` — full editing rights.
   - a floor account, e.g. `floor@stellamarine.com.au` — one shared login for
     all floor iPads. Read-only by rules; the address doesn't need a real
     mailbox, only the format.
4. **Block self-signup**: Authentication → Settings → User actions → untick
   "Enable create (sign-up)". Accounts exist only if you create them.
5. **Publish the Firestore rules** below (Firestore → Rules). Until you do,
   nothing works — there is no passcode fallback anymore.

## Firestore security rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function engineering() {
      // keep in sync with ENGINEERING_EMAILS in index.html
      return signedIn()
        && request.auth.token.email in ['design@stellamarine.com.au'];
    }

    match /drawings/{id} {
      allow read: if signedIn();
      allow write: if engineering();
      match /revisions/{rev} {
        allow read: if signedIn();
        allow create: if engineering();
        allow update, delete: if false;    // audit trail is append-only
      }
    }

    match /folders/{id} {
      allow read: if signedIn();
      allow write: if engineering();
    }

    match /categories/{id} {
      allow read: if signedIn();
      allow write: if engineering();
    }

    match /flags/{id} {
      allow read: if signedIn();
      // floor accounts may raise a flag, shape-constrained:
      allow create: if signedIn()
        && request.resource.data.keys().hasOnly(
             ['drawingId','drawingName','drawingNumber','reason','flaggedAt','resolved'])
        && request.resource.data.resolved == false;
      allow update: if engineering();      // mark resolved (+resolvedAt)
      allow delete: if false;              // flags are history — never deleted
    }
  }
}
```

## Why the Firebase config sits openly in the HTML
The config block (apiKey etc.) is a set of public identifiers, not secrets —
every visitor's browser needs it to talk to Firebase, so it can't be hidden
anyway. All protection comes from Auth + the rules above: without a signed-in
account nothing can be read or written, and only the design account can write.
Don't try to obscure the config; it buys nothing.

### About GitHub's "secret detected" alert
GitHub secret scanning flags every `AIzaSy…` string because it can't tell a
Firebase *web* key (public by design — see
https://firebase.google.com/docs/projects/api-keys) from a sensitive Google
Cloud key. Do **not** revoke or rotate it — a replacement key would go straight
back into the HTML and be flagged again. The correct remediation is to
**restrict** the key so it only works for this app:

1. Google Cloud console → APIs & Services → Credentials → *Browser key (auto
   created by Firebase)*.
2. **Application restrictions** → Websites → add
   `https://stellamarinedesign.github.io/*`.
3. **API restrictions** → Restrict key → tick **Identity Toolkit API**,
   **Token Service API**, **Cloud Firestore API** (add **Firebase
   Installations API** too if the browser console ever complains). Save.
4. Back on GitHub, close the alert as **False positive**.

With that, the public key authenticates this site's traffic and nothing else;
data security continues to come from Auth + rules. Note the referrer
restriction means sign-in only works when served from the Pages URL (local
`file://` testing of sign-in will be blocked — deploy to test).

## Firestore schema
```
folders/{autoId}
  name        "Lifters"
  parentId    null | folderId     ← null = top level
  order       number              ← manual sort within parent
  meta        { "Raw material": "6mm 5083 plate", "Material code": "…", … }
                                  ← free-form key/value, shown on the folder row

categories/{autoId}               ← workstation types (the filter pills)
  name        "Machining"
  order       number

drawings/{autoId}                 ← auto id, NOT derived from the number, so
                                    renumbering is a plain field update
  drawingNumber      "SL0035"     ← from the PDF filename, before the " - "
  drawingName        "Bronze Bush"    ← description; shown as the main line
  folderId           folderId
  folderPath         "Fabrication/Lifters/Universal"
                                  ← human-readable mirror of the folder chain;
                                    the app keeps it in sync automatically
  categoryId         null | categoryId
  meta               { "Raw material": "6mm 5083 plate", … }
                                  ← per-part info, free-form, shown to the floor
  pageCount          3 | null     ← counted automatically from the PDF at save
                                    (and backfilled when the design account
                                    views an older record); shown on the tile
  currentRevision    "B"
  currentLink        "https://…sharepoint.com/…"   ← OneDrive Anyone link
  currentUpdatedAt   timestamp
  currentUpdatedBy   email of saver
  hidden             true         ← optional; hides from floor without deleting

drawings/{id}/revisions/{auto}    ← audit trail, one per save, append-only
  revision, link, savedAt, savedBy, forced, replaced
                                  ← rules forbid deleting these, so a deleted
                                    drawing leaves its history behind on purpose

flags/{auto}                      ← floor-reported problems
  drawingId, drawingName, drawingNumber, reason,
  flaggedAt, resolved, resolvedAt (set when engineering resolves)
```

## Floor iPads (per device, once)
1. Open the GitHub Pages URL in Safari → sign in with the floor account.
2. Share → Add to Home Screen.
3. **Test**: force-quit the home-screen app, reopen — it must NOT ask for the
   password again (local persistence). Verify on the first iPad before rolling
   out to the rest.

## Why flagging instead of automatic link checks
SharePoint share URLs can't be status-checked from the browser (CORS returns
opaque responses) and server-side checking needs Cloud Functions on the Blaze
plan. So the floor's "report a problem" flag is the **primary** mechanism:
one tap on the flag icon → optional reason → the design account sees a red
badge. Duplicate reports are suppressed while a flag is unresolved.

## Brand
Palette and type per *Corporate Brand Guidelines 2025* (hex taken directly from
the PDF): Black Night `#0E0A0A`, Shadow Grey `#282827`, Upsdell Red `#AF1F24`,
Burning Star Red `#EA372E`, Titanium White `#FFFFFF`. Headline face Friz
Quadrata Pro, paragraph face Sweet Sans Pro — both are licensed fonts, so the
page ships with system fallbacks; to use the real faces, put licensed `.woff2`
files in a `fonts/` folder and uncomment the `@font-face` block at the top of
`index.html`. The header/icon logo is the Alternate version, per the
guidelines' rule that it's the variant for online applications.

## Deploying updates
GitHub Pages serves from the `gh-pages` branch, so a deploy is two pushes:
`git push origin main` then `git push origin main:gh-pages`.
(Or switch Settings → Pages to serve from `main` and drop the second push.)

## Known limits (accepted trade-offs)
- If a file is MOVED or RENAMED in OneDrive, its share link may break — the
  viewer can't detect this. Convention: revise in place, never rename. The
  floor flag button is the safety net.
- Revision letter shown is only as current as engineering keeps it. The link
  serves the latest file regardless; the stamp is metadata.
- "Anyone" links are viewable by anyone who has the URL. The app data itself
  requires sign-in, but the PDFs behind the links keep that exposure level.
- Drawing data is **live**: Firestore listeners push changes to every signed-in
  device within a second or two of saving — no refresh needed, and cheaper on
  the free tier than polling since only changed documents transfer.
- App **updates** are checked every minute. A banner with an "Update now"
  button appears immediately; a device that then sits idle for 3+ minutes with
  no drawing or form open reloads itself, so parked iPads stay current
  unattended. (One auto-attempt per version — a stale CDN can't cause a
  reload loop.)
