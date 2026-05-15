import React, { useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { TelegramLogin } from "./TelegramLogin.jsx";
import { IconEye, IconEyeOff } from "./PlatformIcons.jsx";
import { PlatformScBackground } from "./PlatformScBackground.jsx";

const ROLES = ["listener", "rapper", "beatmaker", "mixer"];

export function AuthScreen({ initialMode = "login", onDone }) {
  const { login, register, tgError } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
    roles: ["listener"],
  });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(form.username, form.password, true);
      } else {
        await register({
          username: form.username,
          password: form.password,
          displayName: form.displayName || form.username,
          roles: form.roles,
        });
      }
      onDone?.();
    } catch (ex) {
      setErr(ex.message || String(ex));
    } finally {
      setBusy(false);
    }
  };

  const toggleRole = (r) => {
    setForm((f) => {
      const has = f.roles.includes(r);
      const roles = has ? f.roles.filter((x) => x !== r) : [...f.roles, r];
      return { ...f, roles: roles.length ? roles : ["listener"] };
    });
  };

  return (
    <div className="authScreen">
      <PlatformScBackground />
      <div className="authScreenInner">
        <div className="authBrand">РЭЙТМИ</div>
        <h1 className="authTitle">{mode === "login" ? "Вход" : "Регистрация"}</h1>
        <p className="authSubtitle">
          {mode === "login" ? "Пожалуйста, введите ваши данные" : "Создайте аккаунт на платформе"}
        </p>

        <form className="authForm" onSubmit={submit}>
          <label className="authField">
            <span className="authLabel">Логин</span>
            <input
              className="authInput"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoComplete="username"
              placeholder="nickname"
              required
            />
          </label>

          <label className="authField">
            <span className="authLabel">Пароль</span>
            <div className="authInputWrap">
              <input
                className="authInput authInput--withIcon"
                type={showPass ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••"
                required
                minLength={8}
              />
              <button
                type="button"
                className="authEyeBtn"
                onClick={() => setShowPass(!showPass)}
                aria-label={showPass ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPass ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </label>

          {mode === "register" && (
            <>
              <label className="authField">
                <span className="authLabel">Имя на сайте</span>
                <input
                  className="authInput"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="Как вас показывать"
                />
              </label>
              <fieldset className="authRoles">
                <legend className="authLabel">Роли</legend>
                <div className="authRolesGrid">
                  {ROLES.map((r) => (
                    <label key={r} className={`authRoleChip ${form.roles.includes(r) ? "authRoleChip--on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={form.roles.includes(r)}
                        onChange={() => toggleRole(r)}
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {(err || tgError) && <p className="authErr">{err || tgError}</p>}

          <button type="submit" className="authSubmit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
        </form>

        {mode === "login" && (
          <>
            <p className="authDivider">
              <span>или</span>
            </p>
            <div className="authTelegram">
              <TelegramLogin onSuccess={onDone} />
            </div>
          </>
        )}

        <p className="authFooter">
          {mode === "login" ? (
            <>
              Ещё нет аккаунта?{" "}
              <button type="button" className="authLink" onClick={() => setMode("register")}>
                Создать аккаунт
              </button>
            </>
          ) : (
            <>
              Уже есть аккаунт?{" "}
              <button type="button" className="authLink" onClick={() => setMode("login")}>
                Войти
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
