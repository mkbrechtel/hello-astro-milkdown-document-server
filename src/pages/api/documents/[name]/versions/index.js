import { json, error, route, requireUser, requireDocName, readBody } from "../../../../../server/api-utils.js";
import { documentExists, listVersions, createVersion } from "../../../../../server/docs.js";

export const GET = route(({ params, cookies }) => {
  requireUser(cookies);
  const name = requireDocName(params);
  if (!documentExists(name)) return error("not found", 404);
  return json({ versions: listVersions(name) });
});

// POST /api/documents/:name/versions {name?, upToUpdateId?} → snapshot pointer (default: current end of the log)
export const POST = route(async ({ params, cookies, request, redirect }) => {
  const username = requireUser(cookies);
  const name = requireDocName(params);
  if (!documentExists(name)) return error("not found", 404);
  const body = await readBody(request);
  const upTo = body.upToUpdateId != null ? Number(body.upToUpdateId) : undefined;
  const v = createVersion(name, String(body.name || `v${Date.now()}`), username, upTo);
  if (body.redirect) return redirect(String(body.redirect), 303);
  return json({ version: v }, 201);
});
