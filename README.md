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

## How editing works (design account)
- **＋ Drawing / ＋ Folder** in the toolbar, or the **＋ Dwg / ＋ Sub** buttons
  on any folder row to add directly into it.
- **👁 View as floor** switches the design account into the read-only floor
  view to check how things look; the same button switches back. No second
  login needed.
- The drawing form is an overlay. Paste the OneDrive link, then paste the PDF
  filename into the **Paste the PDF filename** field — `SL0035 - Bronze Bush`
  splits automatically into number `SL0035` and description `Bronze Bush`.
  (Auto-reading the name straight out of the link only works when the URL
  contains it; OneDrive's opaque share links don't, hence the paste field.)
- **Part info** on each drawing is a free-form key/value list (raw material,
  material code, finish…). It shows under the drawing on the floor and in the
  viewer's info strip. Folders have their own info too, for whole-project notes.
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

## In-page PDF preview needs an embed link
SharePoint refuses to be framed by another site: a plain "Anyone with the link"
share URL loads as *"…sharepoint.com refused to connect."* inside the app. That
is SharePoint's policy, not something this app can override — no setting, proxy
or trick on our side changes it, and the PDF can't be fetched and re-rendered
locally either because SharePoint sends no CORS headers to this origin.

The supported way in is OneDrive's own **Embed** link, which Microsoft
generates specifically to be framed:

1. In OneDrive (web), open or select the PDF → **⋯** → **Embed**.
2. Copy the generated snippet (or just its URL).
3. Paste it into the drawing's **Embed link** field. The whole
   `<iframe …>` snippet is fine — the app pulls the URL out of it.

With an embed link, the drawing previews inside the app. Without one, tapping a
drawing shows a clean full-screen **Open in OneDrive** button instead of a
broken frame — usable either way, so embed links can be added gradually.
Note an embed link is a second, separately revocable share of the file; both
links keep serving the latest version of the PDF.

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
  currentRevision    "B"
  currentLink        "https://…sharepoint.com/…"   ← OneDrive Anyone link
  embedLink          "https://…action=embedview"   ← optional; enables in-app preview
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
- The app caches data at load; reopen (or the hourly self-check) picks up changes.
