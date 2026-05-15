/** Маршруты: #/feed, #/messages, #/u/username */
export function parseAppHash() {
  const hash = window.location.hash || "#/feed";
  if (hash.replace(/^#/, "").startsWith("tgAuthResult=")) {
    return { section: "feed", username: null, releaseId: null };
  }
  const raw = hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "u" && parts[1]) {
    return { section: "profile", username: decodeURIComponent(parts[1]), releaseId: null };
  }
  let section = parts[0] || "feed";
  if (section === "discover" || section === "search") section = "feed";
  if (section === "releases") section = "myTracks";
  let releaseId = null;
  if (parts[0] === "releases" && parts[1]) {
    section = "myTracks";
    releaseId = decodeURIComponent(parts[1]);
  } else if (section === "myTracks" && parts[1]) {
    releaseId = decodeURIComponent(parts[1]);
  }
  return { section, username: null, releaseId };
}

export function writeAppHash({ section, username, releaseId }) {
  if (section === "profile" && username) {
    window.location.hash = `#/u/${encodeURIComponent(username)}`;
    return;
  }
  if (section === "myTracks" && releaseId) {
    window.location.hash = `#/myTracks/${encodeURIComponent(releaseId)}`;
    return;
  }
  if (section === "releases" && releaseId) {
    window.location.hash = `#/myTracks/${encodeURIComponent(releaseId)}`;
    return;
  }
  window.location.hash = `#/${section}`;
}
