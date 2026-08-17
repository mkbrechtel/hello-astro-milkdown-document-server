import { json, error, route, requireUser, requireDocName } from "../../../../server/api-utils.js";
import { createDocument, deleteDocument, getDocumentContent } from "../../../../server/docs.js";

// GET /api/documents/:name            → JSON {name, markdown, json, ...}
// GET /api/documents/:name?format=markdown → text/markdown
export const GET = route(({ params, cookies, url }) => {
  requireUser(cookies);
  const name = requireDocName(params);
  const content = getDocumentContent(name);
  if (!content) return error("not found", 404);
  const format = url.searchParams.get("format");
  if (format === "markdown" || format === "md")
    return new Response(content.markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (format === "json") return json(content.json);
  return json(content);
});

export const PUT = route(({ params, cookies }) => {
  const username = requireUser(cookies);
  const name = requireDocName(params);
  const { created, row } = createDocument(name, username);
  return json({ created, document: row }, created ? 201 : 200);
});

export const DELETE = route(({ params, cookies }) => {
  requireUser(cookies);
  const name = requireDocName(params);
  return deleteDocument(name) ? json({ deleted: name }) : error("not found", 404);
});
