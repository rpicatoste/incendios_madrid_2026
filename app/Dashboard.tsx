"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    L?: any;
  }
}

type StatusKind = "evacuado" | "confinado" | "acogida";

type SituationPoint = {
  name: string;
  kind: StatusKind;
  lat: number;
  lon: number;
  detail: string;
};

type AirStation = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  label: string;
  color: string;
  pollutant: string | null;
  value: number | null;
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

const OFFICIAL_URL =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";

const points: SituationPoint[] = [
  { name: "Camping El Escorial", kind: "evacuado", lat: 40.5905, lon: -4.147, detail: "Desalojo preventivo comunicado por la Comunidad de Madrid." },
  { name: "Navas del Rey", kind: "evacuado", lat: 40.3869, lon: -4.251, detail: "Municipio incluido en la relación oficial de evacuados." },
  { name: "Chapinería", kind: "evacuado", lat: 40.3788, lon: -4.2093, detail: "Evacuación comunicada mediante ES-Alert." },
  { name: "Colmenar del Arroyo", kind: "evacuado", lat: 40.4191, lon: -4.1983, detail: "Evacuación comunicada mediante ES-Alert." },
  { name: "Aldea del Fresno", kind: "evacuado", lat: 40.323, lon: -4.203, detail: "Municipio incluido en la relación oficial de evacuados." },
  { name: "Robledo de Chavela", kind: "evacuado", lat: 40.5006, lon: -4.2375, detail: "Municipio incluido en la relación oficial de evacuados." },
  { name: "Fresnedillas de la Oliva", kind: "evacuado", lat: 40.4875, lon: -4.1716, detail: "Traslado hacia centros habilitados en Móstoles." },
  { name: "Navalagamella", kind: "evacuado", lat: 40.4689, lon: -4.124, detail: "Municipio incluido en la relación oficial de evacuados." },
  { name: "Zarzalejo", kind: "evacuado", lat: 40.5488, lon: -4.1816, detail: "Municipio incluido en la relación oficial de evacuados." },
  { name: "San Martín de Valdeiglesias", kind: "confinado", lat: 40.3611, lon: -4.3983, detail: "ES-Alert: dirigirse al interior del casco urbano y permanecer a resguardo." },
  { name: "Pelayos de la Presa", kind: "confinado", lat: 40.3609, lon: -4.3349, detail: "ES-Alert: dirigirse al interior del casco urbano y permanecer a resguardo." },
  { name: "Villaviciosa de Odón", kind: "acogida", lat: 40.3579, lon: -3.9008, detail: "Punto de acogida habilitado." },
  { name: "Móstoles", kind: "acogida", lat: 40.3223, lon: -3.8649, detail: "Punto de acogida habilitado." },
  { name: "Brunete", kind: "acogida", lat: 40.4053, lon: -3.9976, detail: "Punto de acogida habilitado." },
  { name: "Leganés", kind: "acogida", lat: 40.3281, lon: -3.7644, detail: "Punto de acogida habilitado." },
  { name: "Villanueva de la Cañada", kind: "acogida", lat: 40.4469, lon: -4.0043, detail: "Punto de acogida habilitado." },
  { name: "Villanueva de Perales", kind: "acogida", lat: 40.3467, lon: -4.1018, detail: "Punto de acogida habilitado." },
  { name: "Villamantilla", kind: "acogida", lat: 40.3388, lon: -4.1303, detail: "Punto de acogida habilitado." },
  { name: "Villamanta", kind: "acogida", lat: 40.2988, lon: -4.1081, detail: "Punto de acogida habilitado." },
  { name: "Las Rozas", kind: "acogida", lat: 40.4929, lon: -3.8737, detail: "Punto de acogida habilitado." },
  { name: "Alcorcón", kind: "acogida", lat: 40.3458, lon: -3.8249, detail: "Punto de acogida habilitado." },
];

const fallbackStatus: LiveStatus = {
  lastUpdated: "24 de julio · 23:30 h",
  evacuated: points.filter((point) => point.kind === "evacuado").map((point) => point.name),
  shelters: [
    "Villaviciosa de Odón", "Móstoles", "Alcalá de Henares", "Brunete",
    "Leganés", "Villanueva de la Cañada", "Villamantilla",
    "Villanueva de Perales", "Getafe", "Villamanta", "Alcobendas",
    "Las Rozas", "Alcorcón",
  ],
  roads: ["M-50", "M-540", "M-501", "M-541", "M-510", "M-512", "M-531", "M-539", "M-533", "M-521"],
  fetchedAt: "",
};

const kindMeta: Record<StatusKind, { label: string; short: string; color: string; icon: string }> = {
  evacuado: { label: "Evacuado", short: "E", color: "#ff5a45", icon: "↗" },
  confinado: { label: "Confinamiento", short: "C", color: "#ffb33f", icon: "⌂" },
  acogida: { label: "Punto de acogida", short: "A", color: "#49b8ff", icon: "+" },
};

const loadLeaflet = async () => {
  if (window.L) return window.L;

  if (!document.querySelector('link[data-leaflet="true"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.dataset.leaflet = "true";
    document.head.appendChild(link);
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-leaflet="true"]');
    if (existing) {
      if (window.L) resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.dataset.leaflet = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar el mapa"));
    document.head.appendChild(script);
  });

  return window.L;
};

const compass = (degrees: number) => {
  const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return directions[Math.round(degrees / 45) % 8];
};

export default function Dashboard() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const situationLayerRef = useRef<any>(null);
  const airLayerRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const burntLayerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);

  const [liveStatus, setLiveStatus] = useState<LiveStatus>(fallbackStatus);
  const [airStations, setAirStations] = useState<AirStation[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [locationState, setLocationState] = useState("Buscando tu posición…");
  const [activeKinds, setActiveKinds] = useState<Record<StatusKind, boolean>>({
    evacuado: true,
    confinado: true,
    acogida: false,
  });
  const [airVisible, setAirVisible] = useState(true);
  const [heatVisible, setHeatVisible] = useState(true);
  const [burntVisible, setBurntVisible] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [forecastState, setForecastState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeList, setActiveList] = useState<"evacuado" | "confinado" | "acogida">("evacuado");

  const visiblePoints = useMemo(
    () => points.filter((point) => point.kind === activeList),
    [activeList],
  );

  useEffect(() => {
    // En una pantalla pequeña priorizamos la emergencia y dejamos la densa
    // red de estaciones a un toque de distancia.
    if (window.matchMedia("(max-width: 680px)").matches) setAirVisible(false);
  }, []);

  const requestForecast = useCallback(async (lat: number, lon: number, label?: string) => {
    setSelectedPoint({
      lat,
      lon,
      label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    });
    setPanelOpen(true);
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
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
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
        .slice(0, 14);
      setForecast(rows);
      setForecastState("ready");
    } catch {
      setForecast([]);
      setForecastState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refreshLiveData = async () => {
      const [statusResult, airResult] = await Promise.allSettled([
        fetch("/api/status", { cache: "no-store" }).then((response) => response.json()),
        fetch("/api/air", { cache: "no-store" }).then((response) => response.json()),
      ]);
      if (!active) return;
      if (statusResult.status === "fulfilled") setLiveStatus(statusResult.value as LiveStatus);
      if (airResult.status === "fulfilled") {
        setAirStations((airResult.value as { stations: AirStation[] }).stations || []);
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
        }).setView([40.4168, -3.7038], 9);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "© OpenStreetMap",
        }).addTo(map);

        L.control.zoom({ position: "bottomright" }).addTo(map);

        const situationLayer = L.layerGroup().addTo(map);
        situationLayerRef.current = situationLayer;
        points.forEach((point) => {
          const meta = kindMeta[point.kind];
          const icon = L.divIcon({
            className: "foco-map-icon",
            html: `<span class="status-marker status-marker--${point.kind}" aria-hidden="true">${meta.icon}</span>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          });
          const marker = L.marker([point.lat, point.lon], { icon });
          marker.__focoKind = point.kind;
          marker.__focoName = point.name;
          marker
            .bindPopup(
              `<div class="foco-popup"><span class="popup-kicker" style="color:${meta.color}">${meta.label}</span><strong>${point.name}</strong><p>${point.detail}</p><small>Fuente: parte oficial Comunidad de Madrid</small></div>`,
              { closeButton: false, offset: [0, -9] },
            )
            .on("click", () => requestForecast(point.lat, point.lon, point.name))
            .addTo(situationLayer);
        });

        const heat = L.tileLayer.wms(
          "https://maps.effis.emergency.copernicus.eu/effis",
          {
            layers: "viirs.hs",
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            time: new Date().toISOString().slice(0, 10),
            opacity: 0.78,
            attribution: "Copernicus EFFIS / NASA VIIRS",
          },
        ).addTo(map);
        heatLayerRef.current = heat;

        const burnt = L.tileLayer.wms(
          "https://maps.effis.emergency.copernicus.eu/effis",
          {
            layers: "effis.nrt.ba.poly",
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            time: new Date().toISOString().slice(0, 10),
            opacity: 0.42,
            attribution: "Copernicus EFFIS / GWIS",
          },
        ).addTo(map);
        burntLayerRef.current = burnt;

        airLayerRef.current = L.layerGroup().addTo(map);

        map.on("click", (event: any) => {
          requestForecast(event.latlng.lat, event.latlng.lng);
        });

        mapRef.current = map;
        setMapReady(true);

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude } = position.coords;
              map.setView([latitude, longitude], 11);
              const icon = L.divIcon({
                className: "foco-map-icon",
                html: '<span class="user-marker"><span></span></span>',
                iconSize: [28, 28],
                iconAnchor: [14, 14],
              });
              userMarkerRef.current = L.marker([latitude, longitude], { icon })
                .bindPopup("<div class=\"foco-popup\"><strong>Tu posición</strong><p>El mapa se ha centrado aquí.</p></div>")
                .addTo(map);
              setLocationState("Centrado en tu posición");
            },
            () => setLocationState("Ubicación no disponible · vista de Madrid"),
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
  }, [requestForecast]);

  useEffect(() => {
    if (!mapReady || !situationLayerRef.current || !mapRef.current) return;
    const map = mapRef.current;
    situationLayerRef.current.eachLayer((layer: any) => {
      const visible = activeKinds[layer.__focoKind as StatusKind];
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) situationLayerRef.current.removeLayer(layer);
    });

    // Re-create removed points so toggles remain reversible.
    const existingNames = new Set<string>();
    situationLayerRef.current.eachLayer((layer: any) => {
      if (layer.__focoName) existingNames.add(layer.__focoName);
    });
    const L = window.L;
    points.forEach((point) => {
      if (!activeKinds[point.kind] || existingNames.has(point.name)) return;
      const meta = kindMeta[point.kind];
      const marker = L.marker([point.lat, point.lon], {
        icon: L.divIcon({
          className: "foco-map-icon",
          html: `<span class="status-marker status-marker--${point.kind}" aria-hidden="true">${meta.icon}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      });
      marker.__focoKind = point.kind;
      marker.__focoName = point.name;
      marker
        .bindPopup(
          `<div class="foco-popup"><span class="popup-kicker" style="color:${meta.color}">${meta.label}</span><strong>${point.name}</strong><p>${point.detail}</p><small>Fuente: parte oficial Comunidad de Madrid</small></div>`,
          { closeButton: false, offset: [0, -9] },
        )
        .on("click", () => requestForecast(point.lat, point.lon, point.name))
        .addTo(situationLayerRef.current);
    });
  }, [activeKinds, mapReady, requestForecast]);

  useEffect(() => {
    if (!mapReady || !airLayerRef.current || !window.L) return;
    const L = window.L;
    airLayerRef.current.clearLayers();
    airStations.forEach((station) => {
      const icon = L.divIcon({
        className: "foco-map-icon",
        html: `<span class="air-marker" style="--air:${station.color}"><b>${station.value === null ? "—" : Math.round(station.value)}</b></span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
      L.marker([station.lat, station.lon], { icon })
        .bindPopup(
          `<div class="foco-popup"><span class="popup-kicker" style="color:${station.color}">Calidad ${station.label}</span><strong>${station.name}</strong><p>${station.pollutant || "Sin dato"}${station.value === null ? "" : ` · ${station.value} µg/m³`}</p><small>${station.hour ? `Dato provisional · ${station.hour} h` : "Sin lectura reciente"} · Red oficial</small></div>`,
          { closeButton: false, offset: [0, -10] },
        )
        .on("click", () => requestForecast(station.lat, station.lon, station.name))
        .addTo(airLayerRef.current);
    });
    if (airVisible && !mapRef.current.hasLayer(airLayerRef.current)) airLayerRef.current.addTo(mapRef.current);
  }, [airStations, airVisible, mapReady, requestForecast]);

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
  }, [airVisible, burntVisible, heatVisible, mapReady]);

  const focusPoint = (point: SituationPoint) => {
    mapRef.current?.setView([point.lat, point.lon], 12);
    requestForecast(point.lat, point.lon, point.name);
  };

  const locateMe = () => {
    if (!navigator.geolocation || !mapRef.current) return;
    setLocationState("Buscando tu posición…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        mapRef.current.setView([latitude, longitude], 12);
        setLocationState("Centrado en tu posición");
      },
      () => setLocationState("No se pudo acceder a tu posición"),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 },
    );
  };

  const fitFire = () => {
    if (!mapRef.current || !window.L) return;
    mapRef.current.fitBounds(
      window.L.latLngBounds(
        points
          .filter((point) => point.kind !== "acogida")
          .map((point) => [point.lat, point.lon]),
      ),
      { padding: [34, 34] },
    );
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="FOCO Madrid">
          <span className="brand-mark"><i></i></span>
          <span>
            <b>FOCO</b>
            <small>MADRID</small>
          </span>
        </div>
        <div className="top-status">
          <span className="live-dot"></span>
          <span>Seguimiento activo</span>
          <i></i>
          <span className="desktop-only">Fuentes oficiales + satélite</span>
        </div>
        <a className="emergency-button" href="tel:112" aria-label="Llamar a emergencias 112">
          <span>Emergencias</span>
          <b>112</b>
        </a>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-scroll">
            <div className="eyebrow-row">
              <span className="eyebrow">SITUACIÓN ACTUAL</span>
              <span className="refresh-time">Parte: {liveStatus.lastUpdated}</span>
            </div>

            <section className="alert-card">
              <div className="alert-level"><span>3</span></div>
              <div>
                <span className="alert-kicker">EMERGENCIA DE INTERÉS NACIONAL</span>
                <h1>Incendio forestal Sierra Oeste</h1>
                <p>Los incendios de Villa del Prado, San Martín de Valdeiglesias y Almorox se tratan como un único incendio.</p>
              </div>
              <a href={OFFICIAL_URL} target="_blank" rel="noreferrer">Parte oficial ↗</a>
            </section>

            <div className="metric-grid" aria-label="Resumen de afectaciones">
              <button className={activeList === "evacuado" ? "active" : ""} onClick={() => setActiveList("evacuado")}>
                <strong>{liveStatus.evacuated.length || 9}</strong>
                <span>evacuados</span>
              </button>
              <button className={activeList === "confinado" ? "active" : ""} onClick={() => setActiveList("confinado")}>
                <strong>2</strong>
                <span>confinados</span>
              </button>
              <button className={activeList === "acogida" ? "active" : ""} onClick={() => setActiveList("acogida")}>
                <strong>{liveStatus.shelters.length || 13}</strong>
                <span>acogida</span>
              </button>
              <div>
                <strong>{liveStatus.roads.length || 10}</strong>
                <span>carreteras</span>
              </div>
            </div>

            <section className="location-section">
              <div className="section-title">
                <h2>{kindMeta[activeList].label}{activeList === "evacuado" ? "s" : activeList === "confinado" ? "s" : ""}</h2>
                <button
                  className={`layer-switch layer-switch--${activeList}`}
                  aria-pressed={activeKinds[activeList]}
                  onClick={() => setActiveKinds((previous) => ({ ...previous, [activeList]: !previous[activeList] }))}
                >
                  {activeKinds[activeList] ? "Visible" : "Oculto"}
                </button>
              </div>
              <div className="location-list">
                {visiblePoints.map((point) => (
                  <button key={point.name} onClick={() => focusPoint(point)}>
                    <span className={`list-symbol list-symbol--${point.kind}`}>{kindMeta[point.kind].icon}</span>
                    <span>
                      <b>{point.name}</b>
                      <small>{point.kind === "acogida" ? "Centro habilitado" : point.kind === "confinado" ? "Permanecer a resguardo" : "Evacuación comunicada"}</small>
                    </span>
                    <i>⌖</i>
                  </button>
                ))}
              </div>
            </section>

            <section className="sources-card">
              <div>
                <span className="eyebrow">CANALES EN DIRECTO</span>
                <span className="verified">Verificados</span>
              </div>
              <a href="https://x.com/112cmadrid" target="_blank" rel="noreferrer">
                <span className="source-icon">X</span>
                <span><b>@112cmadrid</b><small>Avisos operativos y ES-Alert</small></span>
                <i>↗</i>
              </a>
              <a href={OFFICIAL_URL} target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--cm">CM</span>
                <span><b>Comunidad de Madrid</b><small>Parte consolidado de la emergencia</small></span>
                <i>↗</i>
              </a>
              <a href="https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/" target="_blank" rel="noreferrer">
                <span className="source-icon source-icon--eu">EU</span>
                <span><b>Copernicus EFFIS</b><small>Detección y superficie por satélite</small></span>
                <i>↗</i>
              </a>
            </section>

            <p className="safety-note">
              Este visor es informativo. Ante una emergencia sigue ES-Alert, las instrucciones oficiales y llama al 112.
            </p>
          </div>
        </aside>

        <section className="map-pane" aria-label="Mapa de incendios de Madrid">
          <div ref={mapNodeRef} className="map-canvas" />
          {!mapReady && !mapError && <div className="map-loading"><span></span><b>Preparando el mapa en directo…</b></div>}
          {mapError && <div className="map-error"><b>{mapError}</b><p>Comprueba tu conexión y vuelve a cargar.</p></div>}

          <div className="map-toolbar" aria-label="Capas del mapa">
            <button className={heatVisible ? "active fire" : ""} onClick={() => setHeatVisible(!heatVisible)}>
              <span></span> Calor VIIRS
            </button>
            <button className={burntVisible ? "active burnt" : ""} onClick={() => setBurntVisible(!burntVisible)}>
              <span></span> Superficie EFFIS
            </button>
            <button className={airVisible ? "active air" : ""} onClick={() => setAirVisible(!airVisible)}>
              <span></span> Calidad del aire
            </button>
          </div>

          <div className="map-actions">
            <button onClick={locateMe} title="Centrar en mi posición" aria-label="Centrar en mi posición">◎</button>
            <button onClick={fitFire}>Ver incendio</button>
          </div>

          <div className="position-pill">
            <span>◎</span>
            {locationState}
          </div>

          <div className="map-legend">
            <b>LEYENDA</b>
            <span><i className="legend-dot legend-dot--evacuado"></i> Evacuado</span>
            <span><i className="legend-dot legend-dot--confinado"></i> Confinado</span>
            <span><i className="legend-dot legend-dot--acogida"></i> Acogida</span>
            <span><i className="legend-air"></i> Aire</span>
          </div>

          {!panelOpen && (
            <button className="forecast-hint" onClick={() => requestForecast(40.4168, -3.7038, "Madrid")}>
              <span>↘</span>
              <b>Pulsa cualquier punto del mapa</b>
              <small>Verás sol, viento y lluvia por horas</small>
            </button>
          )}

          <section className={`forecast-panel ${panelOpen ? "open" : ""}`} aria-live="polite">
            <div className="forecast-heading">
              <div>
                <span className="eyebrow">METEOROLOGÍA DEL PUNTO</span>
                <h2>{selectedPoint?.label || "Punto seleccionado"}</h2>
                {selectedPoint && <small>{selectedPoint.lat.toFixed(4)}, {selectedPoint.lon.toFixed(4)} · Open‑Meteo</small>}
              </div>
              <button onClick={() => setPanelOpen(false)} aria-label="Cerrar previsión">×</button>
            </div>

            <div className="hourly-strip">
              {forecastState === "loading" &&
                Array.from({ length: 8 }).map((_, index) => <div className="hour-card hour-card--loading" key={index}></div>)}
              {forecastState === "error" && (
                <div className="forecast-message">No se pudo obtener la previsión. Pulsa otro punto para reintentarlo.</div>
              )}
              {forecastState === "ready" &&
                forecast.map((hour, index) => {
                  const date = new Date(hour.time);
                  const sunIcon = hour.rainProbability >= 55 ? "☂" : hour.cloud >= 70 ? "☁" : hour.cloud >= 35 ? "◒" : "☀";
                  return (
                    <div className={`hour-card ${index === 0 ? "now" : ""}`} key={hour.time}>
                      <div className="hour-top">
                        <b>{index === 0 ? "Ahora" : date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</b>
                        <span>{sunIcon}</span>
                      </div>
                      <div className="weather-row sun">
                        <span>☀</span>
                        <p><small>Sol</small><strong>{hour.sunMinutes} min</strong></p>
                      </div>
                      <div className="weather-row wind">
                        <span style={{ transform: `rotate(${hour.windDirection}deg)` }}>↑</span>
                        <p><small>Viento {compass(hour.windDirection)}</small><strong>{hour.wind} km/h</strong></p>
                      </div>
                      <div className="weather-row rain">
                        <span>●</span>
                        <p><small>Lluvia</small><strong>{hour.rainProbability}% <em>{hour.rain.toFixed(1)} mm</em></strong></p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
