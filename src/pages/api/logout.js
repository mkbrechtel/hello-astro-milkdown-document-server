import { COOKIE_NAME } from "../../server/auth.js";
export const POST = ({ cookies, redirect }) => {
  cookies.delete(COOKIE_NAME, { path: "/" });
  return redirect("/login", 303);
};
