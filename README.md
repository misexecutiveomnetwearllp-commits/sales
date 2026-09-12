# Ledger — Sales Performance

A salesperson performance dashboard: upload sales exports, track quantity
sold against target, manage targets, and see who needs support to hit the
next one — across multiple stores. The frontend is static HTML/CSS/JS for
GitHub Pages; data lives centrally in a Google Sheet via a small Apps
Script backend, so opening the site from any browser or device shows the
same data.

Price/sale-value tracking is switched off for now — everything is measured
in **quantity (units sold)**.

## 1. Backend setup (Google Sheet + Apps Script)

1. Create a new Google Sheet (any name — e.g. "Ledger Data"). You don't
   need to add any tabs or headers yourself; the script creates them.
2. In the Sheet, go to **Extensions → Apps Script**.
3. Delete the default `Code.gs` contents and paste in the contents of
   `appsscript/Code.gs` from this project.
4. Click the gear icon (Project Settings) → under **General**, make sure
   the runtime is **V8**. (It is by default.)
5. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**, authorize the script when prompted (it only touches
   this one Sheet), and copy the **Web app URL** it gives you — it looks
   like `https://script.google.com/macros/s/AKfycb.../exec`.
7. Keep that URL — you'll paste it into the site in step 3 below.

If you ever change the script's code, use **Deploy → Manage deployments →
Edit → New version** so the same URL picks up the changes.

## 2. Putting the site on GitHub Pages

1. Create a new GitHub repository (e.g. `sales-performance`).
2. Upload these files/folders, keeping the structure:
   ```
   index.html
   css/style.css
   js/app.js
   js/api.js
   js/config.js
   js/parse.js
   js/insights.js
   js/charts.js
   ```
   (`appsscript/Code.gs` is only for step 1 above — it doesn't need to go
   on GitHub Pages, though there's no harm leaving it in the repo for
   reference.)
3. In the repo, go to **Settings → Pages**, set **Source** to your default
   branch (root), and save.
4. GitHub gives you a URL like
   `https://<username>.github.io/sales-performance/`.

## 3. Connecting the site to your Sheet

Open the site and go to the **Data** tab. Paste the Web App URL from step 1
into **Connect your Google Sheet** and click **Save & connect**. That's a
one-time step per browser you use to manage the connection — once saved,
every upload, target, and edit goes straight to the Sheet, so any other
browser or device that connects to the *same* URL sees the same data.

(Under the hood the URL is kept in that browser's local storage purely as
a pointer to your backend — it's not where any of your data lives.)

## Uploading your sales export

Go to the **Data** tab and drop in a CSV or Excel export from Wizapp (or
any ERP). Ledger reads the file and:

1. **Guesses the header row automatically** — your file doesn't need
   column headings on row 1. If there are title rows, blank rows, or
   report metadata above the real headings (row 5, 6, 9 — wherever), the
   mapping screen shows a **Header row** dropdown with a preview of each
   of the first 15 rows so you can confirm or override the guess.
2. **Lists the detected headings** underneath, editable — untick a column
   you don't want to map (e.g. a blank/junk column), or rename one that
   came through blank or garbled, before matching fields to it.
3. Asks you to match columns to:
   - **Date** (required)
   - **Store / branch** (optional — defaults to "Main" if your export is
     single-store)
   - **Salesperson** (required)
   - **Quantity sold** (required)
   - **Bill / invoice no.** (optional — used for units-per-bill)

You can upload as many files as you like (e.g. one export per month); rows
are merged. To undo an upload, remove it from **Upload history** on the
Data tab — that removes exactly the rows that came from that file.

## Setting targets

On the **Targets** tab, with a specific month selected in the top-right
period filter, type a quantity target directly into a row — it saves on
blur/Enter.

To import targets in bulk, use **Import targets file** — same header-row
detection and column-matching flow as a sales upload, matching Store,
Salesperson, Period and Target Quantity columns.

**Suggest next-period targets** looks at units sold for the selected
period (or the latest period if "All periods" is selected), applies the
growth percentage set at the top of the tab, and shows an editable review
table before saving anything as next month's targets.

## Reading the dashboard

- The ring shows overall achievement against target (in units) for
  whatever store/period filter is active at the top.
- **Needs attention** and **Leading the floor** surface the salespeople
  furthest below and above target.
- **What to focus on** is a short set of plain-language observations
  generated from the current numbers — not a model, just a few rules (who's
  under 80%, which store is softest, who has sales but no target set yet).
- Click any salesperson row (Dashboard or Salespeople tab) to open their
  detail panel with a month-by-month trend against target.

## Data & privacy

Sales rows, targets, and upload history live in the Google Sheet behind
your Apps Script deployment — not in the browser. Anyone with the Web App
URL and the "Save & connect" step can read and write that data, so treat
the URL the way you'd treat a shared spreadsheet link. **Export data** on
the top bar still works for a CSV backup any time.
