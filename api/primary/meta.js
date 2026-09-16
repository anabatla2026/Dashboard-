import { getPrimaryMeta } from "../../shared/primaryQueries.js";

export default async function handler(req, res) {
  try {
    res.status(200).json(await getPrimaryMeta());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
