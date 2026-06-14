# Golden API Repo

This fixture repository is the **data/API provider** in RepoHelm's QA agent complex flow.

It owns the inventory catalog contract consumed by `golden-web-repo`.

## Usage

`src/inventory.js` exports the catalog and read helpers:

- `items` — the raw catalog.
- `listItems()` — returns the full catalog.
