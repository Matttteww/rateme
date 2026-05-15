import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";

const ROLES = ["listener", "rapper", "beatmaker", "mixer"];
const ROLE_LABELS = {
  listener: "Слушатель",
  rapper: "Рэпер",
  beatmaker: "Битмейкер",
  mixer: "Сведение",
};

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [username, setUsername] = useState(user?.username || "");
  const [roles, setRoles] = useState(user?.roles?.filter((r) => r !== "streamer") || ["listener"]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [curPw, setCurPw] = useState("");
  const [changeNewPw, setChangeNewPw] = useState("");
  const [linkPw, setLinkPw] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || "");
    setBio(user.bio || "");
    setUsername(user.username || "");
    setRoles(user.roles?.filter((r) => r !== "streamer") || ["listener"]);
  }, [user]);

  if (!user) return <p className="muted settingsEmpty">Войдите в аккаунт.</p>;

  const flash = (text, isErr = false) => {
    if (isErr) {
      setErr(text);
      setMsg("");
    } else {
      setMsg(text);
      setErr("");
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const j = await api("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName, bio, username, roles }),
      });
      await refresh();
      flash("Профиль сохранён");
      if (j.user) {
        setDisplayName(j.user.displayName);
        setUsername(j.user.username);
      }
    } catch (ex) {
      flash(ex.message, true);
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/users/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: curPw, newPassword: changeNewPw }),
      });
      setCurPw("");
      setChangeNewPw("");
      flash("Пароль изменён");
    } catch (ex) {
      flash(ex.message, true);
    } finally {
      setSaving(false);
    }
  };

  const linkPassword = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/users/me/link-password", {
        method: "POST",
        body: JSON.stringify({ newPassword: linkPw }),
      });
      setLinkPw("");
      flash("Пароль для входа задан");
    } catch (ex) {
      flash(ex.message, true);
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("avatar", file);
    try {
      await api("/api/users/me/avatar", { method: "POST", body: fd });
      await refresh();
      flash("Аватар обновлён");
    } catch (ex) {
      flash(ex.message, true);
    }
    e.target.value = "";
  };

  const uploadBanner = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("banner", file);
    try {
      await api("/api/users/me/banner", { method: "POST", body: fd });
      await refresh();
      flash("Шапка профиля обновлена");
    } catch (ex) {
      flash(ex.message, true);
    }
    e.target.value = "";
  };

  const toggleRole = (r) => {
    setRoles((prev) => {
      const has = prev.includes(r);
      const next = has ? prev.filter((x) => x !== r) : [...prev, r];
      return next.length ? next : ["listener"];
    });
  };

  return (
    <div className="settingsPage">
      <header className="settingsHero">
        <div
          className={`settingsHeroBg ${user.bannerUrl ? "settingsHeroBg--image" : ""}`}
          style={user.bannerUrl ? { backgroundImage: `url(${user.bannerUrl})` } : undefined}
          aria-hidden
        />
        <button
          type="button"
          className="settingsBannerBtn"
          onClick={() => bannerInputRef.current?.click()}
        >
          Изменить шапку
        </button>
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="settingsFileHidden"
          onChange={uploadBanner}
        />
        <div className="settingsHeroInner">
          <div className="settingsAvatarBlock">
            <button
              type="button"
              className="settingsAvatarBtn"
              onClick={() => avatarInputRef.current?.click()}
              aria-label="Загрузить аватар"
            >
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="settingsAvatarImg" />
              ) : (
                <span className="settingsAvatarPlaceholder">
                  {(displayName || username || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="settingsAvatarOverlay">Изменить</span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="settingsFileHidden"
              onChange={uploadAvatar}
            />
          </div>
          <div className="settingsHeroText">
            <h1 className="settingsTitle">{displayName || username || "Настройки"}</h1>
            <p className="settingsHandle">@{username}</p>
            {user.telegramLinked && (
              <span className="settingsBadge settingsBadge--tg">Telegram подключён</span>
            )}
          </div>
        </div>
      </header>

      {(msg || err) && (
        <div className={`settingsToast ${err ? "settingsToast--err" : "settingsToast--ok"}`} role="status">
          {err || msg}
        </div>
      )}

      <section className="settingsCard">
        <h2 className="settingsCardTitle">Профиль</h2>
        <p className="settingsCardSub muted">Имя, логин и роли видны другим на платформе</p>
        <form className="settingsForm" onSubmit={saveProfile}>
          <div className="settingsField">
            <label className="settingsLabel" htmlFor="settings-login">
              Логин
            </label>
            <span className="settingsHint muted">Можно менять не чаще одного раза в 7 дней</span>
            <input
              id="settings-login"
              className="settingsInput"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="settingsField">
            <label className="settingsLabel" htmlFor="settings-name">
              Имя на сайте
            </label>
            <input
              id="settings-name"
              className="settingsInput"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="settingsField">
            <label className="settingsLabel" htmlFor="settings-bio">
              О себе
            </label>
            <textarea
              id="settings-bio"
              className="settingsInput settingsTextarea"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="Расскажите о себе…"
            />
            <span className="settingsCharCount muted">{bio.length}/500</span>
          </div>
          <fieldset className="settingsRoles">
            <legend className="settingsLabel">Роли</legend>
            <div className="settingsRolesGrid">
              {ROLES.map((r) => (
                <label key={r} className={`settingsRoleChip ${roles.includes(r) ? "settingsRoleChip--on" : ""}`}>
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
                  {ROLE_LABELS[r] || r}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="settingsSubmit" disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить профиль"}
          </button>
        </form>
      </section>

      {user.telegramLinked && (
        <section className="settingsCard settingsCard--accent">
          <h2 className="settingsCardTitle">Вход по логину</h2>
          <p className="settingsCardSub muted">
            Вы вошли через Telegram. Задайте пароль, чтобы входить также по @логину и паролю.
          </p>
          <form className="settingsForm" onSubmit={linkPassword}>
            <div className="settingsField">
              <label className="settingsLabel" htmlFor="settings-link-pw">
                Новый пароль
              </label>
              <input
                id="settings-link-pw"
                type="password"
                className="settingsInput"
                value={linkPw}
                onChange={(e) => setLinkPw(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                placeholder="Не менее 8 символов"
              />
            </div>
            <button type="submit" className="settingsSubmit settingsSubmit--secondary" disabled={saving}>
              Сохранить пароль
            </button>
          </form>
        </section>
      )}

      <section className="settingsCard">
        <h2 className="settingsCardTitle">Смена пароля</h2>
        <p className="settingsCardSub muted">Если вы уже входите по паролю</p>
        <form className="settingsForm" onSubmit={savePassword}>
          <div className="settingsField">
            <label className="settingsLabel" htmlFor="settings-cur-pw">
              Текущий пароль
            </label>
            <input
              id="settings-cur-pw"
              type="password"
              className="settingsInput"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="settingsField">
            <label className="settingsLabel" htmlFor="settings-new-pw">
              Новый пароль
            </label>
            <input
              id="settings-new-pw"
              type="password"
              className="settingsInput"
              value={changeNewPw}
              onChange={(e) => setChangeNewPw(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
              placeholder="Не менее 8 символов"
            />
          </div>
          <button type="submit" className="settingsSubmit settingsSubmit--ghost" disabled={saving}>
            Сменить пароль
          </button>
        </form>
      </section>
    </div>
  );
}
