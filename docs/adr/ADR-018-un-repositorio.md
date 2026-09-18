# ADR-018 · Un repositorio para frontend y base de datos

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-006, P-123, P-124, P-125

## Problema
Existen `extendiendoservicios-web` (landing) y `extendiendoservicios-app` (plataforma). Hay que decidir dónde viven frontend, migraciones, Edge Functions, scripts y documentación.

## Alternativas
1. `extendiendoservicios-app` como único repositorio de la plataforma: frontend, `supabase/` (migraciones, funciones, seed, tests), `scripts/`, `docs/`.
2. Repositorios separados para frontend y base de datos.
3. Monorepo que incluya `web`.

## Decisión
Alternativa 1. `web` queda aparte.

## Motivo
Cada cambio funcional suele tocar migración, API y pantalla a la vez; un PR los revisa juntos; un pipeline los despliega en orden.

## Consecuencias
- Ramas: `main` producción, `develop` staging, ramas cortas con PR a `develop`.
- Despliegue a producción con aprobación manual; migraciones con volcado previo.
- Estructura de carpetas en `03_Plan_Maestro_Tecnico.md` sección 3.4.
