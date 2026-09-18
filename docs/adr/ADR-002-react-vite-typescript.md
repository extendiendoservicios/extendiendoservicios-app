# ADR-002 · React + Vite + TypeScript + React Router

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-002, P-004

## Problema

Elegir el framework y las herramientas del frontend para una SPA estática sobre Supabase, mantenible por terceros.

## Alternativas

1. React 18 + Vite + TypeScript + React Router, con TanStack Query, react-hook-form y zod.
2. SvelteKit.
3. Next.js.

## Decisión

Alternativa 1. Mike respondió "React + varios"; se adopta la recomendación completa de la auditoría.

## Motivo

Ecosistema más amplio; `supabase-js` y shadcn/ui probados con React; SSR no aporta en un sitio estático; coincide con lo que anticipaba el README de `app/`.

## Consecuencias

- TypeScript estricto y tipos generados desde la base (`supabase gen types`).
- TanStack Query para todo el estado de servidor; estado local con hooks; sin Redux; Zustand solo si aparece estado global real.
- react-hook-form + zod replican en el cliente las reglas del servidor para feedback inmediato; nunca las reemplazan.
- Vitest, Testing Library y Playwright como herramientas de prueba.
