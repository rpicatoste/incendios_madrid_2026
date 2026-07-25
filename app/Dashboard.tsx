"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultRegionData,
  type RegionData,
  type SituationPoint,
  type StatusKind,
} from "../lib/region-data";

declare global {
  interface Window {
    L?: any;
  }
}

type AirStation = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  label: string;
  color: string;
  pollutant: string | null;
  value: number | null;
  index?: number;
  incomplete?: boolean;
  hour: string | null;
};

type ForecastHour = {
  time: string;
  cloud: number;
  sunMinutes: number;
  rainProbability: number;
  rain: number;
  wind: number;
  windDirection: number;
};

type LiveStatus = {
  lastUpdated: string;
  evacuated: string[];
  shelters: string[];
  roads: string[];
  fetchedAt: string;
};

type SnapshotData = {
  status: LiveStatus;
  airStations: AirStation[];
  region: RegionData;
  layerTime: string;
};

type SnapshotRecord = {
  id: string;
  capturedAt: string;
  data: SnapshotData;
};

const OFFICIAL_URL =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";
const DSN_URL = "https://www.dsn.gob.es/gl/node/32742";
const CLM_URL =
  "https://www.castillalamancha.es/actualidad/notasdeprensa/castilla-la-mancha-moviliza-un-amplio-operativo-para-hacer-frente-los-incendios-registrados-en-la";
const CEMS_LA_MIERLA_URL =
  "https://mapping.emergency.copernicus.eu/activations/EMSR898/";
const MITECO_ICA_URL = "https://ica.miteco.es/datos/ica-ultima-hora.csv";

const fallbackStatus: LiveStatus = {
  lastUpdated: "24 de julio · 23:30 h",
  evacuated: defaultRegionData.points
    .filter((point) => point.kind === "evacuado" && point.province === "Madrid")
    .map((point) => point.name),
  shelters: defaultRegionData.points
    .filter((point) => point.kind === "acogida")
    .map((point) => point.name),
  roads: ["M-50", "M-540", "M-501", "M-541", "M-510", "M-512", "M-531", "M-539", "M-533", "M-521"],
  fetchedAt: "",
};

const kindMeta: Record<StatusKind, { label: string; plural: string; color: string; icon: string }> = {
  evacuado: { label: "Evacuación", plural: "Evacuaciones", color: "#ff5a45", icon: "EV" },
  confinado: { label: "Confinamiento", plural: "Confinamientos", color: "#ffb33f", icon: "⌂" },
  acogida: { label: "Punto de acogida", plural: "Puntos de acogida", color: "#49b8ff", icon: "+" },
  seguimiento: { label: "Incendio en seguimiento", plural: "En seguimiento", color: "#8d62db", icon: "!" },
};

const escapeHtml = (value: string | number | null | undefined) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const loadLeaflet = async () => {
  if (window.L) return window.L;
  const leafletModule = await import("leaflet");
  window.L = leafletModule.default || leafletModule;
  return window.L;
};

const compass = (degrees: number) => {
  const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return directions[Math.round(degrees / 45) % 8];
};

const describeSun = (hour: ForecastHour) => {
  if (hour.sunMinutes >= 45) return "Despejado";
  if (hour.sunMinutes >= 15) return "Con claros";
  if (hour.cloud >= 70) return "Cubierto";
  return "Sin sol";
};

const formatSnapshotTime = (value: string) =>
  new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export default function Dashboard() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const situationLayerRef = useRef<any>(null);
  const fireAreaLayerRef = useRef<any>(null);
  const airLayerRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const burntLayerRef = useRef<any>(null);
  const smokeLayerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const canvasRendererRef = useRef<any>(null);
  const forecastRequestRef = useRef<AbortController | null>(null);
  const forecastCacheRef = useRef<Map<string, ForecastHour[]>>(new Map());

  const [liveStatus, setLiveStatus] = useState<LiveStatus>(fallbackStatus);
  const [liveAirStations, setLiveAirStations] = useState<AirStation[]>([]);
  const [liveRegion, setLiveRegion] = useState<RegionData>(defaultRegionData);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [snapshotIndex, setSnapshotIndex] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [locationState, setLocationState] = useState("Buscando tu posición…");
  const [activeKinds, setActiveKinds] = useState<Record<StatusKind, boolean>>({
    evacuado: true,
    confinado: true,
    acogida: true,
    seguimiento: true,
  });
  const [airVisible, setAirVisible] = useState(true);
  const [heatVisible, setHeatVisible] = useState(true);
  const [burntVisible, setBurntVisible] = useState(true);
  const [smokeVisible, setSmokeVisible] = useState(true);
  const [fireAreasVisible, setFireAreasVisible] = useState(true);
  const [userVisible, setUserVisible] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [forecastState, setForecastState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeList, setActiveList] = useState<StatusKind>("evacuado");

  const selectedSnapshot = snapshotIndex === null ? null : snapshots[snapshotIndex] || null;
  const displayStatus = selectedSnapshot?.data.status || liveStatus;
  const displayAirStations = selectedSnapshot?.data.airStations || liveAirStations;
  const displayRegion = selectedSnapshot?.data.region || liveRegion;
  const layerTime = selectedSnapshot?.data.layerTime || new Date().toISOString();
  const isLive = selectedSnapshot === null;

  const visiblePoints = useMemo(
    () => displayRegion.points.filter((point) => point.kind === activeList),
    [activeList, displayRegion.points],
  );

  const counts = useMemo(
    () => ({
      evacuado: displayRegion.points.filter((point) => point.kind === "evacuado").length,
      confinado: displayRegion.points.filter((point) => point.kind === "confinado").length,
      acogida: displayRegion.points.filter((point) => point.kind === "acogida").length,
      seguimiento: displayRegion.points.filter((point) => point.kind === "seguimiento").length,
    }),
    [displayRegion.points],
  );

  const requestForecast = useCallback(async (lat: number, lon: number, label?: string) => {
    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    setSelectedPoint({
      lat,
      lon,
      label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    });
    setPanelOpen(true);
    const cachedForecast = forecastCacheRef.current.get(cacheKey);
    if (cachedForecast) {
      setForecast(cachedForecast);
      setForecastState("ready");
      return;
    }

    forecastRequestRef.current?.abort();
    const controller = new AbortController();
    forecastRequestRef.current = controller;
    setForecastState("loading");
    try {
      const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        hourly:
          "cloud_cover,sunshine_duration,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m",
        forecast_days: "2",
        timezone: "auto",
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Forecast unavailable");
      const data = await response.json();
      const now = Date.now() - 60 * 60 * 1000;
      const rows: ForecastHour[] = data.hourly.time
        .map((time: string, index: number) => ({
          time,
          cloud: data.hourly.cloud_cover[index] ?? 0,
          sunMinutes: Math.round((data.hourly.sunshine_duration[index] ?? 0) / 60),
          rainProbability: data.hourly.precipitation_probability[index] ?? 0,
          rain: data.hourly.precipitation[index] ?? 0,
          wind: Math.round(data.hourly.wind_speed_10m[index] ?? 0),
          windDirection: data.hourly.wind_direction_10m[index] ?? 0,
        }))
        .filter((row: ForecastHour) => new Date(row.time).getTime() >= now)
        .slice(0, 12);
      if (forecastCacheRef.current.size >= 12) {
        const oldestKey = forecastCacheRef.current.keys().next().value;
        if (oldestKey) forecastCacheRef.current.delete(oldestKey);
      }
      forecastCacheRef.current.set(cacheKey, rows);
      setForecast(rows);
      setForecastState("ready");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setForecast([]);
      setForecastState("error");
    } finally {
      if (forecastRequestRef.current === controller) forecastRequestRef.current = null;
    }
  }, []);

  const updateUserMarker = useCallback((latitude: number, longitude: number) => {
    if (!mapRef.current || !window.L) return;
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([latitude, longitude]);
      userMarkerRef.current.addTo(mapRef.current);
      return;
    }

    const icon = window.L.divIcon({
      className: "foco-map-icon",
      html: '<span class="user-marker" aria-hidden="true"><span></span></span>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    userMarkerRef.current = window.L.marker([latitude, longitude], {
      icon,
      pane: "foco-user-location",
      interactive: false,
      keyboard: false,
      zIndexOffset: 2000,
    })
      .bindPopup('<div class="foco-popup"><strong>Tu posición</strong><p>El mapa se ha centrado aquí.</p></div>')
      .addTo(mapRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    const refreshLiveData = async () => {
      const [statusResult, airResult, regionResult, snapshotsResult] = await Promise.allSettled([
        fetch("/api/status").then((response) => response.json()),
        fetch("/api/air").then((response) => response.json()),
        fetch("/api/region").then((response) => response.json()),
        fetch("/api/snapshots", { cache: "no-store" }).then((response) => response.json()),
      ]);
      if (!active) return;

      const status =
        statusResult.status === "fulfilled" ? (statusResult.value as LiveStatus) : liveStatus;
      const airStations =
        airResult.status === "fulfilled"
          ? ((airResult.value as { stations?: AirStation[] }).stations || [])
          : liveAirStations;
      const region =
        regionResult.status === "fulfilled" ? (regionResult.value as RegionData) : liveRegion;

      setLiveStatus(status);
      setLiveAirStations(airStations);
      setLiveRegion(region);
      if (snapshotsResult.status === "fulfilled") {
        setSnapshots((snapshotsResult.value as { snapshots?: SnapshotRecord[] }).snapshots || []);
      }
    };

    refreshLiveData();
    const interval = window.setInterval(refreshLiveData, 5 * 60 * 1000);
    window.addEventListener("online", refreshLiveData);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("online", refreshLiveData);
    };
    // Los valores de fallback se usan sólo si una fuente falla durante esta llamada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      forecastRequestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapNodeRef.current || mapRef.current) return;

        const map = L.map(mapNodeRef.current, {
          zoomControl: false,
          attributionControl: true,
          minZoom: 7,
          preferCanvas: true,
        }).setView([40.4168, -3.7038], 8);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          updateWhenIdle: true,
          keepBuffer: 2,
          attribution: "© OpenStreetMap",
        }).addTo(map);
        L.control.zoom({ position: "bottomright" }).addTo(map);
        canvasRendererRef.current = L.canvas({ padding: 0.3, tolerance: 8 });
        map.createPane("foco-user-location");
        map.getPane("foco-user-location").style.zIndex = "675";
        map.getPane("foco-user-location").style.pointerEvents = "none";

        situationLayerRef.current = L.layerGroup().addTo(map);
        fireAreaLayerRef.current = L.layerGroup().addTo(map);
        airLayerRef.current = L.layerGroup().addTo(map);

        heatLayerRef.current = L.tileLayer
          .wms("https://maps.effis.emergency.copernicus.eu/effis", {
            layers: "viirs.hs",
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            time: new Date().toISOString().slice(0, 10),
            opacity: 0.78,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            attribution: "Copernicus EFFIS / NASA VIIRS",
          })
          .addTo(map);

        burntLayerRef.current = L.tileLayer
          .wms("https://maps.effis.emergency.copernicus.eu/effis", {
            layers: "effis.nrt.ba.poly",
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            time: new Date().toISOString().slice(0, 10),
            opacity: 0.48,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            attribution: "Copernicus EFFIS / GWIS",
          })
          .addTo(map);

        smokeLayerRef.current = L.tileLayer(
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Aerosol_Type_Deep_Blue_Best_Estimate/default/${new Date().toISOString().slice(0, 10)}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
          {
            maxNativeZoom: 6,
            maxZoom: 18,
            opacity: 0.52,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            attribution: "NASA GIBS / VIIRS Deep Blue",
          },
        ).addTo(map);

        map.on("click", (event: any) => {
          requestForecast(event.latlng.lat, event.latlng.lng);
        });

        mapRef.current = map;
        setMapReady(true);

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude } = position.coords;
              map.setView([latitude, longitude], 10);
              updateUserMarker(latitude, longitude);
              setLocationState("Centrado en tu posición");
            },
            () => setLocationState("Ubicación no disponible · vista Zona Centro"),
            { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 },
          );
        } else {
          setLocationState("Geolocalización no compatible");
        }
      })
      .catch(() => setMapError("No se ha podido cargar el mapa base."));

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [requestForecast, updateUserMarker]);

  useEffect(() => {
    if (!mapReady || !situationLayerRef.current || !window.L) return;
    const L = window.L;
    situationLayerRef.current.clearLayers();

    displayRegion.points.forEach((point) => {
      if (!activeKinds[point.kind]) return;
      const meta = kindMeta[point.kind];
      const marker = L.marker([point.lat, point.lon], {
        icon: L.divIcon({
          className: "foco-map-icon",
          html: `<span class="status-marker status-marker--${point.kind}" aria-hidden="true"><b>${meta.icon}</b></span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      });
      marker
        .bindPopup(
          `<div class="foco-popup"><span class="popup-kicker" style="color:${meta.color}">${meta.label} · ${escapeHtml(point.province)}</span><strong>${escapeHtml(point.name)}</strong><p>${escapeHtml(point.detail)}</p><small>${escapeHtml(point.sourceLabel)} · ${escapeHtml(point.sourceUpdatedAt)}</small></div>`,
          { closeButton: false, offset: [0, -9] },
        )
        .on("click", () => requestForecast(point.lat, point.lon, point.name))
        .addTo(situationLayerRef.current);
    });
  }, [activeKinds, displayRegion.points, mapReady, requestForecast]);

  useEffect(() => {
    if (!mapReady || !fireAreaLayerRef.current || !window.L) return;
    const L = window.L;
    fireAreaLayerRef.current.clearLayers();
    displayRegion.fires.forEach((fire) => {
      const areaLabel = fire.areaHectares
        ? ` · ${fire.areaHectares.toLocaleString("es-ES")} ha`
        : "";
      const circle = L.circle([fire.lat, fire.lon], {
        renderer: canvasRendererRef.current,
        radius: fire.radiusKm * 1000,
        color: "#e74731",
        weight: 2,
        dashArray: "7 7",
        fillColor: "#ff6a4d",
        fillOpacity: 0.16,
      });
      circle
        .bindTooltip(`${escapeHtml(fire.name)}${areaLabel}`, {
          permanent: true,
          direction: "center",
          className: "fire-area-label",
        })
        .bindPopup(
          `<div class="foco-popup"><span class="popup-kicker" style="color:#e74731">${escapeHtml(fire.level)} · ${escapeHtml(fire.provinces)}</span><strong>${escapeHtml(fire.name)}</strong><p>${escapeHtml(fire.status)}. ${fire.areaHectares ? `Superficie comunicada: ${fire.areaHectares.toLocaleString("es-ES")} ha. ` : ""}${escapeHtml(fire.detail)}</p><small>Zona orientativa, no perímetro · ${escapeHtml(fire.sourceLabel)} · ${escapeHtml(fire.sourceUpdatedAt)}</small></div>`,
          { closeButton: false },
        )
        .on("click", () => requestForecast(fire.lat, fire.lon, fire.name))
        .addTo(fireAreaLayerRef.current);
    });
  }, [displayRegion.fires, mapReady, requestForecast]);

  useEffect(() => {
    if (!mapReady || !airLayerRef.current || !window.L) return;
    const L = window.L;
    airLayerRef.current.clearLayers();
    displayAirStations.forEach((station) => {
      L.circleMarker([station.lat, station.lon], {
        renderer: canvasRendererRef.current,
        radius: 10,
        color: "#ffffff",
        weight: 3,
        fillColor: station.color,
        fillOpacity: 0.88,
        bubblingMouseEvents: false,
      })
        .bindPopup(
          `<div class="foco-popup"><span class="popup-kicker" style="color:${escapeHtml(station.color)}">ICA ${station.index || "—"} · ${escapeHtml(station.label)}</span><strong>${escapeHtml(station.name)}</strong><p>Contaminante dominante: ${escapeHtml(station.pollutant || "sin dato")}${station.incomplete ? " · índice con datos parciales" : ""}</p><small>${escapeHtml(station.hour || "Sin lectura reciente")} · MITECO, dato provisional</small></div>`,
          { closeButton: false, offset: [0, -10] },
        )
        .on("click", () => requestForecast(station.lat, station.lon, station.name))
        .addTo(airLayerRef.current);
    });
  }, [displayAirStations, mapReady, requestForecast]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const toggleLayer = (layer: any, visible: boolean) => {
      if (!layer) return;
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    };
    toggleLayer(airLayerRef.current, airVisible);
    toggleLayer(heatLayerRef.current, heatVisible);
    toggleLayer(burntLayerRef.current, burntVisible);
    toggleLayer(smokeLayerRef.current, smokeVisible);
    toggleLayer(fireAreaLayerRef.current, fireAreasVisible);
    toggleLayer(userMarkerRef.current, userVisible);
  }, [airVisible, burntVisible, fireAreasVisible, heatVisible, mapReady, smokeVisible, userVisible]);

  useEffect(() => {
    const date = layerTime.slice(0, 10);
    heatLayerRef.current?.setParams({ time: date });
    burntLayerRef.current?.setParams({ time: date });
    smokeLayerRef.current?.setUrl(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Aerosol_Type_Deep_Blue_Best_Estimate/default/${date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    );
  }, [layerTime, mapReady]);

  const focusPoint = (point: SituationPoint) => {
    setMobileSidebarOpen(false);
    mapRef.current?.setView([point.lat, point.lon], 12);
    requestForecast(point.lat, point.lon, point.name);
  };

  const locateMe = () => {
    if (!navigator.geolocation || !mapRef.current) return;
    setUserVisible(true);
    setLocationState("Buscando tu posición…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        mapRef.current.setView([latitude, longitude], 12);
        updateUserMarker(latitude, longitude);
        setLocationState("Centrado en tu posición");
      },
      () => setLocationState("No se pudo acceder a tu posición"),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 },
    );
  };

  const fitFires = () => {
    if (!mapRef.current || !window.L) return;
    mapRef.current.fitBounds(
      window.L.latLngBounds(displayRegion.fires.map((fire) => [fire.lat, fire.lon])),
      { padding: [42, 42] },
    );
  };

  const goOlder = () => {
    if (!snapshots.length) return;
    setSnapshotIndex((current) =>
      current === null ? snapshots.length - 1 : Math.max(0, current - 1),
    );
  };

  const goNewer = () => {
    if (snapshotIndex === null) return;
    setSnapshotIndex(snapshotIndex >= snapshots.length - 1 ? null : snapshotIndex + 1);
  };

  const toggleKind = (kind: StatusKind) => {
    setActiveKinds((previous) => ({ ...previous, [kind]: !previous[kind] }));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="FOCO Zona Centro">
          <button
            className="mobile-menu-button"
            type="button"
            aria-label={mobileSidebarOpen ? "Cerrar panel de situación" : "Abrir panel de situación"}
            aria-expanded={mobileSidebarOpen}
            aria-controls="situation-sidebar"
            onClick={() => setMobileSidebarOpen((open) => !open)}
          >
            <i></i><i></i><i></i>
          </button>
          <span className="brand-mark"><i></i></span>
          <span>
            <b>FOCO</b>
            <small>CENTRO</small>
          </span>
        </div>

        <div className={`top-status ${isLive ? "is-live" : "is-history"}`}>
          <div className="status-reading" aria-live="polite">
            <span className="live-dot"></span>
            <span>
              <b>{isLive ? "Seguimiento activo" : "Snapshot"}</b>
              <small>{isLive ? "Fuentes oficiales + satélite" : formatSnapshotTime(selectedSnapshot?.capturedAt || "")}</small>
            </span>
          </div>
          <nav className="snapshot-nav" aria-label="Navegar por los snapshots horarios">
            <button onClick={goOlder} disabled={!snapshots.length || snapshotIndex === 0} title="Snapshot anterior" aria-label="Snapshot anterior">&lt;</button>
            <button onClick={goNewer} disabled={isLive} title="Snapshot siguiente" aria-label="Snapshot siguiente">&gt;</button>
            <button onClick={() => setSnapshotIndex(null)} disabled={isLive} title="Volver al mapa en vivo" aria-label="Volver al mapa en vivo">&gt;&gt;</button>
          </nav>
        </div>

        <a className="emergency-button" href="tel:112" aria-label="Llamar a emergencias 112">
          <span>Emergencias</span>
          <b>112</b>
        </a>
      </header>

      <section className="workspace">
        <aside
          id="situation-sidebar"
          className={`sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`}
        >
          <div className="sidebar-scroll">
            <div className="mobile-sidebar-heading">
              <b>Situación y fuentes</b>
              <button type="button" onClick={() => setMobileSidebarOpen(false)} aria-label="Cerrar panel">×</button>
            </div>
            <div className="eyebrow-row">
              <span className="eyebrow">{isLive ? "SITUACIÓN ACTUAL" : "VISTA HISTÓRICA"}</span>
              <span className="refresh-time">
                {isLive ? `Parte: ${displayStatus.lastUpdated}` : formatSnapshotTime(selectedSnapshot?.capturedAt || "")}
              </span>
            </div>

            <section className="alert-card">
              <div className="alert-level"><span>3</span></div>
              <div>
                <span className="alert-kicker">EMERGENCIA DE INTERÉS NACIONAL</span>
                <h1>Incendios forestales · Zona Centro</h1>
                <p>Madrid, Ávila, Toledo y Guadalajara en una única vista operacional y satelital.</p>
              </div>
              <a href={DSN_URL} target="_blank" rel="noreferrer">Parte nacional ↗</a>
            </section>

            <div className="metric-grid" aria-label="Resumen de afectaciones">
              {(["evacuado", "confinado", "acogida", "seguimiento"] as StatusKind[]).map((kind) => (
                <button
                  key={kind}
                  className={activeList === kind ? "active" : ""}
                  onClick={() => setActiveList(kind)}
                >
                  <strong>{counts[kind]}</strong>
                  <span>{kind === "evacuado" ? "evacuación" : kind === "confinado" ? "confinado" : kind === "acogida" ? "acogida" : "seguimiento"}</span>
                </button>
              ))}
            </div>
            <p className="roads-summary">{displayStatus.roads.length} carreteras señaladas en el parte de Madrid</p>

            <section className="location-section">
              <div className="section-title">
                <h2>{kindMeta[activeList].plural}</h2>
                <button
                  className={`layer-switch layer-switch--${activeList}`}
                  aria-pressed={activeKinds[activeList]}
                  onClick={() => toggleKind(activeList)}
                >
                  {activeKinds[activeList] ? "Visible" : "Oculto"}
                </button>
              </div>
              <div className="location-list">
                {visiblePoints.map((point) => (
                  <button key={point.id} onClick={() => focusPoint(point)}>
                    <span className={`list-symbol list-symbol--${point.kind}`}>{kindMeta[point.kind].icon}</span>
                    <span>
                      <b>{point.name}</b>
                      <small>{point.province} · {point.sourceUpdatedAt}</small>
                    </span>
                    <i>⌖</i>
                  </button>
                ))}
                {!visiblePoints.length && <p className="empty-list">No hay puntos de este tipo en la vista seleccionada.</p>}
              </div>
            </section>

            <section className="sources-card">
              <div>
                <span className="eyebrow">FUENTES EN DIRECTO</span>
                <span className="verified">Oficiales</span>
              </div>
              <a href="https://x.com/112cmadrid" target="_blank" rel="noreferrer">
                <span className="source-icon">X</span>
                <span><b>@112cmadrid</b><small>Avisos operativos y ES-Alert</small></span>
                <i>↗</i>
              </a>
              <a href={DSN_URL} target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--es">ES</span>
                <span><b>Seguridad Nacional</b><small>Situación consolidada interregional</small></span>
                <i>↗</i>
              </a>
              <a href={CLM_URL} target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--clm">CLM</span>
                <span><b>Castilla-La Mancha</b><small>La Mierla y Sierra Norte</small></span>
                <i>↗</i>
              </a>
              <a href={CEMS_LA_MIERLA_URL} target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--eu">EU</span>
                <span><b>Copernicus EMSR898</b><small>Cartografía satelital de La Mierla</small></span>
                <i>↗</i>
              </a>
              <a href={OFFICIAL_URL} target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--cm">CM</span>
                <span><b>Comunidad de Madrid</b><small>Parte autonómico de la emergencia</small></span>
                <i>↗</i>
              </a>
              <a href={MITECO_ICA_URL} target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--air">ICA</span>
                <span><b>MITECO · calidad del aire</b><small>Red nacional, actualización horaria</small></span>
                <i>↗</i>
              </a>
              <a href="https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/" target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--eu">EU</span>
                <span><b>Copernicus EFFIS</b><small>Calor y superficie detectada por satélite</small></span>
                <i>↗</i>
              </a>
              <a href="https://gibs.earthdata.nasa.gov/" target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--nasa">NASA</span>
                <span><b>NASA GIBS · VIIRS</b><small>Tipo de aerosol: humo rojo, humo alto violeta</small></span>
                <i>↗</i>
              </a>
            </section>

            <p className="safety-note">
              Visor informativo. Los círculos rojos son zonas orientativas, no perímetros. Ante una emergencia sigue ES-Alert, las instrucciones oficiales y llama al 112.
            </p>
          </div>
        </aside>
        {mobileSidebarOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Cerrar panel de situación"
          />
        )}

        <section className="map-pane" aria-label="Mapa de incendios de la Zona Centro">
          <div ref={mapNodeRef} className="map-canvas" />
          {!mapReady && !mapError && <div className="map-loading"><span></span><b>Preparando el mapa en directo…</b></div>}
          {mapError && <div className="map-error"><b>{mapError}</b><p>Comprueba tu conexión y vuelve a cargar.</p></div>}

          <div className="map-actions">
            <button onClick={locateMe} title="Centrar en mi posición" aria-label="Centrar en mi posición">◎</button>
            <button onClick={fitFires}>Ver incendios</button>
          </div>

          <div className="position-pill">
            <span>◎</span>
            {locationState}
          </div>

          <section className={`map-legend ${panelOpen ? "forecast-open" : ""}`} aria-label="Leyenda y visibilidad de capas">
            <div className="legend-heading">
              <b>LEYENDA</b>
              <small>Pulsa para ocultar o mostrar</small>
            </div>
            <div className="legend-items">
              <button aria-pressed={activeKinds.evacuado} onClick={() => toggleKind("evacuado")}>
                <i className="legend-dot legend-dot--evacuado"></i><span>Evacuación</span><em>{activeKinds.evacuado ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={activeKinds.confinado} onClick={() => toggleKind("confinado")}>
                <i className="legend-dot legend-dot--confinado"></i><span>Confinamiento</span><em>{activeKinds.confinado ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={activeKinds.acogida} onClick={() => toggleKind("acogida")}>
                <i className="legend-dot legend-dot--acogida"></i><span>Acogida</span><em>{activeKinds.acogida ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={activeKinds.seguimiento} onClick={() => toggleKind("seguimiento")}>
                <i className="legend-dot legend-dot--seguimiento"></i><span>Seguimiento</span><em>{activeKinds.seguimiento ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={fireAreasVisible} onClick={() => setFireAreasVisible(!fireAreasVisible)}>
                <i className="legend-area"></i><span>Zona incendio</span><em>{fireAreasVisible ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={heatVisible} onClick={() => setHeatVisible(!heatVisible)}>
                <i className="legend-hotspot"></i><span>Calor VIIRS</span><em>{heatVisible ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={burntVisible} onClick={() => setBurntVisible(!burntVisible)}>
                <i className="legend-burnt"></i><span>Área EFFIS</span><em>{burntVisible ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={smokeVisible} onClick={() => setSmokeVisible(!smokeVisible)}>
                <i className="legend-smoke"></i><span>Humo VIIRS</span><em>{smokeVisible ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={airVisible} onClick={() => setAirVisible(!airVisible)}>
                <i className="legend-air"></i><span>Sensor de aire</span><em>{airVisible ? "ON" : "OFF"}</em>
              </button>
              <button aria-pressed={userVisible} onClick={() => setUserVisible(!userVisible)}>
                <i className="legend-user"></i><span>Tu posición</span><em>{userVisible ? "ON" : "OFF"}</em>
              </button>
            </div>
          </section>

          {!panelOpen && (
            <button className="forecast-hint" onClick={() => requestForecast(40.4168, -3.7038, "Madrid")}>
              <span>↘</span>
              <b>Pulsa cualquier punto del mapa</b>
              <small>Previsión horaria de sol, viento y lluvia</small>
            </button>
          )}

          <section className={`forecast-panel ${panelOpen ? "open" : ""}`} aria-live="polite">
            <div className="forecast-heading">
              <div>
                <div className="forecast-title-row">
                  <span className="eyebrow">PREVISIÓN DEL PUNTO</span>
                  {selectedPoint && (
                    <small>{selectedPoint.lat.toFixed(4)}, {selectedPoint.lon.toFixed(4)} · Open‑Meteo</small>
                  )}
                </div>
                {selectedPoint &&
                  selectedPoint.label !== `${selectedPoint.lat.toFixed(4)}, ${selectedPoint.lon.toFixed(4)}` && (
                    <h2>{selectedPoint.label}</h2>
                  )}
              </div>
              <button onClick={() => setPanelOpen(false)} aria-label="Cerrar previsión">×</button>
            </div>

            <div className="hourly-strip">
              {forecastState === "loading" &&
                Array.from({ length: 7 }).map((_, index) => <div className="hour-card hour-card--loading" key={index}></div>)}
              {forecastState === "error" && (
                <div className="forecast-message">No se pudo obtener la previsión. Pulsa otro punto para reintentarlo.</div>
              )}
              {forecastState === "ready" &&
                forecast.map((hour, index) => {
                  const date = new Date(hour.time);
                  const dayKey = date.toLocaleDateString("es-ES");
                  const previousDate = index > 0 ? new Date(forecast[index - 1].time) : null;
                  const startsDay =
                    !previousDate || previousDate.toLocaleDateString("es-ES") !== dayKey;
                  return (
                    <Fragment key={hour.time}>
                      {startsDay && (
                        <div className="forecast-day-card">
                          <div className="hour-top">
                            <b>{date.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "")} {date.getDate()}</b>
                          </div>
                          <div className="weather-metrics">
                            <div className="weather-metric"><small>Sol</small></div>
                            <div className="weather-metric"><small>Viento</small></div>
                            <div className="weather-metric"><small>Lluvia</small></div>
                          </div>
                        </div>
                      )}
                      <article className={`hour-card ${index === 0 ? "now" : ""}`}>
                        <div className="hour-top">
                          <b>{index === 0 ? "Ahora" : date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</b>
                        </div>
                        <div className="weather-metrics">
                          <div className="weather-metric sun">
                            <strong>{describeSun(hour)}</strong>
                          </div>
                          <div className="weather-metric wind">
                            <strong>{compass(hour.windDirection)} · {hour.wind} km/h</strong>
                          </div>
                          <div className="weather-metric rain">
                            <strong>{hour.rainProbability}% <em>· {hour.rain.toFixed(1)} mm</em></strong>
                          </div>
                        </div>
                      </article>
                    </Fragment>
                  );
                })}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
