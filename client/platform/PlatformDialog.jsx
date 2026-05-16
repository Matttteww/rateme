import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

function useDialogLock(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function PlatformDialog({
  open,
  onClose,
  title,
  description,
  children,
  primaryLabel = "Готово",
  secondaryLabel = "Отмена",
  onPrimary,
  showSecondary = true,
  primaryDisabled = false,
  busy = false,
  size = "md",
}) {
  const titleId = useId();
  const panelRef = useRef(null);
  useDialogLock(open, onClose);

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  if (!open) return null;
  const root = typeof document !== "undefined" ? document.body : null;
  if (!root) return null;

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div className="platDialogBackdrop" onMouseDown={handleBackdrop} role="presentation">
      <div
        ref={panelRef}
        className={`platDialog platDialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="platDialog__glow" aria-hidden />
        {title ? (
          <h2 id={titleId} className="platDialog__title">
            {title}
          </h2>
        ) : null}
        {description ? <p className="platDialog__desc">{description}</p> : null}
        {children ? <div className="platDialog__body">{children}</div> : null}
        <div className="platDialog__actions">
          {showSecondary ? (
            <button type="button" className="platDialog__btn platDialog__btn--ghost" onClick={onClose} disabled={busy}>
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="platDialog__btn platDialog__btn--primary"
            disabled={primaryDisabled || busy}
            onClick={onPrimary}
          >
            {busy ? "…" : primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    root
  );
}

/** Поле ввода + диалог (репост, жалоба и т.д.) */
export function PlatformPromptDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  label,
  placeholder = "",
  submitLabel = "Отправить",
  optional = false,
  multiline = false,
  busy = false,
}) {
  const inputId = useId();
  const [value, setValue] = React.useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const submit = () => {
    const trimmed = value.trim();
    if (!optional && !trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <PlatformDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      primaryLabel={submitLabel}
      onPrimary={submit}
      primaryDisabled={!optional && !value.trim()}
      busy={busy}
      size="sm"
    >
      <label className="platDialog__label" htmlFor={inputId}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={inputId}
          className="platDialog__input platDialog__input--area"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={3}
          autoFocus
        />
      ) : (
        <input
          id={inputId}
          type="text"
          className="platDialog__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      )}
    </PlatformDialog>
  );
}
