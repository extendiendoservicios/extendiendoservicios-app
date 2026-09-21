# ADR-023 · Docker como herramienta de pruebas

Fecha: 19 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-112, decisión D-02 de `11_Desglose_de_Tareas.md` (aprobada por Mike el 19 de septiembre de 2026, en P04.0). Complementa a ADR-014.

## Problema
ADR-014 parte de que Mike no tiene Docker, pero su máquina tiene Docker Desktop 28.1.1. Además, F4 necesita correr pgTAP y P03.7 dejó pendiente probar la secuencia de restauración de `restore-test.yml`. Sin Docker, esa prueba tendría que hacerse sobre `App_dev`, que también sirve a staging.

## Alternativas
1. Mantener ADR-014 y usar Docker solo como herramienta de pruebas.
2. Supabase local completo (`supabase start`), con `App_dev` solo como staging.
3. Seguir sin Docker: pgTAP solo en el CI o con `pg_prove` instalado a mano en Windows, y la restauración probada sobre `App_dev` vacío.

## Decisión
Alternativa 1. `App_dev` sigue siendo el entorno de desarrollo y de staging (ADR-014). Docker Desktop se prende solo cuando hace falta, para:
- correr pgTAP contra `App_dev` con la CLI de Supabase (`supabase test db --linked`, que ejecuta `pg_prove` en un contenedor);
- los tests Deno de la Edge Function `admin-users`;
- una base Postgres 17 descartable para validar la secuencia de restauración sin tocar `App_dev`.

## Motivo
Aprovecha lo que ya está instalado sin cambiar entornos, pipeline ni documentación de ADR-014. Supabase local completo suma unos diez contenedores y varios GB de memoria para una sola persona que desarrolla con datos ficticios. Sin Docker, pgTAP en Windows requiere instalar Perl y `pg_prove` a mano, y la prueba de restauración compartiría base con staging.

## Consecuencias
- Para correr `pnpm db:test` en local hay que tener Docker Desktop prendido. Si un subagente lo encuentra apagado, lo informa en su reporte y no busca otro camino.
- El CI no depende de la máquina de Mike: los runners de GitHub Actions ya traen Docker.
- Los tests pgTAP no pueden dejar cambios en `App_dev`, porque staging usa esa base. El detalle del runner (transacción por archivo, esquema de prueba) lo define DB-022.
- La restauración de prueba se valida primero en el Postgres descartable. Recién después se quita el job `traba` de `restore-test.yml`.
- Supabase local completo (alternativa 2) sigue abierto, como dice ADR-014: si se suma otra persona, se instala y `App_dev` vuelve a ser solo staging.
