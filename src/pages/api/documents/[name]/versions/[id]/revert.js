import { json, error, route, requireUser, requireDocName, readBody } from "../../../../../../server/api-utils.js";
import { revertToVersion } from "../../../../../../server/docs.js";

// POST /api/documents/:name/versions/:id/revert → live doc is set to that version (new transaction)
export const POST = route(async ({ params, cookies, request, redirect }) => {
  const username = requireUser(cookies);
  const name = requireDocName(params);
  const result = revertToVersion(name, Number(params.id), username);
  if (!result) return error("not found", 404);
  const body = await readBody(request);
  if (body.redirect) return redirect(String(body.redirect), 303);
  return json(result);
});
