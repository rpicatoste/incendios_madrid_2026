export type StatusKind = "evacuado" | "confinado" | "acogida" | "seguimiento";

export type SituationPoint = {
  id: string;
  name: string;
  province: string;
  kind: StatusKind;
  lat: number;
  lon: number;
  detail: string;
  source: string;
  sourceLabel: string;
  sourceUpdatedAt: string;
};

export type FireIncident = {
  id: string;
  name: string;
  provinces: string;
  lat: number;
  lon: number;
  radiusKm: number;
  areaHectares?: number;
  hasMappedPerimeter?: boolean;
  level: string;
  status: string;
  detail: string;
  source: string;
  sourceLabel: string;
  sourceUpdatedAt: string;
};

export type RegionData = {
  updatedAt: string;
  points: SituationPoint[];
  fires: FireIncident[];
  unmappedLocations?: string[];
};

const MADRID_SOURCE =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";
const DSN_SOURCE =
  "https://www.dsn.gob.es/gl/node/32742";
const CLM_SOURCE =
  "https://www.castillalamancha.es/actualidad/notasdeprensa/castilla-la-mancha-moviliza-un-amplio-operativo-para-hacer-frente-los-incendios-registrados-en-la";
const GUADALAJARA_STATUS_SOURCE =
  "https://www.castillalamancha.es/actualidad/notasdeprensa/castilla-la-mancha-refuerza-el-operativo-frente-al-incendio-de-la-mierla-guadalajara-con-un";

const guadalajaraPoint = (
  id: string,
  name: string,
  kind: Extract<StatusKind, "evacuado" | "confinado">,
  lat: number,
  lon: number,
): SituationPoint => ({
  id: "guadalajara-" + id,
  name,
  province: "Guadalajara",
  kind,
  lat,
  lon,
  detail:
    kind === "evacuado"
      ? "Evacuación publicada el 20 de julio. Las actualizaciones nominales del 22 y 23 no incluyen esta localidad entre los retornos autorizados."
      : "Confinamiento publicado el 20 de julio; no consta un levantamiento nominal en las actualizaciones oficiales posteriores consultadas.",
  source: GUADALAJARA_STATUS_SOURCE,
  sourceLabel: "Gobierno de Castilla-La Mancha",
  sourceUpdatedAt: "20 jul · última relación nominal",
});

const guadalajaraEvacuations: SituationPoint[] = [
  guadalajaraPoint("semillas", "Semillas", "evacuado", 41.0591279, -3.1196781),
  guadalajaraPoint("la-nava-jadraque", "La Nava de Jadraque", "evacuado", 40.9134865, -2.8673216),
  guadalajaraPoint("umbralejo", "Umbralejo", "evacuado", 41.1305941, -3.1721405),
  guadalajaraPoint("arroyo-fraguas", "Arroyo de las Fraguas", "evacuado", 41.1030119, -3.1317598),
  guadalajaraPoint("navas-jadraque", "Las Navas de Jadraque", "evacuado", 41.1047907, -3.0876036),
  guadalajaraPoint("el-ordial", "El Ordial", "evacuado", 41.1280743, -3.1146297),
  guadalajaraPoint("zarzuela-jadraque", "Zarzuela de Jadraque", "evacuado", 41.0682961, -3.043864),
  guadalajaraPoint("villares-jadraque", "Villares de Jadraque", "evacuado", 41.1012805, -3.0257919),
  guadalajaraPoint("bustares", "Bustares", "evacuado", 41.1357889, -3.0727214),
  guadalajaraPoint("veguillas", "Veguillas", "evacuado", 40.9959949, -3.0712672),
  guadalajaraPoint("pradena-atienza", "Prádena de Atienza", "evacuado", 41.1726056, -3.0064613),
  guadalajaraPoint("gascuena-bornova", "Gascueña de Bornova", "evacuado", 41.142023, -3.0195572),
  guadalajaraPoint("robledo-corpes", "Robledo de Corpes", "evacuado", 41.1153549, -2.9462408),
  guadalajaraPoint("aldeanueva-atienza", "Aldeanueva de Atienza", "evacuado", 41.1671915, -3.096058),
  guadalajaraPoint("naharros", "Naharros", "evacuado", 41.162857, -2.9150256),
  guadalajaraPoint("la-bodera", "La Bodera", "evacuado", 41.1350877, -2.8872198),
  guadalajaraPoint("hiendelaencina", "Hiendelaencina", "evacuado", 41.0835841, -3.0036605),
  guadalajaraPoint("san-andres-congosto", "San Andrés del Congosto", "evacuado", 40.9999435, -3.027599),
  guadalajaraPoint("congostrina", "Congostrina", "evacuado", 41.0370177, -2.9866265),
];

const guadalajaraConfinements: SituationPoint[] = [
  guadalajaraPoint("albendiego", "Albendiego", "confinado", 41.2272366, -3.0524038),
  guadalajaraPoint("ujados", "Ujados", "confinado", 41.2350711, -3.0057336),
  guadalajaraPoint("canamares", "Cañamares", "confinado", 41.2100181, -2.9494131),
  guadalajaraPoint("tordelloso", "Tordelloso", "confinado", 41.2061794, -2.9197618),
  guadalajaraPoint("la-minosa", "La Miñosa", "confinado", 41.1793692, -2.9321633),
];

const madridPoint = (
  id: string,
  name: string,
  kind: StatusKind,
  lat: number,
  lon: number,
  detail: string,
): SituationPoint => ({
  id,
  name,
  province: "Madrid",
  kind,
  lat,
  lon,
  detail,
  source: MADRID_SOURCE,
  sourceLabel: "Comunidad de Madrid",
  sourceUpdatedAt: "24 jul · 23:30",
});

export const defaultRegionData: RegionData = {
  updatedAt: "25 de julio de 2026 · fuentes consolidadas hasta las 08:00",
  points: [
    madridPoint("camping-escorial", "Camping El Escorial", "evacuado", 40.5905, -4.147, "Desalojo preventivo comunicado en el parte autonómico."),
    madridPoint("navas-rey", "Navas del Rey", "evacuado", 40.3869, -4.251, "Municipio incluido en la relación oficial de evacuados."),
    madridPoint("chapineria", "Chapinería", "evacuado", 40.3788, -4.2093, "Evacuación comunicada mediante ES-Alert."),
    madridPoint("colmenar-arroyo", "Colmenar del Arroyo", "evacuado", 40.4191, -4.1983, "Evacuación comunicada mediante ES-Alert."),
    madridPoint("aldea-fresno", "Aldea del Fresno", "evacuado", 40.323, -4.203, "Municipio incluido en la relación oficial de evacuados."),
    madridPoint("robledo-chavela", "Robledo de Chavela", "evacuado", 40.5006, -4.2375, "Municipio incluido en la relación oficial de evacuados."),
    madridPoint("fresnedillas", "Fresnedillas de la Oliva", "evacuado", 40.4875, -4.1716, "Traslado hacia centros habilitados."),
    madridPoint("navalagamella", "Navalagamella", "evacuado", 40.4689, -4.124, "Municipio incluido en la relación oficial de evacuados."),
    madridPoint("zarzalejo", "Zarzalejo", "evacuado", 40.5488, -4.1816, "Municipio incluido en la relación oficial de evacuados."),
    madridPoint("san-martin", "San Martín de Valdeiglesias", "confinado", 40.3611, -4.3983, "ES-Alert: permanecer en el interior del casco urbano y a resguardo."),
    madridPoint("pelayos", "Pelayos de la Presa", "confinado", 40.3609, -4.3349, "ES-Alert: permanecer en el interior del casco urbano y a resguardo."),
    madridPoint("villaviciosa", "Villaviciosa de Odón", "acogida", 40.3579, -3.9008, "Punto de acogida habilitado."),
    madridPoint("mostoles", "Móstoles", "acogida", 40.3223, -3.8649, "Punto de acogida habilitado."),
    madridPoint("brunete", "Brunete", "acogida", 40.4053, -3.9976, "Punto de acogida habilitado."),
    madridPoint("leganes", "Leganés", "acogida", 40.3281, -3.7644, "Punto de acogida habilitado."),
    madridPoint("villanueva-canada", "Villanueva de la Cañada", "acogida", 40.4469, -4.0043, "Punto de acogida habilitado."),
    madridPoint("villanueva-perales", "Villanueva de Perales", "acogida", 40.3467, -4.1018, "Punto de acogida habilitado."),
    madridPoint("villamantilla", "Villamantilla", "acogida", 40.3388, -4.1303, "Punto de acogida habilitado."),
    madridPoint("villamanta", "Villamanta", "acogida", 40.2988, -4.1081, "Punto de acogida habilitado."),
    madridPoint("las-rozas", "Las Rozas", "acogida", 40.4929, -3.8737, "Punto de acogida habilitado."),
    madridPoint("alcorcon", "Alcorcón", "acogida", 40.3458, -3.8249, "Punto de acogida habilitado."),
    {
      id: "burgohondo",
      name: "Burgohondo",
      province: "Ávila",
      kind: "evacuado",
      lat: 40.414,
      lon: -4.785,
      detail: "El parte nacional informa de desalojos por el incendio de Burgohondo.",
      source: DSN_SOURCE,
      sourceLabel: "Departamento de Seguridad Nacional",
      sourceUpdatedAt: "24 jul · 08:00",
    },
    {
      id: "navaluenga",
      name: "Navaluenga",
      province: "Ávila",
      kind: "evacuado",
      lat: 40.411,
      lon: -4.709,
      detail: "Localidad incluida en los desalojos comunicados por el parte nacional.",
      source: DSN_SOURCE,
      sourceLabel: "Departamento de Seguridad Nacional",
      sourceUpdatedAt: "24 jul · 08:00",
    },
    {
      id: "el-tiemblo",
      name: "El Tiemblo",
      province: "Ávila",
      kind: "evacuado",
      lat: 40.415,
      lon: -4.501,
      detail: "Localidad incluida en los desalojos comunicados por el parte nacional.",
      source: DSN_SOURCE,
      sourceLabel: "Departamento de Seguridad Nacional",
      sourceUpdatedAt: "24 jul · 08:00",
    },
    {
      id: "la-mierla",
      name: "La Mierla",
      province: "Guadalajara",
      kind: "seguimiento",
      lat: 40.953,
      lon: -3.236,
      detail: "Operativo activo en la Sierra Norte. Se autorizó el regreso de los vecinos previamente evacuados.",
      source: CLM_SOURCE,
      sourceLabel: "Gobierno de Castilla-La Mancha",
      sourceUpdatedAt: "23 jul",
    },
    ...guadalajaraEvacuations,
    ...guadalajaraConfinements,
    {
      id: "almorox",
      name: "Almorox",
      province: "Toledo",
      kind: "seguimiento",
      lat: 40.234,
      lon: -4.391,
      detail: "Incendio limítrofe con Madrid, tratado junto al avance hacia Villa del Prado.",
      source: DSN_SOURCE,
      sourceLabel: "Departamento de Seguridad Nacional",
      sourceUpdatedAt: "24 jul · 08:00",
    },
  ],
  fires: [
    {
      id: "sierra-oeste",
      name: "Sierra Oeste",
      provinces: "Madrid · Toledo",
      lat: 40.37,
      lon: -4.34,
      radiusKm: 15,
      level: "Nivel 3",
      status: "Emergencia de interés nacional",
      detail: "Agrupa los incendios de Villa del Prado, San Martín de Valdeiglesias y Almorox.",
      source: DSN_SOURCE,
      sourceLabel: "Departamento de Seguridad Nacional",
      sourceUpdatedAt: "24 jul · 08:00",
    },
    {
      id: "burgohondo-fire",
      name: "Burgohondo",
      provinces: "Ávila",
      lat: 40.414,
      lon: -4.785,
      radiusKm: 9,
      level: "Nivel 3",
      status: "Emergencia de interés nacional",
      detail: "Incendio con desalojos en Burgohondo, Navaluenga y El Tiemblo.",
      source: DSN_SOURCE,
      sourceLabel: "Departamento de Seguridad Nacional",
      sourceUpdatedAt: "24 jul · 08:00",
    },
    {
      id: "la-mierla-fire",
      name: "La Mierla",
      provinces: "Guadalajara",
      lat: 40.953,
      lon: -3.236,
      radiusKm: 11,
      areaHectares: 32000,
      hasMappedPerimeter: true,
      level: "Seguimiento",
      status: "Evolución favorable; operativo desplegado",
      detail: "Gran incendio de la Sierra Norte de Guadalajara. La fuente autonómica cifra unas 32.000 ha afectadas; el mapa superpone la delimitación oficial disponible de Copernicus EMS.",
      source: CLM_SOURCE,
      sourceLabel: "Gobierno de Castilla-La Mancha",
      sourceUpdatedAt: "23 jul",
    },
  ],
};
