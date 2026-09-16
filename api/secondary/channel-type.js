import { getByChannelType } from "../../shared/secondaryQueries.js";
import { parseFilters } from "../../shared/httpParams.js";

export default async function handler(req, res) {
  try {
    const data = await getByChannelType({
      filters: parseFilters(req.query),
      level: req.query.level || "chType",
      channel: req.query.channel,
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
