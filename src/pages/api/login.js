import { COOKIE_NAME, isValidUsername } from "../../server/auth.js";
import { json, error, route, readBody } from "../../server/api-utils.js";

// "Login" for this prototype = set a username cookie. No password, no session store.
export const POST = route(async ({ request, cookies, redirect }) => {
  const body = await readBody(request);
  const username = body.username;
  if (!isValidUsername(username)) return error("username must match [a-zA-Z0-9_.-]{1,32}", 400);
  cookies.set(COOKIE_NAME, username, { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  if (body.redirect) return redirect(String(body.redirect), 303);
  return json({ username });
});

export const DELETE = route(async ({ cookies }) => {
  cookies.delete(COOKIE_NAME, { path: "/" });
  return json({ ok: true });
});
