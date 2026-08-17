export const COOKIE_NAME = "username";

/** Parse the username from a Cookie header string. */
export function usernameFromCookieHeader(header) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE_NAME) {
      const val = decodeURIComponent(v.join("="));
      return isValidUsername(val) ? val : null;
    }
  }
  return null;
}

export function isValidUsername(name) {
  return typeof name === "string" && /^[a-zA-Z0-9_.-]{1,32}$/.test(name);
}

export function isValidDocumentName(name) {
  return typeof name === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(name);
}
