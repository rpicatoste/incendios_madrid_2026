# Backlog de FOCO Centro

Las tareas de esta lista son opcionales salvo indicación expresa. Deben
realizarse respetando la disponibilidad descrita en `AGENTS.md`.

## 1. Revisar fuentes de área recorrida — implementación en curso

Revisar las fuentes que representan dónde ha habido incendio o superficie
recorrida. La capa actual lleva más de un día sin cambios.

- Confirmar la cadencia real de publicación de EFFIS y distinguirla de la
  frecuencia con la que FOCO consulta la fuente.
- Investigar fuentes oficiales o estructuradas alternativas por incendio.
- Evitar que una consulta frecuente dé una falsa impresión de actualización.
- Mostrar claramente la fecha del producto y, si se conoce, su baja frecuencia
  de actualización.
- Mantener la última imagen válida cuando la fuente falle, marcándola como
  desactualizada.

Hallazgos del 26 de julio de 2026:

- EFFIS describe el producto MODIS/Sentinel-2 como diario, con dos mosaicos
  diarios y posibles incorporaciones VIIRS adicionales, pero no garantiza horas
  concretas de publicación.
- El WMS legado usado por la captura devolvía HTTP 502/503; la última imagen
  válida se estaba conservando correctamente.
- La API estructurada utilizada por el visor EFFIS v2 seguía operativa y expone
  `lastupdate` por perímetro. La última modificación dentro de la zona Centro era
  del 24 de julio, aunque la misma fuente tenía cambios en España el día 26.
- FOCO consultará los metadatos y el ráster EFFIS como máximo una vez por hora y
  mostrará por separado la lectura y la última modificación real en la zona.

## 2. Mejorar la previsión meteorológica

- Revisar los símbolos de sol: el principal es pequeño, negro y poco legible.
- Mostrar las temperaturas horarias que ya proporcione la predicción.

## 3. Automatizar evacuaciones fuera de Madrid

Incorporar evacuaciones y confinamientos de otras comunidades cuando existan
fuentes oficiales estructuradas y suficientemente fiables.

## 4. Analítica anónima condicionada a privacidad

Cualquier ampliación de la analítica anónima requiere autorización explícita de
privacidad. Mantener minimización, DNT/GPC y ausencia de datos personales en
claro.

## 5. Frentes activos más precisos

Incorporar frentes activos oficiales o de mayor precisión para incendios donde
hoy solo se dispone de área EFFIS y hotspots VIIRS.

## 6. Partículas de viento suaves

Valorar una visualización de pocas partículas, limitada en FPS, reducida en
móviles y desactivada cuando el usuario solicite movimiento reducido.
