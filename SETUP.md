# Google Sheets backend — one-time setup

This swaps the tracker's "Export → commit JSON" loop for a live Google Sheet that the leadership team (Mitch, Jay, Travis, Katherine) can read and write. Two surfaces, one source of truth:

- **Tracker UI** at the GitHub Pages URL — edit visually, click **Push** to save up.
- **Google Sheet** — edit directly in the spreadsheet, anyone using the tracker clicks **Pull** to refresh.

There is no automatic sync. Pull and Push are explicit, manual actions in the sidebar so two people editing the same row at the same time don't silently overwrite each other.

---

## What you'll set up (15 minutes, once)

1. A new Google Sheet, owned by Mitch, shared edit-access with the leadership team.
2. An Apps Script project bound to that Sheet, containing two files: `Code.gs` and `Seed.gs`.
3. A web-app deployment of that script — gives you an HTTPS URL the tracker calls.
4. The URL pasted into each teammate's browser (one click per person, then they're done).

You only do steps 1–3 once. Step 4 is each teammate, in their own browser, on first use.

---

## Step 1 — Create the Sheet

1. In Google Drive (your Khepera workspace), create a new blank Google Sheet.
2. Name it something obvious like **`KCM Project Tracker — Live`**.
3. Click **Share** and add Jay, Travis, and Katherine as **Editors**. (You stay Owner.)

Leave it on the default empty `Sheet1` — the script will create all the real tabs.

---

## Step 2 — Open the Apps Script editor

In the Sheet, go to **Extensions → Apps Script**. A new tab opens with an editor and a default `Code.gs` file containing a stub `myFunction()`.

You're going to replace the contents of that default file and add a second file.

### 2a. Paste `Code.gs`

1. Select all of the default `Code.gs` content and delete it.
2. Open `google-sheets/Code.gs` from the tracker repo, copy the entire contents, and paste them into the editor.
3. Save with **Cmd/Ctrl-S**.

### 2b. Add `Seed.gs`

1. Click the **+** next to "Files" in the left sidebar → **Script** → name it `Seed`.
2. Open `google-sheets/Seed.gs` from the tracker repo, copy the entire contents (it's a large file — about 60 KB of JSON wrapped in a single variable), and paste into the new file.
3. Save.

You should now have two files: `Code.gs` and `Seed.gs`.

### 2c. Rename the project (optional)

Click the title at the top (default: "Untitled project") and rename to `KCM Tracker Backend`. Easier to find later.

---

## Step 3 — Initialize the Sheet

In the Apps Script editor, with `Code.gs` selected:

1. **Function dropdown** (just left of the **Run** button) → choose `setup`.
2. Click **Run**.
3. The first time, you'll be asked to authorize the script. Walk through:
   - "Review permissions" → pick your account.
   - You may see a "Google hasn't verified this app" warning — that's normal for a private script. Click **Advanced → Go to KCM Tracker Backend (unsafe)** → **Allow**. The script only touches this one Sheet; it doesn't have access to anything else in your Drive.
4. Switch back to the Sheet tab. You should see all the tabs created: `Meta`, `Verticals`, `Workstreams`, `Projects`, `Milestones`, `Tasks`, `Initiatives`, `WeeklyLedger`, `MonthlyPlan`, etc.

Now load the current data:

5. Back in the Apps Script editor, function dropdown → `seed` → **Run**.
6. After a few seconds, switch back to the Sheet — every tab is now populated from the snapshot embedded in `Seed.gs`.

You can re-run `seed` whenever you want a clean reset (it overwrites all rows).

---

## Step 4 — Deploy as a Web App

This is what gives the tracker an HTTPS URL to call.

1. In the Apps Script editor, top right: **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → **Web app**.
3. Configure:
   - **Description:** `KCM Tracker v1` (or whatever)
   - **Execute as:** `Me (mitch.gallo@kheperacm.com)` ← important
   - **Who has access:** `Anyone with Google account` (or, if you have a Workspace org, `Anyone within Khepera Capital Management`)
4. Click **Deploy**.
5. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfycbx.../exec`.

> **Why "Execute as: Me"** — the script runs under your identity and writes to your Sheet. Anyone hitting the URL (the leadership team in their browsers) doesn't need their own Sheet permissions; they just need to be allowed to call the URL.

> **Security note** — that URL is a bearer token. Anyone who has it can read and write the Sheet. Don't paste it into Slack, email, or anywhere it could get indexed. Hand it to teammates 1:1 (DM, password manager, in person).

---

## Step 5 — Connect each teammate's browser

Each person who uses the tracker does this once on each browser/device:

1. Open the tracker URL (the GitHub Pages site).
2. In the sidebar, click **Sync settings…**
3. Paste the Web app URL into the field and click **Save**.
4. Click **↓ Pull** to load the current state of the Sheet.

That's it. From now on:

- **Edit in the tracker?** Click **↑ Push** to save up to the Sheet.
- **Edit in the Sheet directly?** Anyone using the tracker clicks **↓ Pull** to grab the latest.
- **Sidebar status line** shows when each side last synced.

The browser remembers the URL and the staged edits in `localStorage`, so closing the tab doesn't lose anything.

---

## How conflicts work (read this once)

This is the manual-sync, single-source-of-truth model. There's no automatic merge.

- **Push overwrites the Sheet.** When you click ↑ Push, your local copy fully replaces the data in the Sheet. If someone else edited the Sheet since your last Pull, those edits are gone.
- **Pull-while-dirty asks first.** If you have unsaved local edits and click ↓ Pull, the tracker warns you that pulling will discard them. Cancel the dialog, Push first, then Pull.

The intended rhythm: **Pull when you start working, Push when you're done.** If two people are editing concurrently:

- The first to push wins on the rows they touched.
- The second pulls, sees the merge in their copy, re-applies their own edits, then pushes.

If you ever need a clean reset, run `seed` again in Apps Script — it re-loads from the embedded snapshot.

---

## Editing directly in the Sheet — what to keep in mind

The Sheet is the source of truth, so editing it directly is fine. A few rules:

- **Headers are sacred.** Don't rename, reorder, or delete the column headers (row 1) — the script reads them by position.
- **Don't add columns** unless you also update `SCHEMAS` in `Code.gs` for that tab. Extra columns will be silently dropped.
- **IDs must stay unique** within their tab. If you copy a row, change the `id`. The tracker uses IDs to thread milestones/tasks back to projects.
- **Foreign keys matter.** A row in `Tasks` with `project_id = drip` only makes sense if `drip` exists in the `Projects` tab. The tracker won't crash, but the task will float orphaned.
- **Adding a project, milestone, or task** in the Sheet works fine — fill in the columns, give it a unique ID, and the tracker will pick it up on next Pull.

For most edits, doing it in the tracker UI is faster (drop-downs are pre-filled, dates are validated, IDs auto-increment). The Sheet is best for bulk changes you'd want to do with copy-paste or formulas.

---

## Updating the script later

If `Code.gs` or the schemas change in the repo, you'll need to copy the new contents back into the Apps Script editor:

1. Open the Apps Script editor for the same project.
2. Replace the contents of `Code.gs`.
3. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.**
4. The URL stays the same — no need to re-paste it in anyone's browser.

`Seed.gs` is a frozen snapshot from the day you set up. You can ignore it after the initial seed, or keep it updated by exporting a fresh `data.json` from the tracker and regenerating the file (`python3` script in the repo's `merge_data.py` neighbors).

---

## Troubleshooting

**"Sync not configured"** — paste the Web app URL into Sync settings.

**"Pull failed: HTTP 403" or "401"** — the Web app deployment isn't accessible to the requester. Check **Deploy → Manage deployments → Web app → Who has access** is broad enough.

**"Pull failed: Unexpected token < in JSON"** — the URL is returning an HTML login page instead of JSON. Almost always means the deployment is set to "Only myself" or you used the wrong URL (the editor URL, not the `/exec` web-app URL).

**Push works but no data appears in the Sheet** — open the Apps Script editor → **Executions** in the left rail, click the latest `doPost` to see the error trace.

**Want to start fresh** — run `clearAllData()` in Apps Script to wipe data rows (keeps headers), then `seed()` to re-load from `Seed.gs`.
