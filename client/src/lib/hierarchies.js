// Dimension chains a chart can navigate into, level by level, when its
// root dimension has a natural hierarchy. Charts whose dim isn't listed
// here just cross-filter (no deeper level to show).
export const HIERARCHIES = {
  bu: ["bu", "cat", "brand", "sku"],
  cat: ["cat", "brand", "sku"],
  brand: ["brand", "sku"],
  chType: ["chType", "channel", "subChannel"],
  town: ["town", "dist"],
};

export const DIM_LABELS = {
  bu: "Business unit",
  cat: "Category",
  brand: "Brand",
  sku: "SKU",
  chType: "Channel type",
  channel: "Channel",
  subChannel: "Sub-channel",
  town: "Town",
  dist: "Distributor",
  orderFrom: "Order source",
};

export function levelsFor(dim) {
  return HIERARCHIES[dim] || [dim];
}
