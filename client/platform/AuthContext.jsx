import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import {
  clearTelegramAuthState,
  clearTelegramCallbackUrl,
  getTelegramCallbackData,
  markTelegramHashProcessed,
  wasTelegramHashProcessed,
} from "./telegramCallback.js";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tgError, setTgError] = useState("");
  const tgInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const j = await api("/api/auth/me");
      setUser(j.user || null);
      return j.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const completeTelegramAuth = useCallback(async (tgData) => {
    if (!tgData?.hash) throw new Error("Нет данных Telegram.");

    const j = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify(tgData),
    });
    setUser(j.user);
    markTelegramHashProcessed(tgData.hash);
    clearTelegramCallbackUrl();
    setTgError("");
    return j.user;
  }, []);

  useEffect(() => {
    const tgData = getTelegramCallbackData();
    if (!tgData) {
      refresh().catch(() => setLoading(false));
      return;
    }

    if (wasTelegramHashProcessed(tgData.hash)) {
      clearTelegramCallbackUrl();
      refresh().catch(() => setLoading(false));
      return;
    }

    if (tgInFlight.current) return;
    tgInFlight.current = true;

    (async () => {
      setLoading(true);
      setTgError("");
      try {
        await completeTelegramAuth(tgData);
      } catch (e) {
        setTgError(e.message || "Ошибка входа через Telegram");
        await refresh();
      } finally {
        tgInFlight.current = false;
        setLoading(false);
      }
    })();
  }, [refresh, completeTelegramAuth]);

  const login = async (loginOrEmail, password, remember) => {
    const j = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ loginOrEmail, password, remember }),
    });
    setUser(j.user);
    return j.user;
  };

  const register = async (payload) => {
    const j = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setUser(j.user);
    return j.user;
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      /* cookie мог уже отсутствовать */
    }
    tgInFlight.current = false;
    clearTelegramAuthState();
    clearTelegramCallbackUrl();
    setTgError("");
    setUser(null);
  };

  const loginTelegram = async (telegramUser) => {
    setLoading(true);
    try {
      return await completeTelegramAuth(telegramUser);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        tgError,
        setTgError,
        login,
        register,
        logout,
        refresh,
        loginTelegram,
        completeTelegramAuth,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth вне AuthProvider");
  return v;
}
