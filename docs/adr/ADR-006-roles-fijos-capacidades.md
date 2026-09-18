# ADR-006 · Cuatro roles fijos y capacidades por administrador

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-017, P-018, P-020, P-021, P-022 (aclaradas el 17 sep)

## Problema

"Ingreso seguro con usuario y perfil" no define perfil. El mockup D25 mostraba cuatro roles (incluido RR.HH.) y una matriz de permisos editable por pantalla. Mike quiere separar dueño de administradores y no dejar la configuración de permisos como futuro, pero sin una matriz completa.

## Alternativas

1. Matriz de permisos editable por función y rol, consultada por RLS.
2. Roles fijos en SQL más un conjunto acotado de capacidades activables por administrador, editables por el dueño.
3. Solo roles fijos.

## Decisión

Alternativa 2. Roles: `owner`, `admin`, `supervisor`, `employee`. Capacidades de administrador: `manage_users`, `cancel_shifts`, `edit_ratings`, `edit_checklists`, `manage_attendance`, `generate_shifts`, `manage_supervisions`. El dueño tiene todo; además es el único que gestiona dueños y administradores, capacidades y configuración de la empresa. RR.HH. es un administrador. El supervisor solo lee lo asignado y califica.

## Motivo

Cubre la necesidad real (la dueña decide qué puede hacer cada administrador) sin el riesgo de una matriz que puede dejar el sistema inconsistente ni el costo de construirla. La enumeración de capacidades crece con los módulos.

## Consecuencias

- Roles y capacidades en el JWT (hook); RLS y RPC los leen con `app.has_role` y `app.has_capability`.
- Los cambios restrictivos revocan sesiones para que apliquen de inmediato.
- Módulos futuros solo para dueños (finanzas) se resuelven con el rol `owner`.
- La matriz completa (D25) queda como FUTURO con su propio ADR si se contrata.
