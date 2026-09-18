# ADR-015 · Respaldos diarios a Cloudflare R2 desde GitHub Actions

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-110, P-113, RB-X07

## Problema

La V3 promete respaldos periódicos automáticos y "sin costo mientras no se superen los límites". El plan sin cargo de Supabase no incluye backups automáticos.

## Alternativas

1. Producción sin cargo más `pg_dump` diario desde GitHub Actions a un bucket privado de Cloudflare R2.
2. Plan pago de Supabase con backups diarios provistos.
3. Volcado a un repositorio cifrado o a Drive del cliente.

## Decisión

Alternativa 1, con paso a plan pago cuando el uso lo pida.

## Motivo

Cumple ambas promesas de la V3 con costo cero (R2 tiene capa gratuita), es verificable y el destino queda bajo la cuenta de Cloudflare de la empresa.

## Consecuencias

- Workflow `backup.yml` con `pg_dump --format=custom`, cifrado simétrico con una clave en secretos, subida con `rclone` o la API S3 de R2; retención 30 diarios y 12 mensuales.
- Prueba de restauración documentada y repetida en F18 (TEST-024).
- Antes de cada migración en producción se ejecuta un volcado adicional.
- Alertas si el job falla.
