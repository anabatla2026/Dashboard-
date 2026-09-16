import { getSecondaryMeta } from "../../shared/secondaryQueries.js";

export default async function handler(req, res) {
  try {
    res.status(200).json(await getSecondaryMeta());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
