/**
 * A readable, non-secret companion to the httpOnly customer session cookie. Storefront pages are
 * served from the static cache, so the browser asks for account favorites only when this says a
 * customer may be signed in; anonymous visitors and crawlers never trigger a server call.
 */
export const SIGNED_IN_MARKER_COOKIE = "maytha_signed_in";

/** Signed-out browsers that have already been checked once (sessions from before the marker existed). */
export const ACCOUNT_PROBED_STORAGE_KEY = "maytha_account_probed";

export function hasSignedInMarker(cookieHeader: string): boolean {
  return cookieHeader
    .split(";")
    .some((part) => part.trim() === `${SIGNED_IN_MARKER_COOKIE}=1`);
}

const ACCOUNT_CHANGED_EVENT = "maytha:account-changed";

/** Tells the favorites provider to look again after signing in or out in this tab. */
export function notifyAccountChanged(): void {
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
}

/** Calls back after a sign-in or sign-out here, or when the tab comes back into view. */
export function onAccountMaybeChanged(callback: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") callback();
  };
  window.addEventListener(ACCOUNT_CHANGED_EVENT, callback);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener(ACCOUNT_CHANGED_EVENT, callback);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
