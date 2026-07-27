# Continuidad de FOCO Centro

Este documento permite retomar el proyecto desde un Codex CLI nuevo en
Numebox. No contiene tokens, claves ni cookies.

## Entorno canónico

- Repositorio: `/home/rpica/workspace/incendios_madrid_2026`
- Rama: `main`
- Remoto: `git@github.com:rpicatoste/incendios_madrid_2026.git`
- Node: `/home/rpica/.local/node-v22/bin/node`
- Datos persistentes: `/home/rpica/workspace/incendios_madrid_2026/data`
- URL pública canónica: `https://incendios-madrid.rpica.net`

La carpeta `data` y el archivo `.env` no se deben borrar, copiar a Git ni
mostrar en la salida de comandos. El túnel nombrado `cloudflared.service` debe
permanecer activo siempre que sea posible. El antiguo quick tunnel
`foco-cloudflared.service` está deshabilitado y no se debe reactivar.

## Servicios

- `foco-app.service`: aplicación, solo escucha en `127.0.0.1:3000`.
- `cloudflared.service`: túnel nombrado que publica la URL canónica.
- `foco-snapshotter.service`: activa una captura cada cinco minutos; se crea un
  snapshot inmutable en la primera captura de cada hora.

Comprobación rápida:

```bash
systemctl --user is-active foco-app.service cloudflared.service foco-snapshotter.service
curl -fsS http://127.0.0.1:3000/api/satellite?hour=live\&layer=manifest | jq .
```

## Estado funcional

- Mapa móvil/reactivo centrado en la geolocalización del usuario.
- Leyenda interactiva para evacuación, confinamiento, acogida, seguimiento,
  área recorrida EFFIS, frente Copernicus, actividad VIIRS, humo, calidad del
  aire, zonas aproximadas y posición del usuario.
- Previsión horaria compacta para cualquier punto, incluso dentro de las zonas
  aproximadas, con temperatura y símbolos meteorológicos legibles. La flecha
  azul del punto, las flechas horarias y las partículas apuntan hacia donde se
  desplaza el aire. Open-Meteo expresa de dónde viene: FOCO suma 180° para la
  representación con punta y muestra el texto accesible «desde… hacia…».
- Visualización ambiental opcional de viento, apagada por defecto. Mientras está
  apagada no consulta Open-Meteo ni anima. Al activarla muestra trazos azules con
  halo blanco: 18 partículas en móvil o 34 en escritorio, limitadas a 15 FPS,
  pausadas con la pestaña oculta y desactivadas para `prefers-reduced-motion`.
- Navegación entre snapshots horarios y vivo. La consulta periódica descarga
  solo el índice ligero; cada snapshot completo se obtiene y cachea únicamente
  al seleccionarlo.
- Evacuaciones y confinamientos de Madrid reconstruidos automáticamente desde
  la página oficial. Fuera de Madrid se conservan relaciones nominales
  oficiales fechadas: JCyL, FIDIAS/CLM y RAN no ofrecen actualmente una fuente
  estructurada equivalente y FOCO nunca infiere localidades afectadas.
- Pestaña `Actualidad` con estados de Sierra Oeste, Burgohondo y La Mierla,
  además de publicaciones filtradas de fuentes oficiales.
- Copernicus integra EMSR900 y EMSR898: Brieva, Villa del Prado, La Atalaya, La
  Mierla y Selas. Cada área, frente y llama conserva el producto y la hora de
  observación propios; los círculos aproximados solo desaparecen cuando existe
  una correspondencia explícita con el perímetro oficial. El servidor conserva
  los GeoJSON originales exactos en `data/cache/copernicus-original/` con modo
  privado y entrega una versión drásticamente simplificada: elimina componentes
  pequeños y agujeros, redondea y simplifica bordes. Una versión estable evita
  volver a descargar la misma geometría en cada refresco del manifiesto.
- El área EFFIS principal es GeoJSON estructurado de los últimos 30 días y queda
  congelado en cada snapshot v4. El PNG 4096×2731 es un respaldo legado que se
  intenta cada seis horas. Hotspots y humo se cachean a 1600×1067 desde NASA
  GIBS. Las capturas rechazan PNG transparentes, buscan hasta dos fechas
  anteriores para los productos diarios y guardan la fecha real del producto.
  Un fallo conserva únicamente una copia anterior válida y la marca `stale`.
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
- Copernicus EMSR900 y EMSR898: áreas, frentes y llamas de todas las AOI con
  productos entregados; metadatos cacheados quince minutos.
- EFFIS: área recorrida. La API vectorial se comprueba como máximo una vez por
  hora; el ráster WMS legado, cada seis horas. La interfaz muestra por separado
  lectura, fecha del producto y última modificación real en la zona.
- NASA GIBS: detecciones térmicas VIIRS de NOAA-20 y Suomi NPP, más
  humo/aerosoles VIIRS. La captura reutiliza calor durante 30 minutos y humo
  durante 6 horas; las URLs versionadas permiten que navegador/proxy conserven
  indefinidamente una copia que ya descargaron.
- MITECO: sensores de calidad del aire; caché y refresco cada quince minutos.
  La hora de observación se muestra en horario peninsular y se avisa si supera
  tres horas. Si la fuente deja índices vacíos, se conserva sin límite temporal
  destructivo la última lectura válida conocida por estación, incluida la de los
  snapshots, y se marca como recuperada. Una caché vencida se sirve de inmediato
  mientras un único proceso refresca en segundo plano. La caché general y
  `data/cache/air-quality-last-valid.json` se escriben de forma atómica con
  modo `0600`. Producción
  carga la autoridad intermedia pública de FNMT desde `ops/fnmt-components.pem`; la
  validación TLS nunca se desactiva.
- Open-Meteo: previsión puntual solicitada por el navegador; se renueva cada
  quince minutos mientras el panel del punto permanece abierto. El viento
  ambiental de Madrid se renueva cada treinta minutos para las partículas.
- El navegador renueva estado cada dos minutos y región, noticias, manifiesto
  satelital e índice de snapshots cada cinco minutos; también refresca al volver
  a primer plano o recuperar conexión. Región usa caché persistente de cinco
  minutos y stale-while-revalidate, evitando geocodificar resúmenes estadísticos.

- Analítica: el navegador registra como máximo una señal por sesión. El servidor
  agrupa ventanas de treinta minutos y países aproximados, sin persistir IP,
  agente de navegador ni páginas. El panel consulta por POST con comparación de
  clave en tiempo constante y no guarda la clave en el navegador.

## Flujo seguro de cambios

1. Trabajar en un checkout aislado; no editar la carpeta `data`.
2. Ejecutar `npm test`, `npm run lint`, `git diff --check` y
   `npm audit --omit=dev`. Las pruebas construyen en `/tmp` y no alteran el
   `dist` que sirve producción.
3. Construir con Node 22.
4. Subir a `main`.
5. Preparar `dist` antes de tocar producción y cambiarlo con un rename.
6. Reiniciar solo `foco-app.service`; comprobar `127.0.0.1:3000` y la URL
   pública. No reiniciar Cloudflare.
7. Si cambia una captura, reiniciar `foco-snapshotter.service` para forzar una
   lectura y validar manifiesto, dimensiones y errores.

Los artefactos de reversión se guardan en `var/releases/`; se conserva al menos
el despliegue anterior validado y nunca se incluyen en Git ni en ESLint.

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
