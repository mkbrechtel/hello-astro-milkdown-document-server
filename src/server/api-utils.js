import { COOKIE_NAME, isValidUsername, isValidDocumentName } from "./auth.js";

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json" } });

export const error = (message, status) => json({ error: message }, status);

/** Returns the username from the cookie or throws a 401 Response. */
export function requireUser(cookies) {
  const u = cookies.get(COOKIE_NAME)?.value;
  if (!isValidUsername(u)) throw error("login required (POST /api/login)", 401);
  return u;
}

export function requireDocName(params) {
  const name = params.name;
  if (!isValidDocumentName(name)) throw error("invalid document name", 400);
  return name;
}

/** Wrap a handler so thrown Responses are returned. */
export const route = (fn) => async (ctx) => {
  try {
    return await fn(ctx);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return error(String(e?.message ?? e), 500);
  }
};

export async function readBody(request) {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return await request.json();
  if (ct.includes("form")) return Object.fromEntries(await request.formData());
  const text = await request.text();
  return text ? { text } : {};
}
