# ADR-022 · Envío de emails de Auth con Resend

Fecha: 18 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-012, decisión D-03 de `11_Desglose_de_Tareas.md` (aprobada por Mike el 18 de septiembre de 2026)

## Problema
P-012 exige que cualquier usuario pueda recuperar su contraseña por email. El servicio de email incluido en Supabase es solo para pruebas: envía únicamente a los miembros del equipo del proyecto y con un límite muy bajo por hora. Sin un SMTP propio, la recuperación no funciona para los empleados reales. El plan no lo había previsto.

## Alternativas
1. Resend como SMTP, con remitente del dominio propio.
2. Brevo como SMTP, con remitente del dominio propio.
3. Gmail SMTP con una contraseña de aplicación de `extserviciosapp@gmail.com`.

## Decisión
Alternativa 1. Cuenta de Resend bajo `extserviciosapp@gmail.com`, dominio `extendiendoservicios.com` verificado con registros DNS en Cloudflare, remitente `no-reply@extendiendoservicios.com`. Supabase Auth de `App_dev` y de `App` usa ese SMTP.

## Motivo
Capa sin cargo holgada para el volumen de la Base (unos sesenta usuarios, emails ocasionales de recuperación), remitente profesional del dominio de la empresa y mejor entrega que un Gmail. Cumple la V3 punto 6: sin costo mientras no se superen los límites.

## Consecuencias
- Cuenta nueva a nombre de la empresa: se suma a `03` sección 3.2.
- Registros DNS de verificación en la zona `extendiendoservicios.com` de Cloudflare. No afectan la web ni la app.
- La clave de API de Resend es un secreto: la carga Mike en la configuración SMTP de Supabase (o como variable de entorno si la configuración se versiona con `env(...)`). Nunca en el repositorio.
- Las plantillas de los emails de Auth (recuperación y cambio de email) se escriben en español con voseo, dentro de AUTH-005.
- El paquete P06.0 de `11_Desglose_de_Tareas.md` lo implementa antes de F6.
