# Continuidad de FOCO Centro

Este documento permite retomar el proyecto desde un Codex CLI nuevo en
Numebox. No contiene tokens, claves ni cookies.

## Entorno canónico

- Repositorio: `/home/rpica/workspace/incendios_madrid_2026`
- Rama: `main`
- Remoto: `git@github.com:rpicatoste/incendios_madrid_2026.git`
- Node: `/home/rpica/.local/node-v22/bin/node`
- Datos persistentes: `/home/rpica/workspace/incendios_madrid_2026/data`
- URL pública actual:
  `https://managers-brunswick-titanium-strategies.trycloudflare.com`

La carpeta `data` y el archivo `.env` no se deben borrar, copiar a Git ni
mostrar en la salida de comandos. El túnel `foco-cloudflared.service` no debe
reiniciarse salvo petición expresa: TryCloudflare asignaría otra URL.

## Servicios

- `foco-app.service`: aplicación, solo escucha en `127.0.0.1:3000`.
- `foco-cloudflared.service`: túnel público a ese puerto.
- `foco-snapshotter.service`: activa una captura cada cinco minutos; se crea un
  snapshot inmutable en la primera captura de cada hora.

Comprobación rápida:

```bash
systemctl --user is-active foco-app.service foco-cloudflared.service foco-snapshotter.service
curl -fsS http://127.0.0.1:3000/api/satellite?hour=live\&layer=manifest | jq .
```

## Estado funcional

- Mapa móvil/reactivo centrado en la geolocalización del usuario.
- Leyenda interactiva para evacuación, confinamiento, acogida, seguimiento,
  área recorrida EFFIS, frente Copernicus, actividad VIIRS, humo, calidad del
  aire, zonas aproximadas y posición del usuario.
- Previsión horaria compacta para cualquier punto, incluso dentro de las zonas
  aproximadas.
- Navegación entre snapshots horarios y vivo.
- Evacuaciones y confinamientos de Madrid reconstruidos automáticamente desde
  la página oficial; Ávila/otras regiones siguen dependiendo de los datos
  disponibles en sus fuentes.
- Pestaña `Actualidad` con estados de Sierra Oeste, Burgohondo y La Mierla,
  además de publicaciones filtradas de fuentes oficiales.
- La Mierla usa el perímetro vectorial oficial Copernicus EMSR898.
- El área EFFIS se cachea como PNG 4096×2731. Hotspots y humo se cachean a
  1600×1067 desde NASA GIBS. Las capturas rechazan PNG transparentes, buscan
  hasta dos fechas anteriores para los productos diarios y guardan la fecha
  real del producto en el manifiesto v3. Un fallo conserva únicamente una
  copia anterior con píxeles visibles y la marca como `stale`.
- Cada snapshot congela por valor el estado, los puntos regionales, los
  sensores de aire, los rásteres satelitales y el GeoJSON de Copernicus.
  Un snapshot histórico sin copia congelada no consulta capas remotas después.
- Analítica propia y privada en `/visitas`: cuenta sesiones aproximadas sin
  cookies, respeta DNT/GPC y conserva solo HMAC diarios y agregados durante 90
  días. La clave se guarda fuera de Git en `data/analytics-access.txt`, modo
  `0600`, y nunca se enlaza desde la interfaz pública.

## Fuentes y actualización

- Comunidad de Madrid: estado, evacuaciones, confinamientos, acogida y cortes;
  caché de dos minutos.
- X público: `@112cmadrid`, `@Plan_INFOCAM`, `@112cyl`, `@UMEgob`; caché de
  cinco minutos.
- FIDIAS Castilla-La Mancha: ficha de La Mierla.
- Datos Abiertos JCyL: parte estructurado de Burgohondo.
- Copernicus EMSR898: área y frente de La Mierla.
- EFFIS WMS: área recorrida.
- NASA GIBS: detecciones térmicas VIIRS de NOAA-20 y Suomi NPP, más
  humo/aerosoles VIIRS.
- MITECO: sensores de calidad del aire; caché y refresco cada quince minutos.
  La hora de observación se muestra en horario peninsular, se avisa si supera
  tres horas de antigüedad y, si la fuente deja índices vacíos, se conservan
  durante un máximo de doce horas las últimas lecturas válidas. La caché general
  y `data/cache/air-quality-last-valid.json` se escriben de forma atómica con
  modo `0600`. Los refrescos simultáneos comparten un bloqueo corto. Producción
  carga la autoridad intermedia pública de FNMT desde `ops/fnmt-components.pem`; la
  validación TLS nunca se desactiva.
- Open-Meteo: previsión puntual solicitada por el navegador; se renueva cada
  quince minutos mientras el panel del punto permanece abierto.
- El navegador renueva estado cada dos minutos y región, noticias, manifiesto
  satelital y lista de snapshots cada cinco minutos; también refresca al volver
  a primer plano o recuperar conexión.

- Analítica: el navegador registra como máximo una señal por sesión. El servidor
  agrupa ventanas de treinta minutos y países aproximados, sin persistir IP,
  agente de navegador ni páginas. El panel consulta por POST con comparación de
  clave en tiempo constante y no guarda la clave en el navegador.

## Flujo seguro de cambios

1. Trabajar en un checkout aislado; no editar la carpeta `data`.
2. Ejecutar `npm test`, `git diff --check` y `npm audit --omit=dev`.
3. Construir con Node 22.
4. Subir a `main`.
5. Preparar `dist` antes de tocar producción y cambiarlo con un rename.
6. Reiniciar solo `foco-app.service`; comprobar `127.0.0.1:3000` y la URL
   pública. No reiniciar Cloudflare.
7. Si cambia una captura, reiniciar `foco-snapshotter.service` para forzar una
   lectura y validar manifiesto, dimensiones y errores.

La superficie pública debe seguir siendo de solo lectura salvo la señal vacía y
anónima de `/api/analytics/visit`. `/api/snapshots` acepta POST únicamente con el
token interno y responde 404 a visitantes. `/api/analytics` responde 404 sin su
clave privada; su GET no expone datos. Los POST permitidos están enumerados por
ruta exacta en `worker/index.ts`. Las URLs de fuentes se mantienen fijadas en el
servidor para evitar SSRF.

## Retomar con Codex CLI

Desde Numebox:

```bash
cd /home/rpica/workspace/incendios_madrid_2026
codex -C "$PWD" "Lee docs/CODEX_HANDOFF.md completo, comprueba git y los servicios, y espera mi siguiente petición sin modificar nada."
```

`codex resume` solo ve las sesiones guardadas en el host donde se ejecuta. Una
tarea creada en la app de escritorio no aparece automáticamente como sesión
CLI en Numebox; este archivo es el traspaso reproducible.
