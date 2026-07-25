"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";

type AnalyticsSummary = {
  trackingStartedAt: string;
  lastVisitAt: string;
  today: { uniqueVisitors: number; visits: number };
  last7Visits: number;
  last30Visits: number;
  retainedVisits: number;
  recentDays: Array<{ date: string; uniqueVisitors: number; visits: number }>;
  topCountries: Array<{ country: string; visits: number }>;
};

const formatDate = (value: string, includeTime = false) => {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
};

const countryLabel = (country: string) => {
  if (country === "--") return "Sin país disponible";
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(country) || country;
  } catch {
    return country;
  }
};

export default function VisitorAnalytics() {
  const [token, setToken] = useState("");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const activeToken = useRef("");

  const loadSummary = async (accessToken: string) => {
    if (!accessToken) return;
    setState("loading");
    try {
      const response = await fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token: accessToken }),
      });
      if (!response.ok) throw new Error("Acceso denegado");
      setSummary((await response.json()) as AnalyticsSummary);
      activeToken.current = accessToken;
      setToken("");
      setState("idle");
    } catch {
      activeToken.current = "";
      setSummary(null);
      setState("error");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void loadSummary(token.trim());
  };

  if (!summary) {
    return (
      <main className="analytics-shell">
        <section className="analytics-login" aria-labelledby="analytics-title">
          <Link className="analytics-brand" href="/" aria-label="Volver a FOCO Centro">
            <span className="brand-mark"><i></i></span>
            <span><b>FOCO</b><small>CENTRO</small></span>
          </Link>
          <span className="analytics-private-label">PANEL PRIVADO</span>
          <h1 id="analytics-title">Visitas</h1>
          <p>Introduce la clave local de analítica. La clave no se guarda en el navegador.</p>
          <form onSubmit={submit}>
            <label htmlFor="analytics-token">Clave de acceso</label>
            <input
              id="analytics-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              minLength={32}
              required
              autoFocus
            />
            <button type="submit" disabled={state === "loading" || token.trim().length < 32}>
              {state === "loading" ? "Comprobando…" : "Abrir estadísticas"}
            </button>
          </form>
          {state === "error" && <p className="analytics-error">Clave incorrecta o panel no disponible.</p>}
          <small>No se guardan direcciones IP, agentes de navegador ni páginas visitadas en claro.</small>
        </section>
      </main>
    );
  }

  return (
    <main className="analytics-shell analytics-shell--dashboard">
      <section className="analytics-dashboard">
        <header>
          <div>
            <span className="analytics-private-label">PANEL PRIVADO</span>
            <h1>Visitas a FOCO</h1>
            <p>
              Seguimiento desde {formatDate(summary.trackingStartedAt, true)} · última sesión {formatDate(summary.lastVisitAt, true)}
            </p>
          </div>
          <div className="analytics-actions">
            <button type="button" onClick={() => void loadSummary(activeToken.current)} disabled={state === "loading"}>
              {state === "loading" ? "Actualizando…" : "Actualizar"}
            </button>
            <button
              type="button"
              className="analytics-secondary"
              onClick={() => {
                activeToken.current = "";
                setSummary(null);
              }}
            >
              Cerrar
            </button>
          </div>
        </header>

        <section className="analytics-metrics" aria-label="Resumen de visitas">
          <article><span>Personas hoy</span><strong>{summary.today.uniqueVisitors}</strong><small>Aproximadas y sin cookies</small></article>
          <article><span>Sesiones hoy</span><strong>{summary.today.visits}</strong><small>Ventanas de 30 minutos</small></article>
          <article><span>Últimos 7 días</span><strong>{summary.last7Visits}</strong><small>Sesiones</small></article>
          <article><span>Últimos 30 días</span><strong>{summary.last30Visits}</strong><small>Sesiones</small></article>
        </section>

        <div className="analytics-grid">
          <section className="analytics-table-card">
            <div className="analytics-section-heading">
              <h2>Actividad diaria</h2>
              <span>{summary.retainedVisits} sesiones conservadas</span>
            </div>
            {summary.recentDays.length ? (
              <div className="analytics-table-wrap">
                <table>
                  <thead><tr><th>Fecha</th><th>Personas</th><th>Sesiones</th></tr></thead>
                  <tbody>
                    {summary.recentDays.map((day) => (
                      <tr key={day.date}>
                        <td>{formatDate(day.date)}</td>
                        <td>{day.uniqueVisitors}</td>
                        <td>{day.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="analytics-empty">Todavía no se ha registrado ninguna visita.</p>}
          </section>

          <section className="analytics-country-card">
            <h2>País aproximado</h2>
            {summary.topCountries.length ? (
              <ol>
                {summary.topCountries.map((item) => (
                  <li key={item.country}><span>{countryLabel(item.country)}</span><strong>{item.visits}</strong></li>
                ))}
              </ol>
            ) : <p className="analytics-empty">Sin información geográfica todavía.</p>}
          </section>
        </div>
      </section>
    </main>
  );
}
