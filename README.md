# Ledger — Sales Performance

A static, client-side dashboard for tracking salesperson performance against
target across multiple stores. No backend, no build step — it runs entirely
in the browser and stores data in IndexedDB (private to your browser on the
device you upload from).

## Putting it on GitHub Pages

1. Create a new GitHub repository (e.g. `sales-performance`).
2. Upload these files keeping the folder structure:
   ```
   index.html
   css/style.css
   js/app.js
   js/db.js
   js/parse.js
   js/insights.js
   js/charts.js
   ```
3. In the repo, go to **Settings → Pages**, set **Source** to your default
   branch (root), and save.
4. GitHub gives you a URL like `https://<username>.github.io/sales-performance/`
   — open it and start uploading.

No API keys, no `npm install`. Two CDN libraries are loaded for reading
Excel/CSV files: SheetJS (xlsx) and PapaParse — both fetched from
cdnjs.cloudflare.com, so an internet connection is needed the first time a
page loads (they're cached by the browser afterwards).

## Uploading your sales export

Go to the **Data** tab and drop in a CSV or Excel export from Wizapp (or any
ERP). You'll be asked to match your file's columns to:

- **Date** (required)
- **Store / branch** (optional — defaults to "Main" if your export is
  single-store)
- **Salesperson** (required)
- **Sale amount** (required)
- **Quantity** and **Bill/invoice no.** (optional — used for the average
  bill value)

Ledger tries to guess the right column automatically from common header
names; you can override any of them before confirming. Nothing is uploaded
anywhere — the file is read and parsed entirely in your browser.

You can upload as many files as you like (e.g. one export per month); rows
are merged, keyed loosely by date + store + salesperson, so re-uploading an
overlapping file just adds more rows for the same people/periods rather than
replacing anything. If you need to undo an upload, remove it from the
**Upload history** table on the Data tab — that removes exactly the rows
that came from that file.

## Setting targets

On the **Targets** tab, with a specific month selected in the top-right
period filter, type a target directly into a row's Target column — it saves
on blur/Enter.

To import targets in bulk, use **Import targets file** and map Store,
Salesperson, Period and Target columns the same way as a sales upload. The
Period column can be a plain month value (`2026-09`) or an actual date; it's
normalized to a month automatically.

**Suggest next-period targets** looks at actual sales for the selected
period (or the latest period if "All periods" is selected), applies the
growth percentage set at the top of the tab, and shows an editable review
table before saving anything as next month's targets.

## Reading the dashboard

- The ring shows overall achievement against target for whatever store/period
  filter is active at the top.
- **Needs attention** and **Leading the floor** surface the salespeople
  furthest below and above target.
- **What to focus on** is a short set of plain-language observations
  generated from the current numbers — not a model, just a few rules (who's
  under 80%, which store is softest, who has sales but no target set yet).
- Click any salesperson row (Dashboard or Salespeople tab) to open their
  detail panel with a month-by-month trend against target.

## Data & privacy

Everything — sales rows, targets, upload history — lives in this browser's
IndexedDB. Clearing browser data, using a different browser, or switching
devices means starting fresh, so use **Export data** on the top bar
periodically if you want a CSV backup, or if you need to move data to
another machine.
