export const DISCOVER_CHANGED = "platform:discover-changed";
/** @deprecated используйте DISCOVER_CHANGED */
export const RELEASES_CHANGED = DISCOVER_CHANGED;

export function notifyDiscoverChanged() {
  window.dispatchEvent(new CustomEvent(DISCOVER_CHANGED));
}

/** @deprecated */
export function notifyReleasesChanged() {
  notifyDiscoverChanged();
}
