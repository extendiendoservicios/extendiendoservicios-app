# ADR-001 · Una sola aplicación web con tres experiencias, instalable como PWA

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-001, P-008, P-016, P-089

## Problema

La V3 exige tres vías de acceso (administración de escritorio responsive, empleado móvil, supervisor móvil) sobre una misma base y sistema. Hay que decidir cuántas aplicaciones se construyen y cómo llegan al celular.

## Alternativas

1. Una SPA responsive con tres experiencias por rol, instalable como PWA.
2. Dos frontends (administración y móvil) en un monorepo con paquetes compartidos.
3. App nativa o Capacitor desde el inicio.

## Decisión

Alternativa 1. Un solo código, un despliegue, un design system. Las experiencias se separan por rutas (`/admin`, `/app`, `/sup`) y por shells, con carga diferida por vía para que el celular no descargue el código de administración.

## Motivo

Encaja en Cloudflare Pages sin servidores; evita tiendas y cuentas de desarrollador; el empleado sin smartphone usa la misma app en tablet o navegador (P-016); nada de lo que justificaría una app nativa (push con app cerrada, GPS robusto, offline) está en la Base.

## Consecuencias

- El bundle se divide por vía (`React.lazy` por shell) y se mide en CI.
- Las limitaciones de PWA en iOS (push, almacenamiento) se aceptan; la mayoría de los empleados usa Android (P-090).
- Si el módulo A exige push en iOS con la app cerrada, se evalúa envolver la misma SPA con Capacitor (P-008); la estructura por dominios lo permite sin rehacer.
