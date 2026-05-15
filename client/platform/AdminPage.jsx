import React, { useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";

export function AdminPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [userQ, setUserQ] = useState("");
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const isStaff = user?.staffRole === "admin" || user?.staffRole === "moderator";
  const isAdmin = user?.staffRole === "admin";

  const loadReports = () => {
    api("/api/admin/reports?status=open")
      .then((j) => setReports(j.reports || []))
      .catch((e) => setErr(e.message));
  };

  if (!isStaff) return <p className="muted">Доступ только для модераторов.</p>;

  const searchUsers = async () => {
    if (userQ.trim().length < 2) return;
    const j = await api(`/api/admin/users/search?q=${encodeURIComponent(userQ.trim())}`);
    setUsers(j.users || []);
  };

  const closeReport = async (id) => {
    await api(`/api/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });
    loadReports();
    setMsg("Жалоба закрыта");
  };

  const freezeUser = async (id, v) => {
    await api(`/api/admin/users/${id}/freeze`, { method: "POST", body: JSON.stringify({ frozen: v }) });
    searchUsers();
    setMsg(v ? "Аккаунт ограничен" : "Ограничение снято");
  };

  const banUser = async (id) => {
    if (!window.confirm("Забанить пользователя?")) return;
    await api(`/api/admin/users/${id}/ban`, { method: "POST", body: "{}" });
    searchUsers();
    setMsg("Пользователь забанен");
  };

  const setStaff = async (id, staffRole) => {
    await api(`/api/admin/users/${id}/staff`, { method: "POST", body: JSON.stringify({ staffRole }) });
    searchUsers();
    setMsg("Роль обновлена");
  };

  return (
    <div className="platformStack">
      <section className="platformCard">
        <h3>Жалобы</h3>
        <button type="button" className="btn btnSm" onClick={loadReports}>
          Обновить
        </button>
        <ul className="adminList">
          {reports.map((r) => (
            <li key={r.id}>
              <strong>{r.target_type}</strong> {r.target_id}
              <span className="muted"> от @{r.reporter_username}</span>
              {r.reason && <p>{r.reason}</p>}
              <button type="button" className="btn btnSm btnGhost" onClick={() => closeReport(r.id)}>
                Закрыть
              </button>
            </li>
          ))}
        </ul>
        {reports.length === 0 && <p className="muted">Нет открытых жалоб</p>}
      </section>
      <section className="platformCard platformForm">
        <h3>Пользователи</h3>
        <div className="dmNewForm">
          <input value={userQ} onChange={(e) => setUserQ(e.target.value)} placeholder="Логин…" />
          <button type="button" className="btn btnSm" onClick={searchUsers}>
            Найти
          </button>
        </div>
        <ul className="adminList">
          {users.map((u) => (
            <li key={u.id}>
              <strong>@{u.username}</strong>
              {u.is_banned ? <span className="pill bad">бан</span> : null}
              {u.is_frozen ? <span className="pill bad">freeze</span> : null}
              {u.staff_role && <span className="pill ok">{u.staff_role}</span>}
              <div className="profileActions">
                <button type="button" className="btn btnSm btnGhost" onClick={() => freezeUser(u.id, !u.is_frozen)}>
                  {u.is_frozen ? "Разморозить" : "Заморозить"}
                </button>
                {isAdmin && (
                  <>
                    <button type="button" className="btn btnSm btnGhost" onClick={() => banUser(u.id)}>
                      Бан
                    </button>
                    <button type="button" className="btn btnSm" onClick={() => setStaff(u.id, "moderator")}>
                      Модер
                    </button>
                    <button type="button" className="btn btnSm" onClick={() => setStaff(u.id, null)}>
                      Снять роль
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {msg && <p className="okText">{msg}</p>}
      {err && <p className="formErr">{err}</p>}
    </div>
  );
}
