const STORAGE_KEY = "mycrew.simulatorToken";
const HEADER = "x-mycrew-simulator-token";

/**
 * Header the simulator UI sends so a gated deployment will answer it.
 *
 * Locally this is always empty and nothing checks it — the gate only applies in
 * production. On a deployment that has deliberately enabled the simulator, the
 * operator opens it once with `?token=…`; the value is kept in `sessionStorage`
 * so it survives navigation without staying in the address bar, where it would
 * end up in browser history and any `Referer` sent to a third party.
 *
 * A shared token is the right weight for an internal tool and is not a
 * substitute for owner accounts, which need a real session design.
 */
export function simulatorHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");

  if (fromUrl) {
    window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url.toString());
    return { [HEADER]: fromUrl };
  }

  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  return stored ? { [HEADER]: stored } : {};
}
