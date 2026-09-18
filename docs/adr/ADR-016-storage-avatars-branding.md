# ADR-016 · Storage para foto de perfil y logo

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** (reemplaza a DT-17 de la auditoría) · Origen: P-037, P-117

## Problema

La auditoría preveía Storage sin uso en la Base (no hay fotos de evidencia). Mike agregó foto de perfil para el usuario y logo personalizable para la empresa.

## Alternativas

1. Dos buckets (`avatars`, `branding`) con políticas de Storage.
2. Guardar imágenes en la base como `bytea` o `data:` URL.
3. No incluirlas en la Base.

## Decisión

Alternativa 1. `avatars` con rutas `{profile_id}/{uuid}.jpg`, lectura pública, escritura del propio usuario o administración, imagen recortada y redimensionada en el cliente (512 px, ≤ 2 MB). `branding` con `logo.{ext}`, lectura pública, escritura de dueño y administrador.

## Motivo

Es el uso previsto de Storage; el patrón de políticas queda listo para el módulo H.

## Consecuencias

- Lectura pública de avatares es PROPUESTO; alternativa privada con URL firmada si Mike lo prefiere (cambio pequeño).
- Se monitorea el almacenamiento (1 GB en el plan sin cargo); con 60 usuarios y 512 px el uso es despreciable.
