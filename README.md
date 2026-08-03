# Stella Marine — Drawings

Shop-floor drawing lookup for Stella Marine. PDFs stay in OneDrive; this app
stores only metadata and share links. Overwriting a PDF in OneDrive under the
same filename updates what the floor sees automatically — no re-upload.

One page for everyone: the floor signs in and browses a collapsible folder
tree; signing in with a design account unlocks the editing tools on the same
page. Data is live — a drawing saved at the desk appears on every signed-in
device within a second or two, and the app keeps itself updated (new versions
roll out to idle devices automatically).

> Setup, security rules, accounts and deployment steps live in a private
> SETUP document kept outside this repository.

## Files
- `index.html` — the whole app.
- `setup.html` — redirect stub only (kept so old bookmarks don't 404).
- `assets/` — brand logo (Alternate version, per the brand guidelines).
- `worker/drawings-proxy.js` — the PDF preview proxy, deployed separately on
  Cloudflare. It makes OneDrive PDFs displayable inside the app; the repo copy
  is the source of truth for its code.

## Using it on the floor
- **Search** covers drawing numbers, descriptions, folder names and material
  info ("316", a stores code…). Fuzzy matching forgives a one-letter typo in
  words, but terms containing digits always match exactly — a part number can
  never quietly match a neighbouring part.
- **Category pills** (Machining, Fabrication, …) filter to one workstation
  type and hide folder branches with nothing relevant.
- Tap a drawing to view it in-app: scroll, pinch to zoom (buttons too), whole
  page fitted on open. "Open in OneDrive" is always available as a fallback.
- The **rev stamp** on every tile is the issue revision; the page count sits
  under it.
- The **⚑ button** on a drawing: report a problem (won't open / wrong drawing
  / out of date / free text) or **🖨 request a printed copy** — both go
  straight to engineering. Duplicates are suppressed while one is open.

## Engineering tools (design accounts)
- **＋ Drawing / ＋ Folder** in the toolbar, or ＋ buttons on any folder band.
  Pasting the share link is usually all it takes: the app reads the file's
  real name from OneDrive and fills the number + description itself (part
  codes like `ST0071D` and series numbers like `SL-Galaxy-2003` are both
  understood). The original filename is kept for downloads, the page count is
  probed, and the preview cache pre-warmed.
- **⇄ Batch add** (top-right of the drawing form) switches to batch mode,
  keeping the folder you opened the form from: paste share links one per
  line, filenames are read automatically into an editable preview (duplicates
  against the library and within the batch are flagged), then one folder,
  category and revision apply to the lot and a single Save writes them all
  with per-row results. ⇄ switches back, folder intact.
- **Part info** (Material code / Material description lead the display) shows
  on tiles, in the viewer header, and is searchable.
- **Folders**: drag-and-drop or edit-form moves, reorder arrows, per-folder
  project info, and **Hide from floor** — an in-progress state that hides a
  whole subtree while drafts are uploaded, printed and combined; Unhide to
  release. OneDrive links are never affected by any reorganisation.
- **👁 View as floor** previews exactly what the workshop sees, without
  switching accounts.
- **Print** (engineering only): ⎙ on any drawing row, in the viewer, and on
  print-request notifications. **⎙ All** on a folder combines the drawings
  directly in that folder (never subfolders, never hidden drawings) into one
  scrollable PDF with Print and Download.
- **Combined downloads are named to convention**:
  `_[Prefix]-[Folder]-2999-Combined.pdf`, using the top-level folder's Prefix
  (e.g. SL) and the folder's Abbreviation if set (Prestige 420 → P420 →
  `_SL-P420-2999-Combined.pdf`). The leading underscore sorts the file to the
  top. Individual downloads reuse the exact filename pasted at add time.
- **⚑/🖨 badge** in the header lists floor reports: problem reports load the
  drawing for fixing; print requests have a direct ⎙ Print and a Done button.
- **History** on any drawing: every save (upgraded / re-saved / rolled back,
  by which account), plus hide, move and delete events. The trail survives
  deletion.
- Every drawing keeps an append-only revision history; deleting a record needs
  an explicit confirm and never touches OneDrive.

## How the preview works (short version)
SharePoint refuses to display "Anyone with the link" PDFs inside another page
and blocks script access to the bytes. A small Cloudflare Worker fetches the
file server-side and re-serves it; the app renders pages itself with pdf.js
(iPad Safari's native PDF handling in frames is broken) and combines files
with pdf-lib. OneDrive stays the master copy; repeat views are edge-cached
briefly for speed.

## Brand
Palette and type per *Corporate Brand Guidelines 2025*: Black Night `#0E0A0A`,
Shadow Grey `#282827`, Upsdell Red `#AF1F24`, Burning Star Red `#EA372E`,
Titanium White `#FFFFFF`; Friz Quadrata Pro headlines and Sweet Sans Pro text
(licensed faces — system fallbacks ship; drop licensed `.woff2` files into
`fonts/` and uncomment the `@font-face` block to use the real ones). The logo
is the Alternate version, the variant approved for online use.

## Known limits (accepted trade-offs)
- A file MOVED or RENAMED in OneDrive silently breaks its share link — revise
  in place, never rename. The floor's ⚑ button is the safety net.
- The rev stamp is metadata: it's as current as engineering keeps it, while
  the link always serves the latest file.
- "Anyone" links are viewable by anyone holding the URL; the app data itself
  requires sign-in.
- Previews can lag a few minutes behind an overwritten PDF (edge cache);
  "Open in OneDrive" is always live.
