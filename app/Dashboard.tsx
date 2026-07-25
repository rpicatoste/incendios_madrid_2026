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
  observedAt?: string | null;
  delayed?: boolean;
  carriedForward?: boolean;
  hour: string | null;
};

type ForecastHour = {
  time: string;
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
    schemaVersion?: 2;
    capturedAt: string;
    bounds: [[number, number], [number, number]];
    layers: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus", true>>;
    layerCapturedAt?: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus", string>>;
    rasterDimensions?: Partial<
      Record<"burnt" | "heat" | "smoke", { width: number; height: number }>
    >;
    staleLayers?: Partial<Record<"burnt" | "heat" | "smoke" | "copernicus", true>>;
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
const CEMS_LA_MIERLA_URL =
  "https://mapping.emergency.copernicus.eu/activations/EMSR898/";
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
  if (hour.weatherCode === 0) return { symbol: "☀︎", label: "Despejado" };
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
  if (hour.sunMinutes >= 45) return { symbol: "☀︎", label: "Despejado" };
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

const formatReadTime = (value?: string) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Sin lectura todavía";
  return `Leída ${formatSnapshotTime(value)}`;
};

export default function Dashboard() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const situationLayerRef = useRef<any>(null);
  const fireAreaLayerRef = useRef<any>(null);
  const airLayerRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const burntLayerRef = useRef<any>(null);
  const smokeLayerRef = useRef<any>(null);
  const historicalHeatLayerRef = useRef<any>(null);
  const historicalBurntLayerRef = useRef<any>(null);
  const historicalSmokeLayerRef = useRef<any>(null);
  const copernicusBurntLayerRef = useRef<any>(null);
  const copernicusFrontLayerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const forecastMarkerRef = useRef<any>(null);
  const canvasRendererRef = useRef<any>(null);
  const forecastRequestRef = useRef<AbortController | null>(null);
  const forecastCacheRef = useRef<Map<string, ForecastCacheEntry>>(new Map());

  const [liveStatus, setLiveStatus] = useState<LiveStatus>(fallbackStatus);
  const [liveAirStations, setLiveAirStations] = useState<AirStation[]>([]);
  const [liveRegion, setLiveRegion] = useState<RegionData>(defaultRegionData);
  const [liveSatellite, setLiveSatellite] = useState<SnapshotData["satellite"]>(undefined);
  const [cachedFireMap, setCachedFireMap] = useState<any>(null);
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
  const [smokeVisible, setSmokeVisible] = useState(true);
  const [fireAreasVisible, setFireAreasVisible] = useState(true);
  const [userVisible, setUserVisible] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [forecastState, setForecastState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [forecastWindDirection, setForecastWindDirection] = useState<number | null>(null);
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
      setForecastState("ready");
      return;
    }
    if (cachedForecast) forecastCacheRef.current.delete(cacheKey);

    const controller = new AbortController();
    forecastRequestRef.current = controller;
    if (!force) {
      setForecast([]);
      setForecastWindDirection(null);
      setForecastState("loading");
    }
    try {
      const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: "wind_direction_10m",
        hourly:
          "cloud_cover,sunshine_duration,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m",
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
      if (!rows.length || typeof windDirection !== "number" || !Number.isFinite(windDirection)) {
        throw new Error("Forecast returned no current hours or wind direction");
      }
      if (forecastCacheRef.current.size >= 12) {
        const oldestKey = forecastCacheRef.current.keys().next().value;
        if (oldestKey) forecastCacheRef.current.delete(oldestKey);
      }
      forecastCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + REFRESH_INTERVALS.forecast,
        rows,
        windDirection,
      });
      setForecast(rows);
      setForecastWindDirection(windDirection);
      setForecastState("ready");
      setWeatherReadAt(new Date().toISOString());
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      if (!force) {
        setForecast([]);
        setForecastWindDirection(null);
        setForecastState("error");
      }
    } finally {
      if (forecastRequestRef.current === controller) forecastRequestRef.current = null;
    }
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
        copernicusBurntLayerRef.current = L.layerGroup().addTo(map);
        copernicusFrontLayerRef.current = L.layerGroup().addTo(map);
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
          });

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
    let active = true;
    if (!displaySatellite?.layers.copernicus || !satelliteStorageId) {
      setCachedFireMap(null);
      return () => {
        active = false;
      };
    }
    fetch(
      `/api/satellite?hour=${encodeURIComponent(satelliteStorageId)}&layer=copernicus&v=${encodeURIComponent(displaySatellite.capturedAt)}`,
      { cache: satelliteStorageId === "live" ? "no-store" : "force-cache" },
    )
      .then((response) => {
        if (!response.ok) throw new Error("Copernicus histórico no disponible");
        return response.json();
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

    const source = displayFireMap.source || {};
    const observedArea = source.areaObservedAt
      ? formatSnapshotTime(source.areaObservedAt)
      : "hora no disponible";
    const observedFront = source.frontObservedAt
      ? formatSnapshotTime(source.frontObservedAt)
      : "hora no disponible";
    const areaFeature = displayFireMap.features.find(
      (feature: any) => feature.properties?.kind === "burnt-area",
    );
    const frontFeatures = displayFireMap.features.filter(
      (feature: any) =>
        feature.properties?.kind === "fire-front" ||
        feature.properties?.kind === "active-flame",
    );

    if (areaFeature) {
      L.geoJSON(areaFeature, {
        renderer: canvasRendererRef.current,
        bubblingMouseEvents: false,
        style: {
          color: "#713a31",
          weight: 1.2,
          fillColor: "#a45b48",
          fillOpacity: 0.34,
        },
        onEachFeature: (_feature: any, layer: any) => {
          layer
            .bindPopup(
              `<div class="foco-popup"><span class="popup-kicker" style="color:#8d4938">COPERNICUS · ÁREA RECORRIDA</span><strong>La Mierla · Guadalajara</strong><p>Delimitación acumulada de los productos disponibles. Máximo cartografiado en un producto: ${Number(source.mappedAreaHectares || 0).toLocaleString("es-ES")} ha.</p><small>${escapeHtml(source.areaProduct || "Producto")}, observado ${escapeHtml(observedArea)} · lectura ${escapeHtml(source.readAt ? formatSnapshotTime(source.readAt) : "sin hora")}</small></div>`,
              { closeButton: false },
            )
            .on("click", (event: any) =>
              requestForecast(event.latlng.lat, event.latlng.lng),
            );
        },
      }).addTo(copernicusBurntLayerRef.current);
      L.circleMarker([40.953, -3.236], {
        renderer: canvasRendererRef.current,
        radius: 0,
        opacity: 0,
        fillOpacity: 0,
        interactive: false,
      })
        .bindTooltip(
          `La Mierla · Copernicus ${source.areaProduct || ""}`,
          { permanent: true, direction: "center", className: "fire-area-label" },
        )
        .addTo(copernicusBurntLayerRef.current);
    }

    if (frontFeatures.length) {
      L.geoJSON(
        { type: "FeatureCollection", features: frontFeatures },
        {
          renderer: canvasRendererRef.current,
          bubblingMouseEvents: false,
          style: (feature: any) =>
            feature?.properties?.kind === "fire-front"
              ? { color: "#ffcc3d", weight: 4, opacity: 0.95, dashArray: "8 5" }
              : {},
          pointToLayer: (_feature: any, latlng: any) =>
            L.circleMarker(latlng, {
              renderer: canvasRendererRef.current,
              radius: 3.5,
              color: "#fff1ad",
              weight: 1,
              fillColor: "#ff5a32",
              bubblingMouseEvents: false,
              fillOpacity: 0.95,
            }),
          onEachFeature: (feature: any, layer: any) => {
            const isFront = feature.properties?.kind === "fire-front";
            layer
              .bindPopup(
                `<div class="foco-popup"><span class="popup-kicker" style="color:#d88713">COPERNICUS · ${isFront ? "FRENTE OBSERVADO" : "LLAMA ACTIVA OBSERVADA"}</span><strong>La Mierla · Guadalajara</strong><p>${isFront ? "Línea de frente de la última observación que incluye esta geometría." : "Detección puntual incluida en el producto más reciente."}</p><small>Observado ${escapeHtml(isFront ? observedFront : observedArea)} · no equivale a posición actual en tiempo real</small></div>`,
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
    displayRegion.fires.forEach((fire) => {
      if (fire.hasMappedPerimeter && displayFireMap?.features?.length) return;
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
        .on("click", (event: any) =>
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
    const toggleLayer = (layer: any, visible: boolean) => {
      if (!layer) return;
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    };
    const hasFrozenSatellite = Boolean(displaySatellite);
    toggleLayer(airLayerRef.current, airVisible);
    toggleLayer(heatLayerRef.current, heatVisible && !hasFrozenSatellite && !isLive);
    toggleLayer(burntLayerRef.current, burntVisible && !hasFrozenSatellite && !isLive);
    toggleLayer(smokeLayerRef.current, smokeVisible && !hasFrozenSatellite && !isLive);
    toggleLayer(historicalHeatLayerRef.current, heatVisible && hasFrozenSatellite);
    toggleLayer(historicalBurntLayerRef.current, burntVisible && hasFrozenSatellite);
    toggleLayer(historicalSmokeLayerRef.current, smokeVisible && hasFrozenSatellite);
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
  ]);

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
    situationLayerRef.current?.eachLayer((layer: any) => {
      const location = layer.getLatLng?.();
      if (
        location &&
        Math.abs(location.lat - point.lat) < 0.000001 &&
        Math.abs(location.lng - point.lon) < 0.000001
      ) {
        layer.openPopup();
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
      title: "Copernicus EMSR898",
      detail: displaySatellite?.copernicus?.areaObservedAt
        ? `Área observada ${formatSnapshotTime(displaySatellite.copernicus.areaObservedAt)}`
        : "Perímetro y frente cartografiados de La Mierla",
      url: CEMS_LA_MIERLA_URL,
      read: displaySatellite?.copernicus?.readAt || displaySatellite?.layerCapturedAt?.copernicus,
      ok: Boolean(displaySatellite?.layers.copernicus),
    },
    {
      id: "effis-area",
      icon: "EU",
      className: "source-icon--eu",
      title: "Copernicus EFFIS · área",
      detail: "Superficie recorrida; copia completa servida desde caché",
      url: "https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/",
      read: displaySatellite?.layerCapturedAt?.burnt,
      ok: Boolean(displaySatellite?.layers.burnt),
    },
    {
      id: "effis-heat",
      icon: "EU",
      className: "source-icon--eu",
      title: "EFFIS / NASA VIIRS · calor",
      detail: "Actividad térmica; no equivale a un frente exacto",
      url: "https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/",
      read: displaySatellite?.layerCapturedAt?.heat,
      ok: Boolean(displaySatellite?.layers.heat),
    },
    {
      id: "smoke",
      icon: "NASA",
      className: "source-icon--nasa",
      title: "NASA GIBS · aerosoles",
      detail: "Capa VIIRS usada como indicio visual de humo",
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
            <nav className="sidebar-tabs" aria-label="Secciones del panel">
              {([
                ["news", "Actualidad"],
                ["evacuations", "Evacuaciones"],
                ["sources", "Fuentes"],
              ] as [SidebarTab, string][]).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
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
                  <a className="news-card news-card--satellite" href={CEMS_LA_MIERLA_URL} target="_blank" rel="noreferrer">
                    <span>
                      <b>Copernicus EMSR898 · La Mierla</b>
                      <time>
                        {displaySatellite?.copernicus?.areaObservedAt
                          ? formatSnapshotTime(displaySatellite.copernicus.areaObservedAt)
                          : "Esperando caché"}
                      </time>
                    </span>
                    <p>
                      Perímetro cartografiado
                      {cachedFireMap?.source?.mappedAreaHectares
                        ? `: ${Number(cachedFireMap.source.mappedAreaHectares).toLocaleString("es-ES")} ha`
                        : ""}
                      . El frente y las llamas muestran su hora de observación, no una posición en tiempo real.
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
                title="Superficie recorrida por el fuego según EFFIS y Copernicus EMS"
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
              <small>Previsión horaria de sol, viento y lluvia</small>
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
                            <strong className="sky-symbol" role="img" aria-label={sky.label} title={sky.label}>
                              {sky.symbol}
                            </strong>
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
