# ADR-003 · Tailwind CSS + shadcn/ui con tokens del mockup

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-116, P-118, P-120

## Problema

Convertir la estética del mockup (teal `#569EA4`, Inter, radios 8/12/14, densidad alta) en un sistema reutilizable con accesibilidad resuelta.

## Alternativas

1. Tailwind + shadcn/ui (Radix) con tokens tomados de `ds.css`.
2. Una librería completa (MUI, Mantine).
3. CSS propio portado del mockup.

## Decisión

Alternativa 1.

## Motivo

shadcn/ui copia los componentes al repositorio (sin dependencia de versión), Radix resuelve teclado, foco y ARIA; Tailwind reemplaza las utilidades ad hoc del mockup; los tokens garantizan fidelidad visual.

## Consecuencias

- `07_Design_System.md` define tokens, componentes y normalizaciones (medios píxeles, pesos, radios).
- Solo modo claro; los tokens quedan preparados para un tema oscuro.
- Componentes propios (calendario, grilla semanal, StarRating, MapPicker) siguen las mismas convenciones.
