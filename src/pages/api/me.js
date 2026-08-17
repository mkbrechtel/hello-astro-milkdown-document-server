import { json, route, requireUser } from "../../server/api-utils.js";
export const GET = route(({ cookies }) => json({ username: requireUser(cookies) }));
