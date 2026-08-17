import { json, error, route, requireUser, requireDocName } from "../../../../../../server/api-utils.js";
import { getVersionContent, deleteVersion } from "../../../../../../server/docs.js";

export const GET = route(({ params, cookies, url }) => {
  requireUser(cookies);
  const name = requireDocName(params);
  const v = getVersionContent(name, Number(params.id));
  if (!v) return error("not found", 404);
  const format = url.searchParams.get("format");
  if (format === "markdown" || format === "md")
    return new Response(v.markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  return json(v);
});

export const DELETE = route(({ params, cookies }) => {
  requireUser(cookies);
  const name = requireDocName(params);
  return deleteVersion(name, Number(params.id)) ? json({ deleted: Number(params.id) }) : error("not found", 404);
});
