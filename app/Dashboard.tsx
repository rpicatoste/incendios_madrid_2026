"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import {
  defaultRegionData,
  type RegionData,
  type SituationPoint,
  type StatusKind,
} from "../lib/region-data";
import type {
  CopernicusFeatureProperties,
  CopernicusFireMap,
} from "../lib/copernicus-fire-map";
import type {
  EffisAreaFeatureProperties,
  EffisAreaMap,
} from "../lib/effis-area-status";

declare global {
  interface Window {
    L?: typeof import("leaflet");
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
  observedAt?: string | null;
  delayed?: boolean;
  carriedForward?: boolean;
  hour: string | null;
};

type ForecastHour = {
  time: string;
  temperature: number;
  cloud: number;
  sunMinutes: number;
  weatherCode: number;
  isDay: boolean;
  rainProbability: number;
  rain: number;
  wind: number;
  windDirection: number;
};

type ForecastCacheEntry = {
  expiresAt: number;
  rows: ForecastHour[];
  windDirection: number;
  windSpeed: number;
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
  satellite?: {
    schemaVersion?: 2 | 3 | 4;
    capturedAt: string;
    bounds: [[number, number], [number, number]];
    layers: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus" | "effis", true>>;
    layerCapturedAt?: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus" | "effis", string>>;
    layerCheckedAt?: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus" | "effis", string>>;
    layerSourceDate?: Partial<Record<"burnt" | "heat" | "smoke", string>>;
    rasterDimensions?: Partial<
      Record<"burnt" | "heat" | "smoke", { width: number; height: number }>
    >;
    staleLayers?: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus" | "effis", true>>;
    errors?: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus" | "effis", string>>;
    effis?: {
      schemaVersion: 1;
      checkedAt: string;
      readAt?: string;
      periodDays: number;
      recentAreasInSpain: number;
      recentAreasInView: number;
      latestUpdateSpain?: string;
      latestUpdateInView?: string;
      stale?: true;
      error?: string;
    };
    copernicus?: {
      areaProduct?: string;
      areaObservedAt?: string;
      frontProduct?: string;
      frontObservedAt?: string;
      readAt?: string;
    };
  };
};

type SnapshotRecord = {
  id: string;
  capturedAt: string;
  data: SnapshotData;
};

type SidebarTab = "news" | "evacuations" | "sources";

type OfficialNews = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  url: string;
  source: string;
};

type SourceRead = {
  url: string;
  readAt: string;
  ok: boolean;
};

type OfficialIncident = {
  id: string;
  name: string;
  province: string;
  status: string;
  detail: string;
  updatedAt: string;
  updatedLabel?: string;
  url: string;
  source: string;
};

const OFFICIAL_URL =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";
const DSN_URL = "https://www.dsn.gob.es/gl/node/32742";
const CLM_URL =
  "https://www.castillalamancha.es/actualidad/notasdeprensa/castilla-la-mancha-moviliza-un-amplio-operativo-para-hacer-frente-los-incendios-registrados-en-la";
const CEMS_CENTRAL_URL =
  "https://mapping.emergency.copernicus.eu/activations/EMSR900/";
const MITECO_ICA_URL = "https://ica.miteco.es/datos/ica-ultima-hora.csv";
const JCYL_FIRE_URL =
  "https://analisis.datosabiertos.jcyl.es/explore/dataset/incendios-forestales/";
const FIDIAS_URL =
  "https://fidias.castillalamancha.es/consulta/forms/fidif001.php?auth=ANONIMO";

const REFRESH_INTERVALS = {
  status: 2 * 60 * 1000,
  region: 5 * 60 * 1000,
  satellite: 5 * 60 * 1000,
  news: 5 * 60 * 1000,
  air: 15 * 60 * 1000,
  forecast: 15 * 60 * 1000,
} as const;

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

const skySymbol = (hour: ForecastHour) => {
  if (!hour.isDay && hour.weatherCode <= 2) return { symbol: "☾", label: "Noche despejada" };
  if (hour.weatherCode === 0) return { symbol: "☀️", label: "Despejado" };
  if (hour.weatherCode === 1) return { symbol: "🌤", label: "Principalmente despejado" };
  if (hour.weatherCode === 2) return { symbol: "⛅", label: "Con claros" };
  if (hour.weatherCode === 3) return { symbol: "☁︎", label: "Cubierto" };
  if ([45, 48].includes(hour.weatherCode)) return { symbol: "🌫", label: "Niebla" };
  if ([51, 53, 55, 56, 57].includes(hour.weatherCode)) return { symbol: "🌦", label: "Llovizna" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(hour.weatherCode)) {
    return { symbol: "🌧", label: "Lluvia" };
  }
  if ([71, 73, 75, 77, 85, 86].includes(hour.weatherCode)) return { symbol: "🌨", label: "Nieve" };
  if ([95, 96, 99].includes(hour.weatherCode)) return { symbol: "⛈", label: "Tormenta" };
  if (hour.sunMinutes >= 45) return { symbol: "☀️", label: "Despejado" };
  if (hour.sunMinutes >= 15) return { symbol: "⛅", label: "Con claros" };
  return {
    symbol: hour.isDay ? "☁︎" : "☾",
    label: hour.isDay && hour.cloud >= 70 ? "Cubierto" : hour.isDay ? "Nublado" : "Noche",
  };
};

const formatSnapshotTime = (value: string) =>
  new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatSourceDate = (value: string) =>
  new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

const formatReadTime = (value?: string) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Sin lectura todavía";
  return `Leída ${formatSnapshotTime(value)}`;
};

export default function Dashboard() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const situationLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const fireAreaLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const airLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const heatLayerRef = useRef<Leaflet.TileLayer.WMS | null>(null);
  const smokeLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const historicalHeatLayerRef = useRef<Leaflet.ImageOverlay | null>(null);
  const historicalBurntLayerRef = useRef<Leaflet.ImageOverlay | null>(null);
  const historicalSmokeLayerRef = useRef<Leaflet.ImageOverlay | null>(null);
  const copernicusBurntLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const copernicusFrontLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const effisAreaLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const userMarkerRef = useRef<Leaflet.Marker | null>(null);
  const forecastMarkerRef = useRef<Leaflet.Marker | null>(null);
  const windCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRendererRef = useRef<Leaflet.Renderer | null>(null);
  const forecastRequestRef = useRef<AbortController | null>(null);
  const forecastCacheRef = useRef<Map<string, ForecastCacheEntry>>(new Map());

  const [liveStatus, setLiveStatus] = useState<LiveStatus>(fallbackStatus);
  const [liveAirStations, setLiveAirStations] = useState<AirStation[]>([]);
  const [liveRegion, setLiveRegion] = useState<RegionData>(defaultRegionData);
  const [liveSatellite, setLiveSatellite] = useState<SnapshotData["satellite"]>(undefined);
  const [cachedFireMap, setCachedFireMap] = useState<CopernicusFireMap | null>(null);
  const [cachedEffisMap, setCachedEffisMap] = useState<EffisAreaMap | null>(null);
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
  const [frontVisible, setFrontVisible] = useState(true);
  const [windParticlesVisible, setWindParticlesVisible] = useState(true);
  const [smokeVisible, setSmokeVisible] = useState(false);
  const [fireAreasVisible, setFireAreasVisible] = useState(true);
  const [userVisible, setUserVisible] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [forecastState, setForecastState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [forecastWindDirection, setForecastWindDirection] = useState<number | null>(null);
  const [forecastWindSpeed, setForecastWindSpeed] = useState<number | null>(null);
  const [ambientWind, setAmbientWind] = useState<{ direction: number; speed: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeList, setActiveList] = useState<StatusKind>("evacuado");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("news");
  const [officialNews, setOfficialNews] = useState<OfficialNews[]>([]);
  const [officialIncidents, setOfficialIncidents] = useState<OfficialIncident[]>([]);
  const [sourceReads, setSourceReads] = useState<Record<string, SourceRead>>({});
  const [newsReadAt, setNewsReadAt] = useState("");
  const [airSourceReadAt, setAirSourceReadAt] = useState("");
  const [regionReadAt, setRegionReadAt] = useState("");
  const [weatherReadAt, setWeatherReadAt] = useState("");
  const [baseMapReadAt, setBaseMapReadAt] = useState("");

  const selectedSnapshot = snapshotIndex === null ? null : snapshots[snapshotIndex] || null;
  const displayStatus = selectedSnapshot?.data.status || liveStatus;
  const displayAirStations = selectedSnapshot?.data.airStations || liveAirStations;
  const currentAirStationCount = displayAirStations.filter(
    (station) => typeof station.index === "number" && station.index > 0 && !station.carriedForward,
  ).length;
  const recoveredAirStationCount = displayAirStations.filter(
    (station) => station.carriedForward,
  ).length;
  const displayRegion = selectedSnapshot?.data.region || liveRegion;
  const displayFireMap = cachedFireMap;
  const layerTime = selectedSnapshot?.data.layerTime || new Date().toISOString();
  const isLive = selectedSnapshot === null;
  const displaySatellite = selectedSnapshot?.data.satellite || (isLive ? liveSatellite : undefined);
  const satelliteStorageId = selectedSnapshot?.data.satellite
    ? selectedSnapshot.id
    : isLive && liveSatellite
      ? "live"
      : null;
  const rawWindDirection = forecastWindDirection;
  const currentWindDirection =
    typeof rawWindDirection === "number" && Number.isFinite(rawWindDirection)
      ? Math.round(((rawWindDirection % 360) + 360) % 360)
      : null;
  const currentWindSpeed =
    typeof forecastWindSpeed === "number" && Number.isFinite(forecastWindSpeed)
      ? Math.max(0, forecastWindSpeed)
      : null;
  const particleWindDirection = currentWindDirection ?? ambientWind?.direction ?? null;
  const particleWindSpeed = currentWindSpeed ?? ambientWind?.speed ?? null;

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

  useEffect(() => {
    const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (navigator.doNotTrack === "1" || privacyNavigator.globalPrivacyControl) return;
    const sessionKey = "foco-visitor-recorded-v1";
    try {
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, "1");
      void fetch("/api/analytics/visit", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      })
        .then((response) => {
          if (!response.ok) sessionStorage.removeItem(sessionKey);
        })
        .catch(() => {
          sessionStorage.removeItem(sessionKey);
        });
    } catch {
      // La aplicación sigue funcionando si el navegador bloquea el almacenamiento de sesión.
    }
  }, []);

  const requestForecast = useCallback(async (
    lat: number,
    lon: number,
    label?: string,
    force = false,
  ) => {
    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (!force) {
      setSelectedPoint({
        lat,
        lon,
        label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      });
      setPanelOpen(true);
    }
    forecastRequestRef.current?.abort();
    const cachedForecast = forecastCacheRef.current.get(cacheKey);
    if (!force && cachedForecast && cachedForecast.expiresAt > Date.now()) {
      setForecast(cachedForecast.rows);
      setForecastWindDirection(cachedForecast.windDirection);
      setForecastWindSpeed(cachedForecast.windSpeed);
      setForecastState("ready");
      return;
    }
    if (cachedForecast) forecastCacheRef.current.delete(cacheKey);

    const controller = new AbortController();
    forecastRequestRef.current = controller;
    if (!force) {
      setForecast([]);
      setForecastWindDirection(null);
      setForecastWindSpeed(null);
      setForecastState("loading");
    }
    try {
      const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: "wind_direction_10m,wind_speed_10m",
        hourly:
          "temperature_2m,cloud_cover,sunshine_duration,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m",
        forecast_hours: "12",
        timezone: "auto",
      });
      const response = await fetch("https://api.open-meteo.com/v1/forecast?" + params.toString(), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Forecast unavailable");
      const data = await response.json();
      const rows: ForecastHour[] = data.hourly.time
        .map((time: string, index: number) => ({
          time,
          temperature: Math.round((data.hourly.temperature_2m[index] ?? 0) * 10) / 10,
          cloud: data.hourly.cloud_cover[index] ?? 0,
          sunMinutes: Math.round((data.hourly.sunshine_duration[index] ?? 0) / 60),
          weatherCode: data.hourly.weather_code[index] ?? 0,
          isDay: Boolean(data.hourly.is_day[index]),
          rainProbability: data.hourly.precipitation_probability[index] ?? 0,
          rain: data.hourly.precipitation[index] ?? 0,
          wind: Math.round(data.hourly.wind_speed_10m[index] ?? 0),
          windDirection: data.hourly.wind_direction_10m[index] ?? 0,
        }))
        .slice(0, 12);
      const currentDirection = Number(data.current?.wind_direction_10m);
      const windDirection = Number.isFinite(currentDirection)
        ? currentDirection
        : rows[0]?.windDirection;
      const currentSpeed = Number(data.current?.wind_speed_10m);
      const windSpeed = Number.isFinite(currentSpeed) ? currentSpeed : rows[0]?.wind;
      if (
        !rows.length ||
        typeof windDirection !== "number" ||
        !Number.isFinite(windDirection) ||
        typeof windSpeed !== "number" ||
        !Number.isFinite(windSpeed)
      ) {
        throw new Error("Forecast returned no current hours or wind");
      }
      if (forecastCacheRef.current.size >= 12) {
        const oldestKey = forecastCacheRef.current.keys().next().value;
        if (oldestKey) forecastCacheRef.current.delete(oldestKey);
      }
      forecastCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + REFRESH_INTERVALS.forecast,
        rows,
        windDirection,
        windSpeed,
      });
      setForecast(rows);
      setForecastWindDirection(windDirection);
      setForecastWindSpeed(windSpeed);
      setForecastState("ready");
      setWeatherReadAt(new Date().toISOString());
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      if (!force) {
        setForecast([]);
        setForecastWindDirection(null);
        setForecastWindSpeed(null);
        setForecastState("error");
      }
    } finally {
      if (forecastRequestRef.current === controller) forecastRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const refreshAmbientWind = async () => {
      controller?.abort();
      controller = new AbortController();
      const params = new URLSearchParams({
        latitude: "40.4168",
        longitude: "-3.7038",
        current: "wind_direction_10m,wind_speed_10m",
        timezone: "auto",
      });
      try {
        const response = await fetch(
          "https://api.open-meteo.com/v1/forecast?" + params.toString(),
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return;
        const data = await response.json();
        const direction = Number(data.current?.wind_direction_10m);
        const speed = Number(data.current?.wind_speed_10m);
        if (active && Number.isFinite(direction) && Number.isFinite(speed)) {
          setAmbientWind({ direction, speed });
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") return;
      }
    };
    void refreshAmbientWind();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshAmbientWind();
    }, 30 * 60 * 1000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!panelOpen || !selectedPoint) return;
    const interval = window.setInterval(() => {
      void requestForecast(
        selectedPoint.lat,
        selectedPoint.lon,
        selectedPoint.label,
        true,
      );
    }, REFRESH_INTERVALS.forecast);
    return () => window.clearInterval(interval);
  }, [panelOpen, requestForecast, selectedPoint]);

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

    const readJson = async (path: string) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(path, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("No se pudo actualizar una fuente interna");
        return response.json();
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const refreshStatus = async () => {
      try {
        const status = (await readJson("/api/status")) as LiveStatus;
        if (active) setLiveStatus(status);
      } catch {}
    };

    const refreshAir = async () => {
      try {
        const payload = (await readJson("/api/air")) as {
          stations?: AirStation[];
          fetchedAt?: string;
        };
        if (!active) return;
        if (payload.stations?.length) setLiveAirStations(payload.stations);
        setAirSourceReadAt(payload.fetchedAt || "");
      } catch {}
    };

    const refreshRegion = async () => {
      try {
        const region = (await readJson("/api/region")) as RegionData & { fetchedAt?: string };
        if (!active) return;
        setLiveRegion(region);
        setRegionReadAt(region.fetchedAt || "");
      } catch {}
    };

    const refreshSatellite = async () => {
      const [manifestResult, snapshotsResult] = await Promise.allSettled([
        readJson("/api/satellite?hour=live&layer=manifest"),
        readJson("/api/snapshots"),
      ]);
      if (!active) return;
      if (manifestResult.status === "fulfilled") setLiveSatellite(manifestResult.value);
      if (snapshotsResult.status === "fulfilled") {
        setSnapshots((snapshotsResult.value as { snapshots?: SnapshotRecord[] }).snapshots || []);
      }
    };

    const refreshNews = async () => {
      try {
        const payload = (await readJson("/api/news")) as {
          items?: OfficialNews[];
          incidents?: OfficialIncident[];
          readAt?: string;
          sourceReads?: Record<string, SourceRead>;
        };
        if (!active) return;
        setOfficialNews(payload.items || []);
        setOfficialIncidents(payload.incidents || []);
        setSourceReads(payload.sourceReads || {});
        setNewsReadAt(payload.readAt || "");
      } catch {}
    };

    const refreshAll = () => {
      void Promise.allSettled([
        refreshStatus(),
        refreshAir(),
        refreshRegion(),
        refreshSatellite(),
        refreshNews(),
      ]);
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshAll();
    };

    const scheduleRefresh = (refresh: () => Promise<void>, interval: number) =>
      window.setInterval(() => {
        if (!document.hidden) void refresh();
      }, interval);

    refreshWhenVisible();
    const intervals = [
      scheduleRefresh(refreshStatus, REFRESH_INTERVALS.status),
      scheduleRefresh(refreshRegion, REFRESH_INTERVALS.region),
      scheduleRefresh(refreshSatellite, REFRESH_INTERVALS.satellite),
      scheduleRefresh(refreshNews, REFRESH_INTERVALS.news),
      scheduleRefresh(refreshAir, REFRESH_INTERVALS.air),
    ];
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      intervals.forEach((interval) => window.clearInterval(interval));
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
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
        })
          .once("load", () => setBaseMapReadAt(new Date().toISOString()))
          .addTo(map);
        L.control.zoom({ position: "bottomright" }).addTo(map);
        canvasRendererRef.current = L.canvas({ padding: 0.3, tolerance: 8 });
        map.createPane("foco-user-location");
        map.getPane("foco-user-location").style.zIndex = "675";
        map.getPane("foco-user-location").style.pointerEvents = "none";
        map.createPane("foco-forecast-point");
        map.getPane("foco-forecast-point").style.zIndex = "680";
        map.getPane("foco-forecast-point").style.pointerEvents = "none";

        situationLayerRef.current = L.layerGroup().addTo(map);
        fireAreaLayerRef.current = L.layerGroup().addTo(map);
        effisAreaLayerRef.current = L.layerGroup().addTo(map);
        copernicusBurntLayerRef.current = L.layerGroup().addTo(map);
        copernicusFrontLayerRef.current = L.layerGroup().addTo(map);
        airLayerRef.current = L.layerGroup().addTo(map);

        heatLayerRef.current = L.tileLayer
          .wms("https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi", {
            layers: [
              "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
              "VIIRS_SNPP_Thermal_Anomalies_375m_All",
            ].join(","),
            styles: "size10,size10",
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            time: new Date().toISOString().slice(0, 10),
            opacity: 0.78,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            attribution: "NASA GIBS / VIIRS",
          });

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
        );

        map.on("click", (event: Leaflet.LeafletMouseEvent) => {
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
    if (!mapReady || !mapRef.current || !window.L || !selectedPoint) return;
    const latLng: [number, number] = [selectedPoint.lat, selectedPoint.lon];
    const pendingClass = currentWindDirection === null ? " is-pending" : "";
    const icon = window.L.divIcon({
      className: "foco-map-icon",
      html:
        '<span class="forecast-point-symbol forecast-point-symbol--map' +
        pendingClass +
        '" aria-hidden="true"><i class="forecast-wind-arrow" style="transform:rotate(' +
        (currentWindDirection ?? 0) +
        'deg)">↑</i></span>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    if (forecastMarkerRef.current) {
      forecastMarkerRef.current
        .setLatLng(latLng)
        .setIcon(icon)
        .addTo(mapRef.current);
      return;
    }
    forecastMarkerRef.current = window.L.marker(latLng, {
      icon,
      pane: "foco-forecast-point",
      interactive: false,
      keyboard: false,
      zIndexOffset: 2200,
    }).addTo(mapRef.current);
  }, [currentWindDirection, mapReady, selectedPoint]);

  useEffect(() => {
    const canvas = windCanvasRef.current;
    if (
      !canvas ||
      !mapReady ||
      !windParticlesVisible ||
      particleWindDirection === null ||
      particleWindSpeed === null
    ) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    type WindParticle = {
      x: number;
      y: number;
      opacity: number;
      scale: number;
    };
    let width = 0;
    let height = 0;
    let particles: WindParticle[] = [];
    let frame = 0;
    let previousFrame = 0;
    let hidden = document.hidden;
    const bearing = ((particleWindDirection + 180) * Math.PI) / 180;
    const directionX = Math.sin(bearing);
    const directionY = -Math.cos(bearing);
    const velocity = Math.min(42, 9 + particleWindSpeed * 0.72);
    const trail = Math.min(18, 6 + particleWindSpeed * 0.26);

    const makeParticle = (): WindParticle => ({
      x: Math.random() * Math.max(width, 1),
      y: Math.random() * Math.max(height, 1),
      opacity: 0.08 + Math.random() * 0.13,
      scale: 0.65 + Math.random() * 0.7,
    });

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const count = width < 700 ? 12 : 24;
      particles = Array.from({ length: count }, makeParticle);
    };

    const draw = (timestamp: number) => {
      frame = window.requestAnimationFrame(draw);
      if (hidden || timestamp - previousFrame < 50) return;
      const elapsed = previousFrame
        ? Math.min((timestamp - previousFrame) / 1000, 0.1)
        : 0;
      previousFrame = timestamp;
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      particles.forEach((particle) => {
        particle.x += directionX * velocity * particle.scale * elapsed;
        particle.y += directionY * velocity * particle.scale * elapsed;
        const margin = trail + 3;
        if (particle.x < -margin) particle.x = width + margin;
        if (particle.x > width + margin) particle.x = -margin;
        if (particle.y < -margin) particle.y = height + margin;
        if (particle.y > height + margin) particle.y = -margin;
        context.beginPath();
        context.moveTo(
          particle.x - directionX * trail * particle.scale,
          particle.y - directionY * trail * particle.scale,
        );
        context.lineTo(particle.x, particle.y);
        context.lineWidth = 0.8 + particle.scale * 0.45;
        context.strokeStyle = `rgba(24, 111, 153, ${particle.opacity})`;
        context.stroke();
      });
    };

    const visibilityChanged = () => {
      hidden = document.hidden;
      previousFrame = 0;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", visibilityChanged);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      context.clearRect(0, 0, width, height);
    };
  }, [mapReady, particleWindDirection, particleWindSpeed, windParticlesVisible]);

  useEffect(() => {
    let active = true;
    if (!displaySatellite?.layers.copernicus || !satelliteStorageId) {
      const clearCachedMap = window.setTimeout(() => {
        if (active) setCachedFireMap(null);
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(clearCachedMap);
      };
    }
    fetch(
      `/api/satellite?hour=${encodeURIComponent(satelliteStorageId)}&layer=copernicus&v=${encodeURIComponent(displaySatellite.capturedAt)}`,
      { cache: satelliteStorageId === "live" ? "no-store" : "force-cache" },
    )
      .then((response) => {
        if (!response.ok) throw new Error("Copernicus histórico no disponible");
        return response.json() as Promise<CopernicusFireMap>;
      })
      .then((data) => {
        if (active) setCachedFireMap(data);
      })
      .catch(() => {
        if (active) setCachedFireMap(null);
      });
    return () => {
      active = false;
    };
  }, [displaySatellite, satelliteStorageId]);

  useEffect(() => {
    let active = true;
    if (!displaySatellite?.layers.effis || !satelliteStorageId) {
      const clearEffisMap = window.setTimeout(() => {
        if (active) setCachedEffisMap(null);
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(clearEffisMap);
      };
    }
    fetch(
      `/api/satellite?hour=${encodeURIComponent(satelliteStorageId)}&layer=effis&v=${encodeURIComponent(displaySatellite.capturedAt)}`,
      { cache: satelliteStorageId === "live" ? "no-store" : "force-cache" },
    )
      .then((response) => {
        if (!response.ok) throw new Error("EFFIS histórico no disponible");
        return response.json() as Promise<EffisAreaMap>;
      })
      .then((data) => {
        if (active) setCachedEffisMap(data);
      })
      .catch(() => {
        if (active) setCachedEffisMap(null);
      });
    return () => {
      active = false;
    };
  }, [displaySatellite, satelliteStorageId]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    const map = mapRef.current;
    [
      historicalBurntLayerRef,
      historicalHeatLayerRef,
      historicalSmokeLayerRef,
    ].forEach((reference) => {
      if (reference.current && map.hasLayer(reference.current)) {
        map.removeLayer(reference.current);
      }
      reference.current = null;
    });
    const satellite = displaySatellite;
    if (!satellite || !satelliteStorageId) return;
    const layerUrl = (layer: "burnt" | "heat" | "smoke") =>
      `/api/satellite?hour=${encodeURIComponent(satelliteStorageId)}&layer=${layer}&v=${encodeURIComponent(satellite.capturedAt)}`;
    if (satellite.layers.burnt) {
      historicalBurntLayerRef.current = window.L.imageOverlay(
        layerUrl("burnt"),
        satellite.bounds,
        { opacity: 0.48, interactive: false },
      );
    }
    if (satellite.layers.heat) {
      historicalHeatLayerRef.current = window.L.imageOverlay(
        layerUrl("heat"),
        satellite.bounds,
        { opacity: 0.78, interactive: false },
      );
    }
    if (satellite.layers.smoke) {
      historicalSmokeLayerRef.current = window.L.imageOverlay(
        layerUrl("smoke"),
        satellite.bounds,
        { opacity: 0.52, interactive: false },
      );
    }
  }, [displaySatellite, mapReady, satelliteStorageId]);

  useEffect(() => {
    if (!mapReady || !window.L || !effisAreaLayerRef.current) return;
    const L = window.L;
    effisAreaLayerRef.current.clearLayers();
    if (!cachedEffisMap?.features?.length) return;
    const readAt = cachedEffisMap.source.readAt
      ? formatSnapshotTime(cachedEffisMap.source.readAt)
      : "sin hora";
    L.geoJSON<EffisAreaFeatureProperties>(cachedEffisMap, {
      renderer: canvasRendererRef.current,
      bubblingMouseEvents: false,
      style: {
        color: "#84483a",
        weight: 1,
        fillColor: "#b9684e",
        fillOpacity: 0.24,
      },
      onEachFeature: (feature, layer) => {
        const properties = feature.properties;
        const location =
          [properties.commune, properties.province].filter(Boolean).join(" · ") ||
          "Zona Centro";
        const area = properties.areaHectares
          ? `${properties.areaHectares.toLocaleString("es-ES")} ha cartografiadas.`
          : "Superficie cartografiada sin área publicada.";
        const observed = properties.lastFireDate || properties.fireDate;
        const updated = properties.lastUpdate;
        layer
          .bindPopup(
            `<div class="foco-popup"><span class="popup-kicker" style="color:#8d4938">EFFIS · ÁREA RECORRIDA</span><strong>${escapeHtml(location)}</strong><p>${escapeHtml(area)}</p><small>Producto diario${observed ? ` · incendio observado ${escapeHtml(formatSnapshotTime(observed))}` : ""}${updated ? ` · actualizado ${escapeHtml(formatSnapshotTime(updated))}` : ""} · lectura FOCO ${escapeHtml(readAt)}${cachedEffisMap.source.stale ? " · última copia válida" : ""}</small></div>`,
            { closeButton: false },
          )
          .on("click", (event: Leaflet.LeafletMouseEvent) =>
            requestForecast(event.latlng.lat, event.latlng.lng),
          );
      },
    }).addTo(effisAreaLayerRef.current);
  }, [cachedEffisMap, mapReady, requestForecast]);

  useEffect(() => {
    if (
      !mapReady ||
      !window.L ||
      !copernicusBurntLayerRef.current ||
      !copernicusFrontLayerRef.current
    ) {
      return;
    }
    const L = window.L;
    copernicusBurntLayerRef.current.clearLayers();
    copernicusFrontLayerRef.current.clearLayers();
    if (!displayFireMap?.features?.length) return;

    const source = displayFireMap.source;
    const areaFeatures = displayFireMap.features.filter(
      (feature) => feature.properties?.kind === "burnt-area",
    );
    const frontFeatures = displayFireMap.features.filter(
      (feature) =>
        feature.properties?.kind === "fire-front" ||
        feature.properties?.kind === "active-flame",
    );

    if (areaFeatures.length) {
      L.geoJSON<CopernicusFeatureProperties>(
        { type: "FeatureCollection", features: areaFeatures },
        {
        renderer: canvasRendererRef.current,
        bubblingMouseEvents: false,
        style: {
          color: "#713a31",
          weight: 1.2,
          fillColor: "#a45b48",
          fillOpacity: 0.34,
        },
        onEachFeature: (feature, layer) => {
          const properties = feature.properties;
          const observed = properties.observedAt
            ? formatSnapshotTime(properties.observedAt)
            : "hora no disponible";
          const area = properties.mappedAreaHectares
            ? `${properties.mappedAreaHectares.toLocaleString("es-ES")} ha cartografiadas en este producto.`
            : "Delimitación del último producto entregado.";
          layer
            .bindPopup(
              `<div class="foco-popup"><span class="popup-kicker" style="color:#8d4938">COPERNICUS · ÁREA CARTOGRAFIADA</span><strong>${escapeHtml(properties.areaName || properties.label)}</strong><p>${escapeHtml(area)}</p><small>${escapeHtml(properties.activationCode || "Copernicus")} · ${escapeHtml(properties.product || "producto")}, observado ${escapeHtml(observed)} · lectura ${escapeHtml(formatSnapshotTime(source.readAt))}</small></div>`,
              { closeButton: false },
            )
            .on("click", (event: Leaflet.LeafletMouseEvent) =>
              requestForecast(event.latlng.lat, event.latlng.lng),
            );
        },
      },
      ).addTo(copernicusBurntLayerRef.current);
    }

    if (frontFeatures.length) {
      L.geoJSON<CopernicusFeatureProperties>(
        { type: "FeatureCollection", features: frontFeatures },
        {
          renderer: canvasRendererRef.current,
          bubblingMouseEvents: false,
          style: (feature) =>
            feature?.properties?.kind === "fire-front"
              ? { color: "#ffcc3d", weight: 4, opacity: 0.95, dashArray: "8 5" }
              : {},
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, {
              renderer: canvasRendererRef.current,
              radius: 3.5,
              color: "#fff1ad",
              weight: 1,
              fillColor: "#ff5a32",
              bubblingMouseEvents: false,
              fillOpacity: 0.95,
            }),
          onEachFeature: (feature, layer) => {
            const isFront = feature.properties?.kind === "fire-front";
            const properties = feature.properties;
            const observed = properties?.observedAt
              ? formatSnapshotTime(properties.observedAt)
              : "hora no disponible";
            layer.bindPopup(
              `<div class="foco-popup"><span class="popup-kicker" style="color:#d88713">COPERNICUS · ${isFront ? "FRENTE OBSERVADO" : "LLAMA ACTIVA OBSERVADA"}</span><strong>${escapeHtml(properties?.areaName || properties?.label)}</strong><p>${isFront ? "Línea de frente de la observación más reciente que publicó esta geometría." : "Detección puntual incluida en el último producto que publicó llamas activas."}</p><small>${escapeHtml(properties?.activationCode || "Copernicus")} · observado ${escapeHtml(observed)} · no equivale a posición actual en tiempo real</small></div>`,
              { closeButton: false },
            );
          },
        },
      ).addTo(copernicusFrontLayerRef.current);
    }
  }, [displayFireMap, mapReady, requestForecast]);

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
        bubblingMouseEvents: false,
      });
      marker
        .bindPopup(
          `<div class="foco-popup"><span class="popup-kicker" style="color:${meta.color}">${meta.label} · ${escapeHtml(point.province)}</span><strong>${escapeHtml(point.name)}</strong><p>${escapeHtml(point.detail)}</p><small>${escapeHtml(point.sourceLabel)} · ${escapeHtml(point.sourceUpdatedAt)}<br>Punto representativo geocodificado; no es un perímetro oficial.</small></div>`,
          { closeButton: false, offset: [0, -9] },
        )
        .addTo(situationLayerRef.current);
    });
  }, [activeKinds, displayRegion.points, mapReady]);

  useEffect(() => {
    if (!mapReady || !fireAreaLayerRef.current || !window.L) return;
    const L = window.L;
    fireAreaLayerRef.current.clearLayers();
    const mappedFireIds = new Set(
      (displayFireMap?.features || []).flatMap(
        (feature) => feature.properties?.fireIds || [],
      ),
    );
    displayRegion.fires.forEach((fire) => {
      if (mappedFireIds.has(fire.id)) return;
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
        bubblingMouseEvents: false,
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
        .on("click", (event: Leaflet.LeafletMouseEvent) =>
          requestForecast(event.latlng.lat, event.latlng.lng),
        )
        .addTo(fireAreaLayerRef.current);
    });
  }, [displayFireMap, displayRegion.fires, mapReady, requestForecast]);

  useEffect(() => {
    if (!mapReady || !airLayerRef.current || !window.L) return;
    const L = window.L;
    airLayerRef.current.clearLayers();
    displayAirStations.forEach((station) => {
      const recoveryNote = station.carriedForward
        ? " · MITECO sin índice nuevo; última lectura válida conservada"
        : "";
      L.circleMarker([station.lat, station.lon], {
        renderer: canvasRendererRef.current,
        radius: 10,
        color: station.carriedForward ? "#657477" : "#ffffff",
        dashArray: station.carriedForward ? "4 3" : undefined,
        weight: 3,
        fillColor: station.color,
        fillOpacity: station.carriedForward ? 0.58 : 0.88,
        bubblingMouseEvents: false,
      })
        .bindPopup(
          `<div class="foco-popup"><span class="popup-kicker" style="color:${escapeHtml(station.color)}">ICA ${station.index || "—"} · ${escapeHtml(station.label)}</span><strong>${escapeHtml(station.name)}</strong><p>Contaminante dominante: ${escapeHtml(station.pollutant || "sin dato")}${station.incomplete ? " · índice con datos parciales" : ""}</p><small>${escapeHtml(station.hour || "Sin lectura reciente")}${station.delayed ? " · fuente con retraso" : ""}${recoveryNote} · MITECO, dato provisional</small></div>`,
          { closeButton: false, offset: [0, -10] },
        )
        .addTo(airLayerRef.current);
    });
  }, [displayAirStations, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const toggleLayer = (layer: Leaflet.Layer | null, visible: boolean) => {
      if (!layer) return;
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    };
    const hasFrozenSatellite = Boolean(displaySatellite);
    const hasStructuredEffis = Boolean(cachedEffisMap?.features?.length);
    toggleLayer(airLayerRef.current, airVisible);
    toggleLayer(heatLayerRef.current, heatVisible && !hasFrozenSatellite && isLive);
    toggleLayer(smokeLayerRef.current, smokeVisible && !hasFrozenSatellite && isLive);
    toggleLayer(historicalHeatLayerRef.current, heatVisible && hasFrozenSatellite);
    toggleLayer(
      historicalBurntLayerRef.current,
      burntVisible && hasFrozenSatellite && !hasStructuredEffis,
    );
    toggleLayer(historicalSmokeLayerRef.current, smokeVisible && hasFrozenSatellite);
    toggleLayer(effisAreaLayerRef.current, burntVisible && hasStructuredEffis);
    toggleLayer(copernicusBurntLayerRef.current, burntVisible);
    toggleLayer(copernicusFrontLayerRef.current, frontVisible);
    toggleLayer(fireAreaLayerRef.current, fireAreasVisible);
    toggleLayer(userMarkerRef.current, userVisible);
  }, [
    airVisible,
    burntVisible,
    fireAreasVisible,
    frontVisible,
    heatVisible,
    isLive,
    mapReady,
    displaySatellite,
    smokeVisible,
    userVisible,
    cachedEffisMap,
  ]);

  useEffect(() => {
    const date = layerTime.slice(0, 10);
    heatLayerRef.current?.setParams({ time: date });
    smokeLayerRef.current?.setUrl(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Aerosol_Type_Deep_Blue_Best_Estimate/default/${date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    );
  }, [layerTime, mapReady]);

  const focusPoint = (point: SituationPoint) => {
    setMobileSidebarOpen(false);
    mapRef.current?.setView([point.lat, point.lon], 12);
    situationLayerRef.current?.eachLayer((layer) => {
      const marker = layer as Leaflet.Marker;
      const location = marker.getLatLng();
      if (
        location &&
        Math.abs(location.lat - point.lat) < 0.000001 &&
        Math.abs(location.lng - point.lon) < 0.000001
      ) {
        marker.openPopup();
      }
    });
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

  const sourceItems = [
    {
      id: "x112",
      icon: "X",
      className: "",
      title: "@112cmadrid",
      detail: "Avisos públicos operativos y ES-Alert",
      url: "https://x.com/112cmadrid",
      read: sourceReads.x112?.readAt || newsReadAt,
      ok: sourceReads.x112?.ok,
    },
    {
      id: "infocam",
      icon: "IF",
      className: "source-icon--clm",
      title: "@Plan_INFOCAM",
      detail: "Operativo oficial de incendios de Castilla-La Mancha",
      url: "https://x.com/Plan_INFOCAM",
      read: sourceReads.infocam?.readAt || newsReadAt,
      ok: sourceReads.infocam?.ok,
    },
    {
      id: "x112cyl",
      icon: "112",
      className: "source-icon--jcyl",
      title: "@112cyl",
      detail: "Emergencias oficiales de Castilla y León",
      url: "https://x.com/112cyl",
      read: sourceReads.x112cyl?.readAt || newsReadAt,
      ok: sourceReads.x112cyl?.ok,
    },
    {
      id: "ume",
      icon: "UME",
      className: "source-icon--ume",
      title: "@UMEgob",
      detail: "Unidad Militar de Emergencias",
      url: "https://x.com/UMEgob",
      read: sourceReads.ume?.readAt || newsReadAt,
      ok: sourceReads.ume?.ok,
    },
    {
      id: "madrid",
      icon: "CM",
      className: "source-icon--cm",
      title: "Comunidad de Madrid",
      detail: "Parte autonómico; localidades y carreteras",
      url: OFFICIAL_URL,
      read: displayStatus.fetchedAt || sourceReads.madrid?.readAt || regionReadAt,
      ok: sourceReads.madrid?.ok,
    },
    {
      id: "dsn",
      icon: "ES",
      className: "source-icon--es",
      title: "Seguridad Nacional",
      detail: "Datos incorporados: 24 jul · 08:00",
      url: DSN_URL,
      read: sourceReads.dsn?.readAt,
      ok: sourceReads.dsn?.ok,
    },
    {
      id: "clm",
      icon: "CLM",
      className: "source-icon--clm",
      title: "Castilla-La Mancha",
      detail: "Parte oficial de La Mierla y Sierra Norte",
      url: CLM_URL,
      read: sourceReads.clm?.readAt || regionReadAt,
      ok: sourceReads.clm?.ok,
    },
    {
      id: "fidias",
      icon: "CLM",
      className: "source-icon--clm",
      title: "FIDIAS · Castilla-La Mancha",
      detail: "Ficha operativa pública de La Mierla",
      url: FIDIAS_URL,
      read: sourceReads.fidias?.readAt,
      ok: sourceReads.fidias?.ok,
    },
    {
      id: "jcyl",
      icon: "CyL",
      className: "source-icon--jcyl",
      title: "Datos Abiertos · Castilla y León",
      detail: "Parte oficial estructurado de Burgohondo",
      url: JCYL_FIRE_URL,
      read: sourceReads.jcyl?.readAt,
      ok: sourceReads.jcyl?.ok,
    },
    {
      id: "cems",
      icon: "EU",
      className: "source-icon--eu",
      title: `Copernicus ${displayFireMap?.source.activationCode || "EMSR900 · EMSR898"}`,
      detail: displayFireMap?.source.areas?.length
        ? `${displayFireMap.source.areas.length} áreas oficiales · última observación ${formatSnapshotTime(displayFireMap.source.areaObservedAt)}`
        : displaySatellite?.copernicus?.areaObservedAt
          ? `Última área observada ${formatSnapshotTime(displaySatellite.copernicus.areaObservedAt)}`
          : "Perímetros y frentes oficiales de la zona Centro",
      url: CEMS_CENTRAL_URL,
      read: displaySatellite?.copernicus?.readAt || displaySatellite?.layerCapturedAt?.copernicus,
      ok: Boolean(displaySatellite?.layers.copernicus),
    },
    {
      id: "effis-area",
      icon: "EU",
      className: "source-icon--eu",
      title: "Copernicus EFFIS · área recorrida",
      detail: displaySatellite?.effis?.latestUpdateInView
        ? `Producto diario, sin hora fija · zona Centro actualizada ${formatSnapshotTime(displaySatellite.effis.latestUpdateInView)}` +
          (displaySatellite.effis.stale ? " · metadatos: última lectura válida" : "") +
          (displaySatellite.staleLayers?.effis ? " · geometrías: última copia válida" : "")
        : displaySatellite?.layerSourceDate?.burnt
          ? `Respaldo ráster del ${formatSourceDate(displaySatellite.layerSourceDate.burnt)}` +
            (displaySatellite.staleLayers?.burnt ? " · última copia válida" : "")
          : "Producto diario; FOCO comprueba la fuente una vez por hora",
      url: "https://forest-fire.emergency.copernicus.eu/apps/effis.csv/",
      read:
        displaySatellite?.effis?.readAt ||
        displaySatellite?.layerCheckedAt?.effis ||
        displaySatellite?.layerCheckedAt?.burnt ||
        displaySatellite?.layerCapturedAt?.burnt,
      ok:
        Boolean(displaySatellite?.effis && !displaySatellite.effis.stale) ||
        Boolean(displaySatellite?.layers.effis && !displaySatellite.errors?.effis) ||
        Boolean(displaySatellite?.layers.burnt && !displaySatellite.errors?.burnt),
    },
    {
      id: "nasa-heat",
      icon: "NASA",
      className: "source-icon--nasa",
      title: "NASA GIBS · calor VIIRS",
      detail: displaySatellite?.layerSourceDate?.heat
        ? `Actividad térmica del ${formatSourceDate(displaySatellite.layerSourceDate.heat)}` +
          (displaySatellite.staleLayers?.heat ? " · última copia válida" : "")
        : "Actividad térmica; no equivale a un frente exacto",
      url: "https://gibs.earthdata.nasa.gov/",
      read: displaySatellite?.layerCapturedAt?.heat,
      ok: Boolean(displaySatellite?.layers.heat),
    },
    {
      id: "smoke",
      icon: "NASA",
      className: "source-icon--nasa",
      title: "NASA GIBS · aerosoles",
      detail: displaySatellite?.layerSourceDate?.smoke
        ? `Indicio visual de humo del ${formatSourceDate(displaySatellite.layerSourceDate.smoke)}` +
          (displaySatellite.staleLayers?.smoke ? " · última copia válida" : "")
        : "Capa VIIRS usada como indicio visual de humo",
      url: "https://gibs.earthdata.nasa.gov/",
      read: displaySatellite?.layerCapturedAt?.smoke,
      ok: Boolean(displaySatellite?.layers.smoke),
    },
    {
      id: "air",
      icon: "ICA",
      className: "source-icon--air",
      title: "MITECO · calidad del aire",
      detail: recoveredAirStationCount
        ? `${currentAirStationCount} lecturas actuales · ${recoveredAirStationCount} últimas válidas`
        : `${displayAirStations.length} estaciones en la vista`,
      url: MITECO_ICA_URL,
      read: selectedSnapshot?.capturedAt || airSourceReadAt,
      ok: displayAirStations.length > 0,
    },
    {
      id: "region",
      icon: "⌖",
      className: "source-icon--local",
      title: "FOCO · posiciones",
      detail: displayRegion.unmappedLocations?.length
        ? `Centroides representativos · ${displayRegion.unmappedLocations.length} nombres sin ubicar`
        : "Centroides representativos; no perímetros oficiales",
      url: OFFICIAL_URL,
      read: selectedSnapshot?.capturedAt || regionReadAt,
      ok: true,
    },
    {
      id: "weather",
      icon: "MET",
      className: "source-icon--weather",
      title: "Open-Meteo",
      detail: "Previsión del último punto pulsado",
      url: "https://open-meteo.com/",
      read: weatherReadAt,
      ok: weatherReadAt ? true : undefined,
    },
    {
      id: "osm",
      icon: "OSM",
      className: "source-icon--osm",
      title: "OpenStreetMap",
      detail: "Mapa base descargado bajo demanda",
      url: "https://www.openstreetmap.org/",
      read: baseMapReadAt,
      ok: baseMapReadAt ? true : undefined,
    },
  ];

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
            <nav className="sidebar-tabs" aria-label="Secciones del panel" role="tablist">
              {([
                ["news", "Actualidad"],
                ["evacuations", "Evacuaciones"],
                ["sources", "Fuentes"],
              ] as [SidebarTab, string][]).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  className={sidebarTab === tab ? "active" : ""}
                  aria-selected={sidebarTab === tab}
                  onClick={() => setSidebarTab(tab)}
                >
                  {label}
                </button>
              ))}
            </nav>

            {sidebarTab === "news" && (
              <section className="sidebar-tab-panel news-panel" aria-label="Actualidad oficial de los incendios">
                <div className="eyebrow-row">
                  <span className="eyebrow">{isLive ? "ESTADO Y ÚLTIMA HORA" : "PARTE DEL SNAPSHOT"}</span>
                  <span className="refresh-time">{formatReadTime(newsReadAt)}</span>
                </div>

                <div className="incident-list" aria-label="Estado oficial de los incendios seguidos">
                  {officialIncidents.map((incident) => {
                    const normalizedStatus = incident.status.toLowerCase();
                    const tone = normalizedStatus.includes("extinguido")
                      ? "out"
                      : normalizedStatus.includes("controlado")
                        ? "controlled"
                        : normalizedStatus.includes("estabilizado")
                          ? "stable"
                          : "active";
                    return (
                      <a key={incident.id} className="incident-row" href={incident.url} target="_blank" rel="noreferrer">
                        <span className={`incident-status incident-status--${tone}`}>{incident.status}</span>
                        <span>
                          <b>{incident.name}</b>
                          <small>{incident.province} · {incident.detail}</small>
                          <time dateTime={incident.updatedAt}>
                            {incident.updatedLabel
                              ? incident.updatedLabel === "FIDIAS leído"
                                ? `${incident.updatedLabel} ${formatSnapshotTime(incident.updatedAt)}`
                                : incident.updatedLabel
                              : formatSnapshotTime(incident.updatedAt)}
                            {" · "}{incident.source}
                          </time>
                        </span>
                        <i>↗</i>
                      </a>
                    );
                  })}
                  {!officialIncidents.length && (
                    <p className="incident-empty">Esperando las fichas operativas oficiales.</p>
                  )}
                </div>

                <a className="official-brief" href={OFFICIAL_URL} target="_blank" rel="noreferrer">
                  <span className="official-brief-kicker">COMUNIDAD DE MADRID · {displayStatus.lastUpdated}</span>
                  <b>Sierra Oeste: {counts.evacuado} evacuaciones y {counts.confinado} confinamientos señalados</b>
                  <small>{displayStatus.roads.length} carreteras incluidas en el parte · abrir fuente ↗</small>
                </a>

                <div className="news-list">
                  {officialNews.map((item) => (
                    <a key={item.id} className="news-card" href={item.url} target="_blank" rel="noreferrer">
                      <span>
                        <b>{item.source}</b>
                        <time dateTime={item.publishedAt}>{formatSnapshotTime(item.publishedAt)}</time>
                      </span>
                      <p>{item.body}</p>
                      <small>Publicación oficial en X ↗</small>
                    </a>
                  ))}
                  {!officialNews.length && (
                    <a className="news-card news-card--empty" href="https://x.com/112cmadrid" target="_blank" rel="noreferrer">
                      <span><b>Canales oficiales</b><time>{formatReadTime(newsReadAt)}</time></span>
                      <p>No se han podido extraer avisos relevantes de los timelines públicos. Puedes abrir Madrid 112 directamente.</p>
                      <small>Abrir @112cmadrid ↗</small>
                    </a>
                  )}
                  <a className="news-card news-card--satellite" href={CEMS_CENTRAL_URL} target="_blank" rel="noreferrer">
                    <span>
                      <b>Copernicus EMSR900 + EMSR898 · Zona Centro</b>
                      <time>
                        {displaySatellite?.copernicus?.areaObservedAt
                          ? formatSnapshotTime(displaySatellite.copernicus.areaObservedAt)
                          : "Esperando caché"}
                      </time>
                    </span>
                    <p>
                      Perímetros cartografiados
                      {cachedFireMap?.source?.mappedAreaHectares
                        ? `: ${Number(cachedFireMap.source.mappedAreaHectares).toLocaleString("es-ES")} ha sumadas en los últimos productos de cada área`
                        : ""}
                      . Cada frente y llama muestra su propia hora de observación, no una posición en tiempo real.
                    </p>
                    <small>Abrir activación oficial ↗</small>
                  </a>
                </div>
              </section>
            )}

            {sidebarTab === "evacuations" && (
              <section className="sidebar-tab-panel" aria-label="Evacuaciones y afectaciones">
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
                  <p className="geocode-note">
                    Los símbolos son puntos representativos geocodificados, no áreas oficiales de evacuación.
                    {displayRegion.unmappedLocations?.length
                      ? ` Sin ubicación: ${displayRegion.unmappedLocations.join(", ")}.`
                      : ""}
                  </p>
                  {(activeList === "evacuado" || activeList === "confinado") && (
                    <p className="geocode-note">
                      Madrid se reconstruye desde su fuente oficial. Fuera de Madrid se muestran relaciones nominales oficiales fechadas: los partes estructurados disponibles no publican localidades evacuadas o confinadas y FOCO no las infiere.
                    </p>
                  )}
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
              </section>
            )}

            {sidebarTab === "sources" && (
              <section className="sidebar-tab-panel sources-card" aria-label="Fuentes de datos y últimas lecturas">
                <div>
                  <span className="eyebrow">FUENTES UTILIZADAS</span>
                  <span className="verified">Trazabilidad</span>
                </div>
                <p className="sources-intro">La lectura indica cuándo FOCO consultó o congeló cada capa; la observación del satélite puede ser anterior.</p>
                {sourceItems.map((source) => (
                  <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                    <span className={`source-icon ${source.className}`}>{source.icon}</span>
                    <span>
                      <b>{source.title}</b>
                      <small>{source.detail}</small>
                      <em className={source.ok === false ? "source-read source-read--error" : "source-read"}>
                        {formatReadTime(source.read)}
                        {source.ok === false ? " · fuente no accesible en esa lectura" : ""}
                      </em>
                    </span>
                    <i>↗</i>
                  </a>
                ))}
              </section>
            )}

            <p className="safety-note">
              Visor informativo. Círculos y puntos de localidades son referencias orientativas, no perímetros oficiales. Ante una emergencia sigue ES-Alert, las instrucciones oficiales y llama al 112.
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
          <canvas ref={windCanvasRef} className="wind-particles" aria-hidden="true" />
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
              <button
                aria-pressed={heatVisible}
                onClick={() => setHeatVisible(!heatVisible)}
                title="Actividad térmica satelital reciente; orienta sobre actividad, no dibuja un frente exacto"
              >
                <i className="legend-hotspot"></i><span>Actividad VIIRS</span><em>{heatVisible ? "ON" : "OFF"}</em>
              </button>
              <button
                aria-pressed={burntVisible}
                onClick={() => setBurntVisible(!burntVisible)}
                title="EFFIS es un producto diario sin hora fija; FOCO lo comprueba una vez por hora"
              >
                <i className="legend-burnt"></i><span>Área recorrida</span><em>{burntVisible ? "ON" : "OFF"}</em>
              </button>
              <button
                aria-pressed={frontVisible}
                onClick={() => setFrontVisible(!frontVisible)}
                title="Última línea de frente y llamas activas cartografiadas por Copernicus; consulta la hora de observación"
              >
                <i className="legend-front"></i><span>Frente observado</span><em>{frontVisible ? "ON" : "OFF"}</em>
              </button>
              <button
                aria-pressed={windParticlesVisible}
                onClick={() => setWindParticlesVisible(!windParticlesVisible)}
                title="Pocas partículas muestran hacia dónde se desplaza el viento; se reducen en móvil y se desactivan con movimiento reducido"
              >
                <i className="legend-wind">→</i><span>Viento suave</span><em>{windParticlesVisible ? "ON" : "OFF"}</em>
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
              <b>Pulsa el mapa o un área de incendio</b>
              <small>Temperatura, cielo, viento y lluvia por hora</small>
            </button>
          )}

          <section className={`forecast-panel ${panelOpen ? "open" : ""}`} aria-live="polite">
            <div className="forecast-heading">
              <div>
                <div className="forecast-title-row">
                  <span className="eyebrow">
                    PREVISIÓN DEL PUNTO{" "}
                    <i className="forecast-point-symbol forecast-point-symbol--title" aria-hidden="true">
                      <span
                        className={
                          currentWindDirection === null
                            ? "forecast-wind-arrow is-pending"
                            : "forecast-wind-arrow"
                        }
                        style={{ transform: "rotate(" + (currentWindDirection ?? 0) + "deg)" }}
                      >
                        ↑
                      </span>
                    </i>
                  </span>
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
                  const sky = skySymbol(hour);
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
                            <div className="weather-metric"><small>Tiempo</small></div>
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
                            <strong className="sky-symbol" role="img" aria-label={`${sky.label}, ${hour.temperature} grados`} title={sky.label}>
                              {sky.symbol}
                            </strong>
                            <span className="weather-temperature">{Math.round(hour.temperature)}°</span>
                          </div>
                          <div className="weather-metric wind">
                            <strong className="wind-stack" aria-label={`Viento ${compass(hour.windDirection)}, ${hour.wind} kilómetros por hora`}>
                              <span className="wind-direction">
                                {compass(hour.windDirection)}
                                <i
                                  className="wind-arrow"
                                  aria-hidden="true"
                                  style={{ transform: `rotate(${hour.windDirection}deg)` }}
                                >
                                  ↑
                                </i>
                              </span>
                              <span className="wind-speed">{hour.wind} km/h</span>
                            </strong>
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
