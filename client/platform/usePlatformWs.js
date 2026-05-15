import { useEffect } from "react";
import { useAuth } from "./AuthContext.jsx";

export function usePlatformWs(onMessage) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.DEV ? `${window.location.hostname}:3847` : window.location.host;
    const ws = new WebSocket(`${proto}//${host}/ws`);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type) onMessage?.(msg);
      } catch {
        /* */
      }
    };

    return () => ws.close();
  }, [user, onMessage]);
}
