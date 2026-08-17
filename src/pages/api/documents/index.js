import { json, error, route, requireUser, readBody } from "../../../server/api-utils.js";
import { isValidDocumentName } from "../../../server/auth.js";
import { listDocuments, createDocument } from "../../../server/docs.js";

export const GET = route(({ cookies }) => {
  requireUser(cookies);
  return json({ documents: listDocuments() });
});

// Create via POST /api/documents {name} (also used by the HTML form on the index page).
export const POST = route(async ({ request, cookies, redirect }) => {
  const username = requireUser(cookies);
  const body = await readBody(request);
  if (!isValidDocumentName(body.name)) return error("invalid document name", 400);
  const { created, row } = createDocument(body.name, username);
  if (body.redirect) return redirect(`/docs/${encodeURIComponent(body.name)}`, 303);
  return json({ created, document: row }, created ? 201 : 200);
});
