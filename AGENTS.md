# FOCO Centro — guía para agentes

## Objetivo y producción

FOCO Centro es un mapa operativo de incendios, evacuaciones, confinamientos,
calidad del aire, meteorología y capas satelitales para la zona centro de
España.

- URL pública canónica: `https://incendios-madrid.rpica.net`
- Aplicación local: `foco-app.service`, en `127.0.0.1:3000`
- Capturas: `foco-snapshotter.service`
- Túnel nombrado: `cloudflared.service`
- El antiguo `foco-cloudflared.service` está deshabilitado y no debe reactivarse.
- Node canónico: `/home/rpica/.local/node-v22/bin/node` (el proyecto requiere
  Node 22; comprobar la versión antes de ejecutar scripts `npm`).
- Datos persistentes: `data/`
- Secretos locales: `.env` y `data/analytics-access.txt`

No mostrar, borrar, sobrescribir ni añadir a Git secretos o datos persistentes.
No reiniciar servicios ajenos a FOCO.

## Premisa de disponibilidad

La web servida debe permanecer disponible siempre que sea posible. Nunca
construir directamente sobre el `dist` que usa producción.

1. Preparar y probar los cambios en una copia secundaria o directorio temporal.
2. Ejecutar `npm test`, `npm run lint`, `git diff --check` y
   `npm audit --omit=dev`.
3. Construir un artefacto desde el commit exacto ya subido.
4. Dejar el artefacto completo preparado antes de tocar `dist`.
5. Cambiar `dist` mediante renombrados y conservar el artefacto anterior en
   `var/releases/`.
6. Reiniciar únicamente `foco-app.service` después de validar la versión
   secundaria. El corte debe limitarse al reinicio.
7. Reiniciar `foco-snapshotter.service` solo cuando cambie la lógica de captura.
8. No reiniciar `cloudflared.service` salvo necesidad operativa comprobada.
9. Validar después el origen local y la URL pública, incluidos sus assets y APIs.

Si el nuevo proceso o sus comprobaciones fallan, restaurar el artefacto anterior
y volver a iniciar `foco-app.service`.

## Reglas funcionales importantes

- La capa de humo empieza desactivada.
- Los pines de situación no solicitan previsión; las grandes áreas aproximadas
  de incendio y los clics libres en el mapa sí pueden hacerlo.
- El indicador de previsión puntual, las flechas horarias y las partículas
  apuntan hacia donde se desplaza el aire. Open-Meteo entrega la dirección de
  origen meteorológica: convertirla siempre sumando 180° antes de dibujar una
  flecha con punta o animar el movimiento.
- La capa de viento empieza desactivada: mientras siga apagada no solicita el
  campo ambiental ni ejecuta animación. Al activarla descarga bajo demanda una
  malla 9×7 compartida por el servidor y cacheada una hora; no hay precalentado
  ni consultas sin usuarios. El navegador interpola el vector local y usa
  partículas de vida corta: 54 en móvil o 102 en escritorio, limitadas a 15 FPS,
  pausadas con la pestaña oculta y respetando `prefers-reduced-motion`.
- Fuera de Madrid no inferir evacuaciones o confinamientos desde perímetros,
  niveles o proximidad: exigir una relación oficial nominal o estructurada.
- La vista activa solo muestra órdenes, puntos y observaciones con una fecha de
  fuente u observación de 48 horas como máximo. La hora a la que FOCO descarga
  o procesa un dato nunca renueva su vigencia. Todo lo anterior se conserva en
  la capa histórica, apagada por defecto.
- Separar siempre el estado del incendio de las medidas sobre población: un
  incendio puede seguir activo, estabilizado o en control sin que continúen las
  evacuaciones, confinamientos o puntos de acogida anteriores.
- Los snapshots históricos deben ser inmutables y no consultar fuentes remotas.
- Una captura remota inválida o transparente no sustituye una copia válida.
- Una capa conservada debe marcarse como desactualizada y exponer la fecha real
  de su fuente.
- Conservar en disco privado los GeoJSON originales de Copernicus; servir al
  navegador únicamente la geometría drásticamente simplificada y versionada.
- La lista de snapshots solo entrega identificador y hora; cargar el contenido
  completo de un snapshot histórico únicamente cuando el usuario lo selecciona.
- La analítica privada no guarda IP, agente ni rutas en claro, respeta DNT/GPC y
  nunca enlaza públicamente `/visitas`.
- Las mutaciones públicas permanecen denegadas salvo la señal anónima y vacía de
  `/api/analytics/visit`.

## Fuentes y cadencias actuales

- Estado de Madrid: 2 minutos.
- Región, noticias, manifiesto satelital y snapshots: 5 minutos.
- Calidad del aire MITECO: 15 minutos. Conservar sin caducidad destructiva la
  última lectura válida por estación y marcarla como recuperada si MITECO omite
  el índice; servir caché vencida inmediatamente mientras se refresca en segundo
  plano.
- Previsión Open-Meteo: 15 minutos mientras el panel está abierto; campo de
  viento para partículas: caché persistente de una hora, creada o renovada solo
  cuando algún usuario activa la capa.
- Capturas: comprobación cada 5 minutos y snapshot inmutable al inicio de hora.
  Los PNG se reutilizan en el servidor: calor 30 minutos, humo 6 horas y ráster
  EFFIS legado 6 horas. Las URLs cliente versionadas son inmutables.
- EFFIS: producto diario, sin hora fija; consultar el vector estructurado como
  máximo una vez por hora y el ráster legado de respaldo cada seis horas.
  Para decidir si aparece en la vista reciente usar `lastFireDate` o `fireDate`,
  nunca `lastupdate`, que puede reflejar procesamiento posterior.
- Copernicus EMSR900 y EMSR898: todas las AOI con producto entregado; metadatos
  cacheados quince minutos, originales inmutables guardados en disco privado y
  geometría cliente recalculada solo si cambia su versión. NASA GIBS y
  Copernicus pueden publicar con
  cadencias distintas a las consultas de FOCO; siempre distinguir hora de
  lectura, fecha del producto y antigüedad real.

## Continuidad

Leer completamente `docs/CODEX_HANDOFF.md` y `docs/BACKLOG.md` antes de cambiar
la aplicación. Preservar cambios ajenos en el árbol de trabajo. La rama
canónica es `main`.
