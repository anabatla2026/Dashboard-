import { getSecondaryDims } from "../../shared/secondaryQueries.js";

export default async function handler(req, res) {
  try {
    res.status(200).json(await getSecondaryDims());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
