# FOCO Centro

Visualizador público y de solo lectura para seguir incendios en Madrid y las
comunidades limítrofes. Superpone avisos operativos, evacuaciones,
confinamientos, acogida, calidad del aire, humo, actividad térmica, áreas
recorridas y productos cartográficos de Copernicus. Permite consultar la
previsión horaria de cualquier punto y volver a snapshots completos por hora.

## Prerequisites

- Node.js `>=22.13.0`

## Desarrollo

```bash
npm install
npm test
npm run dev
```

La aplicación requiere las variables de `.env` para capturas internas. No
expongas ese archivo ni `FOCO_SNAPSHOT_TOKEN`.

## Producción

La instancia canónica está en
`/home/rpica/workspace/incendios_madrid_2026` de Numebox. Consulta
[docs/CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md) para arquitectura, fuentes,
servicios, despliegue seguro y continuidad desde Codex CLI.
