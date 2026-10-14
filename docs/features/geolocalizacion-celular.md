# Geolocalización al fichar en el celular (módulo B1, P22.3)

Especificación: `Docs/Plan_Maestro/modulos/B_asistencia_avanzada.md` §1 (B-03 a B-08, B-18, B-19, B-22, B-23, B-28), §2 (B-37, B-38, B-40) y §5 «Celular». Base de datos: migraciones `0052` a `0055` (`docs/database.md`). Piezas compartidas (`geoEvaluate`, `useLivePosition`, `GeofenceMiniMap`, `GeoStatusBadge`): `docs/design-system.md`, «Geolocalización». Las pantallas de administración son de P22.4.

## Qué hay en cada pantalla

| Pantalla                         | Ruta                                    | Qué suma                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EMP-14 / EMP-05 Registrar inicio | `/app/fichar`                           | `GeoFichajePanel` (mini mapa, precisión en vivo, «Esperar mejor señal», motivo opcional) entre la hora y el botón. Después de fichar, `AttendanceResultScreen` con la hora y la validación que devolvió la base; «Ir a mi servicio» sigue a EMP-07. |
| EMP-10 Finalizar                 | `/app/en-curso/:assignmentId/finalizar` | Lo mismo para el fin. «Ver el resumen» sigue a EMP-11.                                                                                                                                                                                              |
| SUP-04 Registro en la sede       | `/sup/supervisiones/:id/registro`       | Lo mismo para el inicio y el fin, contra la sede supervisada (`v_my_supervisions`).                                                                                                                                                                 |
| EMP-HIS Mis servicios anteriores | `/app/historial`                        | Debajo de la franja: `Inicio 08:02 [Corregido] [Validado / Fuera de zona / Sin validar (motivo)]` y lo mismo para el fin (`AttendanceMarkRow`).                                                                                                     |
| EMP-11 Resumen                   | `/app/resumen/:assignmentId`            | Filas «Ubicación del inicio» y «Ubicación del fin» con las mismas marcas.                                                                                                                                                                           |
| SUP-03 Detalle de la supervisión | `/sup/supervisiones/:id`                | Filas «Ubicación del inicio» y «Ubicación del fin» (el supervisor ve su propia validación; no hay marca «Corregido»: la hora de las supervisiones no se corrige).                                                                                   |
| EMP-06 Consentimiento            | `/app/fichar/consentimiento`            | Se vuelve a mostrar cuando el texto cambió (B-22). Acepta `?volver=/app/...` para regresar a EMP-10.                                                                                                                                                |

## Cómo se arma el fichaje en vivo

- `useGeoFichaje` (`src/features/employee/useGeoFichaje.ts`) envuelve `useLivePosition({ enabled, targetAccuracyM: radio de la sede, waitMs: 30000 })`. `enabled` es verdadero solo con consentimiento vigente (B-38): sin él no se pide la ubicación y el fichaje queda gris.
- `buildLiveGeoView` (`src/features/employee/liveGeo.ts`, puro) calcula, con `geoEvaluate` y el radio y el tope de precisión de la vista, lo que se ve: el color del círculo de la sede, «Precisión: 35 m», si se ofrece «Esperar mejor señal», si se muestra el campo del motivo y las coordenadas que se mandan.
- Se manda la **mejor** lectura (`position` del hook, la de menor precisión), no la última.
- «Esperar mejor señal» se ofrece si la precisión es peor que el radio de la sede y todavía no se usó la espera (hasta 30 s, con cuenta regresiva). En ese caso el botón principal pasa a decir «Fichar igual» («Finalizar igual» en EMP-10). El botón nunca se deshabilita por la ubicación; solo por falta de conexión o mientras se registra.
- Si el resultado en vivo es «Fuera de zona» aparece «¿Por qué estás fuera de la zona? (opcional)», hasta 300 caracteres, que viaja como `p_outside_reason`. La base lo guarda solo si ella también resuelve «Fuera de zona»; `OUTSIDE_REASON_TOO_LONG` se muestra con el mensaje de la RPC.
- Sede sin coordenadas: no hay mapa, un aviso y el fichaje queda gris «sede sin coordenadas». Sin consentimiento o sin permiso: aviso y gris «sin ubicación».
- **El resultado que se muestra después de fichar es el que devolvió la base** (`geo_status`, `geo_unvalidated_reason`, `site_distance_m`), con `GeoStatusBadge`, no el calculado en el celular (B-37). La hora es la de `recorded_at`.

## Re-consentimiento (B-22)

- El consentimiento de la persona está en `profiles.location_consent_at`. La empresa marca el último cambio del texto en `company_settings.location_consent_updated_at`, que lee cualquier usuario autenticado (`src/api/locationConsent.ts`, `fetchLocationConsentInfo`). No hizo falta nada nuevo en la base.
- `useLocationConsent` (`src/features/employee/useLocationConsent.ts`) devuelve `granted`, `needs-consent` o `declined` con `resolveLocationConsent` (`locationConsent.ts`). Si el cambio del texto es posterior al consentimiento, vuelve a `needs-consent` y se muestra EMP-06 antes de fichar el inicio. En EMP-10 y SUP-04 también, si la persona ya había consentido.
- Quien elige «Continuar sin ubicación» después de haber consentido pierde el consentimiento guardado (`location_consent_at = null`, igual que «Quitar consentimiento» del perfil) y se recuerda la negativa en el dispositivo; si no, la app se lo volvería a pedir en cada fichaje.
- Para que un reloj atrasado no deje un consentimiento "anterior" al texto (y la app lo pida sin fin), `consentTimestamp` nunca guarda un instante anterior al último cambio del texto más un segundo. Mejora pendiente: una RPC `accept_location_consent()` que use `now()` del servidor.

## Privacidad (B-40)

- El celular nunca lee `latitude`, `longitude`, `accuracy_m` ni los motivos de la administración: las vistas `v_my_day`, `v_my_history` y `v_my_supervisions` no los traen y las tablas dan `42501`. Los mapeos de `src/api/attendance.ts`, `src/api/myDay.ts` y `src/api/mySupervisions.ts` solo exponen `AttendanceGeo`: estado, motivo, distancia, radio y `overridden`.
- La posición propia se ve solo en vivo mientras se ficha, en el mapa. Ninguna pantalla escribe coordenadas como texto.
- «Corregido» (B-28) es solo una marca; el motivo de la corrección no llega al celular. «Validado (corregido)» (B-09) tampoco muestra el motivo.

## Para probar

1. Empleado con consentimiento y un servicio hoy en una sede con coordenadas: en Chrome (DevTools › Sensors › Location) poné la posición en la sede → círculo verde, «Estás dentro de la zona del servicio.»; después mové la posición a 1 km → círculo rojo y el campo del motivo.
2. Precisión mala: en Sensors cargá una ubicación personalizada con precisión alta (o probá en un interior) → «Esperar mejor señal» y botón «Fichar igual».
3. Negá el permiso del navegador → aviso y registro sin ubicación (queda «Sin validar (sin ubicación)»).
4. Sede sin coordenadas → sin mapa, aviso, fichaje normal.
5. Cambiá el texto del consentimiento en Configuración de la empresa y volvé a fichar con una persona que ya había consentido → se muestra EMP-06.
