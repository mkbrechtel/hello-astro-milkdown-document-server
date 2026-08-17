import { json, error, route, requireUser, requireDocName } from "../../../../server/api-utils.js";
import { documentExists, listUpdates, getStateAtUpdate } from "../../../../server/docs.js";

// GET /api/documents/:name/updates          → the transaction log (who/when/size)
// GET /api/documents/:name/updates?at=<id>  → document reconstructed as of update <id>
export const GET = route(({ params, cookies, url }) => {
  requireUser(cookies);
  const name = requireDocName(params);
  if (!documentExists(name)) return error("not found", 404);
  const at = url.searchParams.get("at");
  if (at != null) return json(getStateAtUpdate(name, Number(at)));
  return json({ updates: listUpdates(name) });
});
