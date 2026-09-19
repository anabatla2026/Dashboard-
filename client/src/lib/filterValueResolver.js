// Charts display a friendly NAME for some dims (e.g. "Baby Diapers"), but
// the global filter for those dims tracks a mapping-table CODE
// (Region/Category/Distributor; Brand/Channel Type/Town don't have one). A
// chart mark's clicked label is resolved to that code before it's written
// to or compared against filters[dim]; the reverse lookup renders a stored
// code back to its friendly name for display.
//
// Falls back to passing the value through unchanged when `dim` isn't mapped
// or there's no match (e.g. an aggregated "Other" bucket).
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
