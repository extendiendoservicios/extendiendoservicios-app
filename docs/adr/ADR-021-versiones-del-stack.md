# ADR-021 · Versiones del stack al iniciar la implementación

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-002, decisión D-01 de `11_Desglose_de_Tareas.md` (aprobada por Mike el 17 de septiembre de 2026)

## Problema

`03_Plan_Maestro_Tecnico.md` sección 2 fija versiones concretas: React 18, Vite 5, TypeScript 5, React Router 6, Tailwind CSS 3, date-fns 3, TanStack Table 8, pnpm 9 y Node 20 LTS. Al empezar la fase 2, Node 20 no tiene soporte desde el 30 de abril de 2026, y las versiones mayores estables de casi todas las librerías son posteriores. Empezar con la generación anterior deja deuda de actualización desde el primer commit. Además, React Router 7 exige Node 22.22 o superior y Vitest 5 exige Node 22.12 o superior, y la máquina de Mike tiene Node 22.13.

## Alternativas

1. Las versiones del plan.
2. Las versiones mayores estables actuales, con Node 24 LTS.
3. Una mezcla: Node actual con las librerías del plan.

## Decisión

Alternativa 2. Las herramientas son las mismas de ADR-002 y ADR-003; solo cambian las versiones:

| Elemento                | Versión                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Node                    | 24 LTS (soporte hasta el 30 de abril de 2028)                                                        |
| pnpm                    | versión estable actual                                                                               |
| React                   | 19                                                                                                   |
| Vite                    | 8, con `@vitejs/plugin-react` 6                                                                      |
| TypeScript              | 6.0 estricto. No 7: typescript-eslint admite hasta 6.0                                               |
| React Router            | 7 en modo biblioteca (SPA, sin modo framework ni SSR)                                                |
| Tailwind CSS            | 4 con `@tailwindcss/vite`, y la versión actual de shadcn/ui                                          |
| TanStack Query          | 5                                                                                                    |
| TanStack Table          | mayor estable actual (9); si resulta incompatible con los componentes de shadcn/ui, 8                |
| react-hook-form         | 7, con `@hookform/resolvers` 5                                                                       |
| zod                     | 4                                                                                                    |
| date-fns                | 4 con locale `es`                                                                                    |
| Leaflet / react-leaflet | 1.9 / 5                                                                                              |
| vite-plugin-pwa         | 1                                                                                                    |
| Vitest / Playwright     | 5 / estable actual                                                                                   |
| ESLint                  | 9 con typescript-eslint 8. No 10: `eslint-plugin-jsx-a11y` todavía no lo declara compatible          |
| Supabase                | `supabase-js` 2; Supabase CLI 2 como dependencia de desarrollo del proyecto (sin instalación global) |

## Motivo

Node 20 ya no recibe parches de seguridad. Las versiones actuales son las que soportan hoy sus autores: la versión actual de shadcn/ui está pensada para Tailwind 4 y React 19, y react-leaflet 5 requiere React 19. Actualizar de mayor más adelante cuesta más que empezar en la vigente.

## Consecuencias

- `package.json` declara `engines.node` 24 y el repositorio incluye `.node-version`; CI usa Node 24.
- Tailwind 4 se configura en CSS (`@theme`) en lugar de `tailwind.config.ts`. Donde `03` sección 3.4 y `07` sección 6 dicen `tailwind.config.ts`, se lee "configuración de Tailwind"; los tokens de `07` se mapean igual.
- Las versiones exactas quedan fijadas en `pnpm-lock.yaml`; las actualizaciones menores llegan por Dependabot mensual (`03` sección 15).
- Si alguna combinación resulta incompatible al instalar, el agente lo reporta y se usa la mayor anterior de esa librería, dejando constancia en el `CHANGELOG`.
- La versión de Postgres es la que tengan los proyectos `App` y `App_dev`. `03` dice Postgres 15; los proyectos nuevos de Supabase suelen crearse con una versión posterior. Se verifica en INFRA-010, sin impacto en el diseño.
- ADR-002 y ADR-003 siguen vigentes.
