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
- El indicador de previsión puntual es una flecha azul orientada con el viento.
- Los snapshots históricos deben ser inmutables y no consultar fuentes remotas.
- Una captura remota inválida o transparente no sustituye una copia válida.
- Una capa conservada debe marcarse como desactualizada y exponer la fecha real
  de su fuente.
- La analítica privada no guarda IP, agente ni rutas en claro, respeta DNT/GPC y
  nunca enlaza públicamente `/visitas`.
- Las mutaciones públicas permanecen denegadas salvo la señal anónima y vacía de
  `/api/analytics/visit`.

## Fuentes y cadencias actuales

- Estado de Madrid: 2 minutos.
- Región, noticias, manifiesto satelital y snapshots: 5 minutos.
- Calidad del aire MITECO: 15 minutos, con últimas lecturas válidas limitadas.
- Previsión Open-Meteo: 15 minutos mientras el panel está abierto.
- Capturas: comprobación cada 5 minutos y snapshot inmutable al inicio de hora.
- EFFIS: producto diario, sin hora fija; consultar ráster y metadatos como
  máximo una vez por hora. NASA GIBS y Copernicus pueden publicar con cadencias
  distintas a las consultas de FOCO; siempre distinguir hora de lectura, fecha
  del producto y antigüedad real.

## Continuidad

Leer completamente `docs/CODEX_HANDOFF.md` y `docs/BACKLOG.md` antes de cambiar
la aplicación. Preservar cambios ajenos en el árbol de trabajo. La rama
canónica es `main`.
