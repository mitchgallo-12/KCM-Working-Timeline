# KCM Project Tracker — Web

A self-hosted project and capital-allocation tracker for Khepera Capital Management.

Static HTML + JSON. No build step, no backend, no dependencies. Edits are staged in your browser, exported as `data.json`, and committed to git for versioning.

---

## Files

```
KCM_Project_Tracker_Web/
├── index.html    # Shell — sidebar nav, view containers
├── styles.css    # KCM brand palette + layout
├── app.js        # Data load, state, views, Gantt, edits, export
├── data.json     # The single source of truth (commit changes here)
└── README.md     # This file
```

---

## Running it locally

Open a terminal in this folder and start a local static server (the app uses `fetch` which doesn't work over `file://`):

```bash
# macOS / Linux (Python 3)
python3 -m http.server 8000

# Node.js alternative
npx serve .
```

Then open http://localhost:8000 in your browser.

---

## Using the tracker

### Views

- **Dashboard** — firmwide KPIs, project table, "needs attention" list of at-risk / waiting / blocked tasks.
- **Projects** — grid of all projects with progress rings and task counts.
- **Project detail** — per-project timeline (Gantt), milestones, and tasks grouped by workstream. KCM Internal lists its 7 initiatives, each with its own milestones and tasks.
- **Weekly Ledger** — log expenses by week × project × expense type; summary KPIs auto-update per filter.
- **Monthly Plan** — plan capital deployment by project × month; summary pivot shows totals.

### Editing

Click any cell — dates, dropdowns, text, numbers — to edit in place. Changes are staged in your browser's `localStorage` and flagged as "Unsaved changes" in the sidebar.

### Exporting

When you're ready to save, click **Export data.json** (top-right of any view, or the link at the bottom of the sidebar). This downloads a fresh `data.json`.

**Replace the file in this folder with the downloaded one**, then commit and push the change. That commit IS your save.

### Reset

If you want to discard unsaved browser edits and reload from the committed `data.json`, open your browser's DevTools → Application → Local Storage, delete the key `kcm_tracker_working`, and reload the page.

---

## Publishing to GitHub Pages (private repo, solo)

1. Create a new **private** GitHub repo, e.g. `kcm-project-tracker`.
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial KCM project tracker"
   git branch -M main
   git remote add origin git@github.com:<your-org>/kcm-project-tracker.git
   git push -u origin main
   ```
3. In the repo settings → **Pages**, set Source = `Deploy from a branch`, Branch = `main`, Folder = `/ (root)`, then Save.
4. Pages will publish the site at `https://<your-org>.github.io/kcm-project-tracker/`. For a private repo, only repo collaborators can view the site.

### Updating the tracker

```bash
# after exporting a fresh data.json and dropping it into this folder:
git add data.json
git commit -m "Update tracker: <short description of what changed>"
git push
```

The Pages site refreshes within a minute or two. Hard-reload (Cmd+Shift+R) to bypass your browser cache.

---

## Extending

### Adding a team member

Open `data.json` and append the person to `taxonomies.owners`. Commit.

### Adding a workstream

Append to `taxonomies.workstreams` in `data.json`.

### Adding a project

Append a new object to `projects[]` with an `id`, `name`, `vertical`, `milestones: []`, and `tasks: []`. IDs only need to be unique within the file — use something short like `mh-` for Marina Harbor, etc.

Re-run milestone IDs consistently: `<project-id>-m1`, `<project-id>-m2` …; tasks as `<project-id>-t1` …

### Moving to a multi-user backend later

Every record in `data.json` has a stable `id`. When you're ready to graduate to a real database (Supabase, Postgres, etc.), those IDs carry over directly — no re-keying required.

---

## Data model cheat-sheet

```
data.json
├── meta: { firm, updated, version, horizon_start, horizon_end }
├── taxonomies: { verticals, workstreams, expense_types, statuses, priorities, owners, milestone_sets }
├── projects: [
│     {
│       id, name, short_name, vertical, stage, counterparty, lead_owner,
│       total_budget, deployed_to_date, last_update, next_action,
│       milestones: [ { id, name, target_date, status, owner, notes } ],
│       tasks:      [ { id, workstream, name, owner, status, priority,
│                        start, end, percent_complete, budget, actual,
│                        info_needed_from, due_date, counterparty,
│                        next_action, last_update, notes } ],
│       initiatives (KCM Internal only): [ { id, name, milestones, tasks } ]
│     }, ...
│  ]
├── weekly_ledger: [
│     { id, week_of, project_id, expense_type, workstream, amount,
│       description, status (Projected|Committed|Paid) }, ...
│  ]
└── monthly_plan: [
      { id, month, project_id, category, planned, actual, notes }, ...
   ]
```

---

## Parallel Excel backup

The Excel workbook (`KCM_Project_Tracker_2026-04-20.xlsx` in the parent folder) is kept as a parallel backup. The web tool is the primary tool; the Excel file is a formatted, formula-driven snapshot of the same data model.
