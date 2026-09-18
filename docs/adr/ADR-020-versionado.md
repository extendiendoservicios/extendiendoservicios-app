# ADR-020 · Versionado semántico y changelog

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-127, P-009

## Problema
Sin fechas ni plazos, hace falta una forma de marcar el avance y de identificar qué está en cada entorno.

## Alternativas
1. Semver desde `0.1.0`, `CHANGELOG.md` mantenido a mano, `1.0.0` al aceptar la Base en producción.
2. Versionado por fecha.
3. Sin versiones, solo commits.

## Decisión
Alternativa 1, con los hitos de `08_Fases_y_Backlog.md` sección 5.

## Motivo
Convención conocida; el número de versión visible en la app (pie de "Más" y de la sidebar) permite saber qué prueba el cliente.

## Consecuencias
- `VITE_APP_VERSION` inyectada en el build desde `package.json`.
- Etiquetas git en cada hito; la etiqueta dispara el despliegue a producción a partir de `1.0.0`.
- Después de `1.0.0`: correcciones en `1.0.x`, módulos en `1.x.0`.
