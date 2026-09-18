import { getFilterOptions } from "../shared/filterOptions.js";

export default async function handler(req, res) {
  try {
    res.status(200).json(await getFilterOptions());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
