import React from "react";

/** Блок «нужно войти» — единый стиль для лайков, комментариев, загрузок. */
export function GuestGateCard({
  title = "Войдите в аккаунт",
  subtitle = "Чтобы пользоваться этой функцией, нужна регистрация или вход.",
  actionLabel = "Войти или зарегистрироваться",
  onAction,
  compact = false,
  icon = "heart",
}) {
  return (
    <div className={`guestGate ${compact ? "guestGate--compact" : ""}`} role="status">
      <span className={`guestGate__icon guestGate__icon--${icon}`} aria-hidden>
        {icon === "heart" && "♡"}
        {icon === "message" && "💬"}
        {icon === "upload" && "↑"}
        {icon === "star" && "★"}
        {icon === "lock" && "◆"}
      </span>
      <div className="guestGate__text">
        <p className="guestGate__title">{title}</p>
        <p className="guestGate__sub">{subtitle}</p>
      </div>
      {onAction && (
        <button type="button" className="guestGate__btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
