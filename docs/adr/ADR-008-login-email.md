# ADR-008 · Login por email con Supabase Auth

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-010, P-011, P-012, P-015, P-106, P-107

## Problema

El mockup pedía "DNI o usuario". Supabase Auth trabaja con email o teléfono. Muchos operarios podrían no tener email.

## Alternativas

1. Email y contraseña.
2. DNI mapeado a un email interno sintético.
3. OTP por SMS o WhatsApp.

## Decisión

Alternativa 1. Todo usuario tiene un email de login (real o provisto por la empresa). Contraseña inicial definida por quien crea el usuario, sin cambio obligatorio; mínimo 8 caracteres; recuperación por email y por reseteo administrativo; sesión persistente; rate limiting de Supabase.

## Motivo

Decisión de Mike. Evita el mapeo artificial y mantiene la recuperación por email para quien la use.

## Consecuencias

- Si un empleado no tiene email, la empresa le asigna uno (el dominio del cliente o una cuenta gratuita); se documenta en la guía de administración.
- El email de login solo lo cambia el dueño o administrador (Edge Function); el email de contacto lo edita el usuario.
- Sin bloqueo por cuenta propio; los intentos fallidos quedan en `security_events`.
