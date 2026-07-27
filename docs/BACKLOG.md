# Backlog de FOCO Centro

Las tareas de esta lista son opcionales salvo indicación expresa. Deben
realizarse respetando la disponibilidad descrita en `AGENTS.md`.

## 1. Revisar fuentes de área recorrida — completado el 26 de julio de 2026

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
- FOCO usa ahora como capa principal los perímetros GeoJSON de la API
  estructurada, limitados a los últimos 30 días y a la vista Centro. La prueba
  de integración obtuvo 39 geometrías válidas y conservó `lastupdate`, fecha del
  incendio, superficie y municipio/provincia.
- La API vectorial se consulta como máximo una vez por hora. El ráster WMS
  legado queda únicamente como respaldo y se intenta como máximo cada seis
  horas. Ambos conservan la última copia válida y separan la hora de lectura de
  la fecha real del producto.
- Los snapshots v4 congelan también el GeoJSON EFFIS; una vista histórica no
  vuelve a consultar la fuente remota.

## 2. Mejorar la previsión meteorológica — completado el 26 de julio de 2026

- El sol principal usa un emoji de color, mayor y con contraste suficiente.
- Cada hora muestra la temperatura de Open-Meteo junto a cielo, viento y lluvia.

## 3. Automatizar evacuaciones fuera de Madrid — fuente pendiente

Incorporar evacuaciones y confinamientos de otras comunidades cuando existan
fuentes oficiales estructuradas y suficientemente fiables.

Revisión del 26 de julio de 2026:

- Datos Abiertos de Castilla y León ofrece incendios, estado, medios, superficie
  y posición, pero no una relación nominal de evacuaciones o confinamientos.
- FIDIAS y las notas públicas de Castilla-La Mancha no exponen actualmente esa
  relación mediante una fuente pública estructurada. El mapa público de la Red
  de Alerta Nacional tampoco aporta localidades nominales para este fin.
- FOCO mantiene las relaciones oficiales fechadas ya verificadas de Ávila y
  Guadalajara, excluye los retornos nominalmente autorizados y no deduce
  evacuaciones a partir de proximidad, nivel o perímetros. La interfaz explica
  esta limitación. Se retomará la automatización cuando aparezca una fuente
  adecuada.

## 4. Analítica anónima condicionada a privacidad — completado y auditado

Cualquier ampliación de la analítica anónima requiere autorización explícita de
privacidad. Mantener minimización, DNT/GPC y ausencia de datos personales en
claro.

La implementación autorizada ya cuenta sesiones aproximadas sin cookies, rota
diariamente el HMAC, respeta DNT/GPC, no guarda IP, agente ni ruta en claro y
retiene 90 días. `/visitas` no se enlaza públicamente, requiere la clave local y
no la persiste en el navegador. No se amplió la recogida de datos.

## 5. Frentes activos más precisos — completado el 26 de julio de 2026

Incorporar frentes activos oficiales o de mayor precisión para incendios donde
hoy solo se dispone de área EFFIS y hotspots VIIRS.

FOCO integra todas las áreas entregadas de Copernicus EMSR900 y EMSR898:
Brieva, Villa del Prado, La Atalaya, La Mierla y Selas. Cada perímetro, frente y
llama usa el producto más reciente que contiene esa geometría y muestra su hora
propia de observación. Los círculos orientativos solo se ocultan cuando existe
una correspondencia explícita con un perímetro oficial. El 27 de julio se añadió
copia privada exacta de cada GeoJSON original y una geometría de visualización
muy simplificada, sin componentes pequeños ni agujeros: la comprobación real
redujo la entrega de unas 23 MB y más de 1,1 millones de coordenadas a unos
93 KB y 4.798 coordenadas, sin perder el original del servidor.

## 6. Partículas de viento suaves — completado y revisado el 27 de julio de 2026

Valorar una visualización de pocas partículas, limitada en FPS, reducida en
móviles y desactivada cuando el usuario solicite movimiento reducido.

La capa empieza apagada y, por tanto, no consulta el viento ambiental ni crea
un bucle de animación. Al encenderla usa 18 partículas en móvil o 34 en
escritorio, trazos azules con halo blanco y un máximo real de 15 FPS. Se pausa
con la pestaña oculta, no captura clics, respeta `prefers-reduced-motion` y
dispone de un interruptor propio en la leyenda.
