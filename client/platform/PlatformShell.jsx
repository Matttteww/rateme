import React, { useState } from "react";
import { PlatformAside } from "./PlatformAside.jsx";
import { PlatformScBackground } from "./PlatformScBackground.jsx";
import { PlatformAboutModal } from "./PlatformAboutModal.jsx";
import {
  IconFeed,
  IconMessage,
  IconUser,
  IconMusic,
  IconStar,
  IconCrown,
  IconSettings,
  IconLogout,
} from "./PlatformIcons.jsx";

function NavItem({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button type="button" className={`platNavItem ${active ? "platNavItem--active" : ""}`} onClick={onClick}>
      <span className="platNavIcon">{Icon ? <Icon /> : null}</span>
      <span className="platNavLabel">{label}</span>
      {badge > 0 && <span className="platNavBadge">{badge}</span>}
    </button>
  );
}

export function PlatformShell({
  section,
  user,
  onNavigate,
  onLogout,
  onViewProfile,
  notifSlot,
  children,
}) {
  const profileActive = section === "profile" || section === "settings";
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="platLayout">
      <PlatformScBackground />
      <aside className="platSidebar">
        <div className="platSidebarBrand">
          <span className="platSidebarLogo">РЭЙТМИ</span>
        </div>

        <nav className="platNav" aria-label="Платформа">
          <NavItem active={section === "feed"} onClick={() => onNavigate("feed")} icon={IconFeed} label="Лента" />
          <NavItem active={section === "beats"} onClick={() => onNavigate("beats")} icon={IconMusic} label="Биты" />
          <NavItem active={section === "openvers"} onClick={() => onNavigate("openvers")} icon={IconMusic} label="Оупены" />

          <div className="platNavSep" />

          <NavItem active={section === "rate"} onClick={() => onNavigate("rate")} icon={IconStar} label="Зацен треков" />
          <NavItem active={section === "king"} onClick={() => onNavigate("king")} icon={IconCrown} label="Царь SC" />
          <NavItem active={section === "top"} onClick={() => onNavigate("top")} icon={IconStar} label="Топы" />

          <div className="platNavSep" />

          {user && (
            <>
              <NavItem
                active={section === "myTracks"}
                onClick={() => onNavigate("myTracks")}
                icon={IconMusic}
                label="Мои треки, демо, оупены"
              />
              <NavItem
                active={section === "myBeats"}
                onClick={() => onNavigate("myBeats")}
                icon={IconMusic}
                label="Мои биты"
              />
            </>
          )}
        </nav>

        <div className="platSidebarFoot">
          {user && (
            <button
              type="button"
              className="platSidebarUser"
              onClick={() => onNavigate("profile", { username: user.username })}
            >
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="platSidebarUserAvatar" />
              ) : (
                <span className="platSidebarUserAvatar platSidebarUserAvatar--empty">@</span>
              )}
              <span className="platSidebarUserMeta">
                <span className="platSidebarUserName">{user.displayName || user.username}</span>
                <span className="muted">@{user.username}</span>
              </span>
            </button>
          )}
          {notifSlot}
          <NavItem
            active={section === "messages"}
            onClick={() => onNavigate("messages")}
            icon={IconMessage}
            label="ЛС"
          />
          {user ? (
            <>
              <NavItem
                active={profileActive}
                onClick={() => onNavigate("profile", { username: user.username })}
                icon={IconUser}
                label="Профиль"
              />
              <NavItem active={section === "settings"} onClick={() => onNavigate("settings")} icon={IconSettings} label="Настройки" />
              {user.staffRole && (
                <NavItem active={section === "admin"} onClick={() => onNavigate("admin")} icon={IconSettings} label="Модерация" />
              )}
              <button type="button" className="platNavItem platNavItem--logout" onClick={onLogout}>
                <span className="platNavIcon">
                  <IconLogout />
                </span>
                <span className="platNavLabel">Выйти</span>
              </button>
            </>
          ) : (
            <NavItem active={section === "auth"} onClick={() => onNavigate("auth")} icon={IconUser} label="Войти" />
          )}
          <footer className="platSidebarLegal">
            <button type="button" className="platAboutLink" onClick={() => setAboutOpen(true)}>
              О платформе
            </button>
            <span className="platAsideCopy muted">© РЭЙТМИ</span>
          </footer>
        </div>
      </aside>

      <PlatformAboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <main className={`platMain ${section === "messages" ? "platMain--dm" : ""}`}>{children}</main>

      {section !== "messages" && (
        <PlatformAside onViewProfile={onViewProfile} onNavigate={onNavigate} />
      )}
    </div>
  );
}
