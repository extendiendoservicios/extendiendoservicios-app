# ADR-014 · Dos proyectos Supabase y desarrollo contra App_dev

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-100, P-111, P-112, P-115

## Problema

Mike no tiene Supabase local (Docker). Existen dos proyectos vacíos en la organización: `App` y `App_dev`. Hay que definir entornos, dónde se desarrolla y dónde corren los tests.

## Alternativas

1. `App` producción; `App_dev` staging y también entorno de desarrollo (frontend local contra `App_dev`); tests pgTAP contra `App_dev`.
2. Instalar Docker y usar `supabase start` local, con `App_dev` solo como staging.
3. Tres proyectos (dev, staging, prod): no cabe en el plan sin cargo (dos activos).

## Decisión

Alternativa 1 ahora; alternativa 2 opcional más adelante sin cambiar nada del pipeline.

## Motivo

Sin Docker, `App_dev` es el único lugar donde aplicar migraciones; con una sola persona desarrollando no hay conflicto de datos; los datos son ficticios (P-100).

## Consecuencias

- `supabase link` a `App_dev` en la máquina de Mike; `db push` manual en desarrollo y automático al fusionar en `develop`.
- Los tests pgTAP se ejecutan en un esquema de prueba recreado en cada corrida sobre `App_dev`.
- Un `keepalive` semanal evita la pausa por inactividad del plan sin cargo.
- Si se suma otra persona, se instala Docker y `App_dev` vuelve a ser solo staging.
