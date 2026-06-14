// The web storefront consumes the inventory contract owned by golden-api-repo.
// It keeps a local mirror of the catalog the API exposes via listItems().
const catalog = [
  {
    sku: "map-kit",
    label: "Map onboarding kit"
  },
  {
    sku: "release-notes",
    label: "Release notes bundle"
  }
];

export function renderCatalog() {
  return catalog.map((item) => `${item.sku}: ${item.label}`);
}
