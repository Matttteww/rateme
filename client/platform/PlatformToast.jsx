import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

let pushToast = null;

/** Глобальные всплывающие уведомления (вместо alert). */
export function showPlatformToast(message, variant = "default") {
  if (!message) return;
  pushToast?.({ message, variant, id: Date.now() });
}

export function PlatformToastHost() {
  const [item, setItem] = useState(null);

  const dismiss = useCallback(() => setItem(null), []);

  useEffect(() => {
    pushToast = (next) => setItem(next);
    return () => {
      pushToast = null;
    };
  }, []);

  useEffect(() => {
    if (!item) return undefined;
    const t = setTimeout(dismiss, 3200);
    return () => clearTimeout(t);
  }, [item, dismiss]);

  if (!item) return null;
  const root = typeof document !== "undefined" ? document.body : null;
  if (!root) return null;

  return createPortal(
    <div className="platToastHost" role="status" aria-live="polite">
      <div key={item.id} className={`platToast platToast--${item.variant || "default"}`}>
        <span className="platToast__text">{item.message}</span>
        <button type="button" className="platToast__close" onClick={dismiss} aria-label="Закрыть">
          ×
        </button>
      </div>
    </div>,
    root
  );
}
