# Golden Web Repo

This fixture repository is the **consumer** in RepoHelm's QA agent complex flow.

It renders the inventory catalog defined by the contract in `golden-api-repo`.

## Contract

The storefront mirrors the API surface exposed by `golden-api-repo`:

| API (`golden-api-repo`) | Web (`golden-web-repo`) |
| --- | --- |
| `listItems()` | `renderCatalog()` |

When the API gains a new read helper, the storefront must add the matching
renderer and document it in the table above.

## Usage

`src/storefront.js` exports view helpers:

- `renderCatalog()` — returns one display row per catalog item.
