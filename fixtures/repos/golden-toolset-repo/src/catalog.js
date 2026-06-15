// MARKER_TOKEN_v1 — anchor the search_files regex/glob assertions to this file.
const offers = [
  { code: "A1", label: "Starter" },
  { code: "B2", label: "Pro" }
];

export function listOffers() {
  return offers;
}

export function findOffer(code) {
  return offers.find((offer) => offer.code === code);
}
