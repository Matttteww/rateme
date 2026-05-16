import React, { useEffect, useState } from "react";

/** Держит вкладку в DOM после первого открытия — мгновенное переключение назад. */
export function KeepAliveSection({ active, children }) {
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  if (!mounted) return null;

  return (
    <div className="platSectionKeep" hidden={!active} aria-hidden={!active}>
      {children}
    </div>
  );
}
