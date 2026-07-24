# Stella Marine — Drawings Viewer (v2)

Shop-floor drawing lookup. PDFs stay in OneDrive; this app stores only metadata
and "Anyone with the link" share URLs in Firestore. Updating a PDF in OneDrive
under the same filename updates what the floor sees automatically — no re-upload.

**v2:** real Firebase Auth on both pages, folders as first-class documents
(rename/move/reorganise freely without touching links), folder project-info
shown to the floor, and floor → engineering broken-link flagging.

## Files
- `index.html` — floor viewer (iPad). Sign-in, search-first, folder chips,
  tap → PDF opens in OneDrive, flag-a-problem button on every row.
- `setup.html` — engineering page (sign-in restricted to the design account).
  Drawing form, flagged-drawings panel, folder tree management.
- `assets/logo.svg` / `assets/logo.png` — Alternate logo (the version approved
  for online use). SVG renders in the headers; PNG is the favicon and iPad
  home-screen icon.

## One-time Firebase setup
1. Firebase console → project `stella-workshop-drawings`.
2. **Enable Auth**: Authentication → Sign-in method → enable **Email/Password**
   (leave "Email link" off).
3. **Create the two accounts** (Authentication → Users → Add user):
   - `design@stellamarine.com.au` — manages drawings (setup page).
   - a floor account, e.g. `floor@stellamarine.com.au` — one shared login for
     all floor iPads. Read-only by rules; the address doesn't need a real
     mailbox, only the format.
   Passwords are set right there in the console — pick long ones, they're
   entered once per device and remembered.
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
      // keep in sync with ENGINEERING_EMAILS in setup.html
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

## Firestore schema
```
folders/{autoId}
  name        "Lifters"
  parentId    null | folderId     ← null = top level
  order       number              ← manual sort within parent
  meta        { "Raw material": "6mm 5083 plate", "Material code": "…", … }
                                  ← free-form key/value, shown to the floor

drawings/{slug-of-drawing-number}
  drawingName        "Lifter Arm Weldment"
  drawingNumber      "SL-Galaxy-0022"
  folderId           folderId
  folderPath         "Fabrication/Lifters/Universal"
                                  ← human-readable mirror of the folder chain;
                                    the app keeps it in sync automatically
  currentRevision    "B"
  currentLink        "https://…sharepoint.com/…"   ← OneDrive Anyone link
  currentUpdatedAt   timestamp
  currentUpdatedBy   email of saver
  hidden             true         ← optional; hides from floor (no deletes)

drawings/{id}/revisions/{auto}    ← audit trail, one per save, append-only
  revision, link, savedAt, savedBy, forced, replaced

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
one tap on the flag icon → optional reason → the setup page shows a banner.
Duplicate reports are suppressed while a flag is unresolved.

## Brand
Palette and type per *Corporate Brand Guidelines 2025* (hex taken directly from
the PDF): Black Night `#0E0A0A`, Shadow Grey `#282827`, Upsdell Red `#AF1F24`,
Burning Star Red `#EA372E`, Titanium White `#FFFFFF`. Headline face Friz
Quadrata Pro, paragraph face Sweet Sans Pro — both are licensed fonts, so the
pages ship with system fallbacks; to use the real faces, put licensed `.woff2`
files in a `fonts/` folder and uncomment the `@font-face` blocks at the top of
each HTML file. The header/icon logo is the Alternate version, per the
guidelines' rule that it's the variant for online applications.

## Engineering workflow per drawing
1. In Explorer: right-click PDF → Share → "Anyone with the link" → Can view → Copy link.
2. Open setup page → fill name / number / rev / folder → paste link → Save.
3. Future revisions: overwrite the file in OneDrive (same filename) → update the
   rev letter in setup so the floor sees the correct revision stamp.

Reorganising folders (rename / move / drag-drop) never touches OneDrive links —
folders are pure metadata in this app.

## Known limits (accepted trade-offs)
- If a file is MOVED or RENAMED in OneDrive, its share link may break — the
  viewer can't detect this. Convention: revise in place, never rename. The
  floor flag button is the safety net.
- Revision letter on the floor viewer is only as current as engineering keeps it.
  The link serves the latest file regardless; the stamp is metadata.
- "Anyone" links are viewable by anyone who has the URL. The app data itself now
  requires sign-in, but the PDFs behind the links keep that exposure level.
- Both pages cache data at load; reopen (or pull down to refresh) to pick up changes.
