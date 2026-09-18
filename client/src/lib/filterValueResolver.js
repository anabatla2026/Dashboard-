// Charts group by (and display) a friendly NAME column for some dims —
// e.g. Primary's category chart labels bars "Baby Diapers" — but the global
// filter for those same dims now tracks the DE's mapping-table CODE (see
// shared/filterOptions.js: Region/Category/Distributor have a code distinct
// from their display name; Brand/Channel Type/Town don't). A chart mark's
// clicked label has to be resolved to that code before it's written to or
// compared against filters[dim]; the reverse lookup renders a stored code
// back to its friendly name for chip/breadcrumb display.
//
// Falls back to passing the value through unchanged whenever `dim` isn't
// one of the mapped dimensions, or the label/value has no match (e.g. an
// aggregated "Other" bucket) — so this is always safe to call.
export function makeDimResolver(filterOptions, dim) {
  const opts = filterOptions?.[dim];
  if (!opts) return { toValue: (v) => v, toLabel: (v) => v };

  const byLabel = new Map(opts.map((o) => [o.label, o.value]));
  const byValue = new Map(opts.map((o) => [o.value, o.label]));

  return {
    toValue: (label) => (byLabel.has(label) ? byLabel.get(label) : label),
    toLabel: (value) => (byValue.has(value) ? byValue.get(value) : value),
  };
}
