import { useCallback, useEffect, useState } from "react";
import { parseAppHash, writeAppHash } from "./hashRouter.js";

export function useAppHash() {
  const [route, setRoute] = useState(() => parseAppHash());

  useEffect(() => {
    const onHash = () => setRoute(parseAppHash());
    window.addEventListener("hashchange", onHash);
    const hash = window.location.hash.replace(/^#/, "");
    const isTgAuth = hash.startsWith("tgAuthResult=");
    if (!window.location.hash || isTgAuth) {
      if (!isTgAuth) writeAppHash({ section: "feed" });
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback(({ section, username, releaseId }) => {
    writeAppHash({ section, username, releaseId });
    setRoute(parseAppHash());
  }, []);

  return { route, navigate };
}
