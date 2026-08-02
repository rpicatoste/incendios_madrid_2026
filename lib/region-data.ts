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
  sourceObservedAt: string;
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
  sourceObservedAt: string;
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
const GUADALAJARA_RESTRICTIONS_LIFTED_SOURCE =
  "https://www.castillalamancha.es/actualidad/notasdeprensa/se-ordena-el-levantamiento-de-confinamientos-por-el-incendio-de-la-mierla-y-la-totalidad-de-los";

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
  sourceObservedAt: "2026-07-24T23:30:00+02:00",
});

export const defaultRegionData: RegionData = {
  updatedAt: "26 de julio de 2026 · fuentes consolidadas",
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
      sourceObservedAt: "2026-07-24T08:00:00+02:00",
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
      sourceObservedAt: "2026-07-24T08:00:00+02:00",
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
      sourceObservedAt: "2026-07-24T08:00:00+02:00",
    },
    {
      id: "la-mierla",
      name: "La Mierla",
      province: "Guadalajara",
      kind: "seguimiento",
      lat: 40.953,
      lon: -3.236,
      detail: "Seguimiento del incendio de la Sierra Norte. El 26 de julio se levantaron todas las evacuaciones, confinamientos y restricciones de carretera.",
      source: GUADALAJARA_RESTRICTIONS_LIFTED_SOURCE,
      sourceLabel: "Gobierno de Castilla-La Mancha",
      sourceUpdatedAt: "26 jul",
      sourceObservedAt: "2026-07-26T12:00:00+02:00",
    },
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
      sourceObservedAt: "2026-07-24T08:00:00+02:00",
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
      sourceObservedAt: "2026-07-24T08:00:00+02:00",
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
      sourceObservedAt: "2026-07-24T08:00:00+02:00",
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
      sourceObservedAt: "2026-07-23T12:00:00+02:00",
    },
  ],
};
