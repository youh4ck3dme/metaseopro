/**
 * PWA App Badging API Utility
 * Provides dynamic notification counter / badge on the Home Screen app icon (iOS 16.4+, Android, Desktop).
 */

export function isBadgingSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

export async function setPwaBadge(count?: number): Promise<boolean> {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) {
    return false;
  }
  try {
    if (typeof count === "number" && count > 0) {
      await navigator.setAppBadge(count);
    } else {
      await navigator.setAppBadge();
    }
    return true;
  } catch (err) {
    // Gracefully handle permission or platform denial
    console.debug("[PWA Badging] Unable to set badge:", err);
    return false;
  }
}

export async function clearPwaBadge(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("clearAppBadge" in navigator)) {
    return false;
  }
  try {
    await navigator.clearAppBadge();
    return true;
  } catch (err) {
    console.debug("[PWA Badging] Unable to clear badge:", err);
    return false;
  }
}
