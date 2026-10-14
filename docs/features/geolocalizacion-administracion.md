# Geolocalización y corrección de fichajes · administración (Módulo B1 · P22.4)

Especificación: `Docs/Plan_Maestro/modulos/B_asistencia_avanzada.md` (decisiones B-02, B-03, B-08 a B-17, B-20 a B-23, B-28, B-39 a B-41). La base (migraciones `0052` a `0055`) y los componentes compartidos (`src/lib/geo`, `src/components/map`, `GeoStatusBadge`) vienen de P22.1 y P22.2. Las pantallas del celular son de P22.3.

## Privacidad (B-40)

`latitude`, `longitude`, `accuracy_m`, `geo_override_by` y `geo_override_reason` de `attendance_records` y `supervision_attendance` están cerradas para `authenticated`: pedirlas, o hacer `select('*')` sobre esas tablas, da `42501`. En administración las posiciones se leen **solo** por:

- `v_presence_today` (mapa de presencia del Resumen), en `src/api/geo.ts` → `fetchPresenceToday`;
- `get_attendance_location` (mini mapa de solo lectura del detalle), en `src/api/geo.ts` → `fetchAttendanceLocation`.

Las demás consultas piden columnas explícitas. `AttendanceBoardRow` y `SupervisionListRow` traen la validación (`checkInGeo` / `checkOutGeo`) pero **no** coordenadas; la precisión (`accuracyM`) sí, y es lo que indica que el fichaje tiene posición guardada.

## Qué se ve y dónde

| Pantalla                                 | Qué suma                                                                                                                                                                                                                | Quién                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ADM-02 Resumen                           | Mapa de presencia «Dónde está el equipo» debajo de «Servicios de hoy»; «Fuera de zona» en «Requiere atención»; columna «Validación» en «Servicios de hoy»                                                               | Dueña y administradores                                                                    |
| ADM-10 Asistencia                        | Columna «Validación», marca «Corregido» en la hora y filtro «Solo fuera de zona»                                                                                                                                        | Dueña y administradores                                                                    |
| ADM-06 Detalle del turno                 | Por cada fichaje: validación, distancia (con el radio vigente al fichar), precisión, motivo del empleado, marca «Corregido», historial de correcciones, mini mapa y las acciones «Corregir hora» y «Marcar como válido» | Lectura: dueña y administradores. Acciones: dueña, o administrador con `manage_attendance` |
| ADM-15 Supervisión                       | Lo mismo para el inicio y el fin de la supervisión, sin «Corregir hora» (solo existe `override_geo_validation` para supervisiones)                                                                                      | Ídem                                                                                       |
| ADM-17 Ficha del empleado · Asistencia   | Columna «Validación» y marca «Corregido»                                                                                                                                                                                | Dueña y administradores                                                                    |
| Detalle de asistencia imprimible (AJ-06) | Columna «Validación» con el texto «Validado», «Fuera de zona (350 m)» o «Sin validar», sin coordenadas                                                                                                                  | Dueña y administradores                                                                    |
| ADM-19 Clientes · Mapa                   | Interruptor «Mostrar radios» y campo «Radio general»                                                                                                                                                                    | Radio: dueña y administradores (lectura para el resto)                                     |
| ADM-22 Sede · detalle                    | Interruptor «Mostrar radios» y el radio vigente (propio o general)                                                                                                                                                      | Dueña y administradores                                                                    |
| ADM-23 Sede · formulario                 | «Radio de validación propio (opcional)», de 50 a 1000 m                                                                                                                                                                 | Dueña y administradores                                                                    |
| ADM-28 Empresa                           | «Última modificación» del texto de consentimiento                                                                                                                                                                       | Dueña                                                                                      |

### Mapa de presencia (ADM-02)

- Puntos de empleados en curso, coloreados por la validación: verde «Validado» (o corregido por la administración), rojo «Fuera de zona», gris «Sin validar». Los supervisores en curso van con forma de rombo.
- Las sedes con turno hoy se dibujan con su círculo (radio vigente), sin color de alarma.
- «Mostrar finalizados de hoy» suma los que ya ficharon el fin.
- Al tocar un punto: persona, cliente y sede, horario, hora de inicio, distancia, precisión, estado y «Ver turno».
- «Trabajando sin ubicación: X» debajo del mapa, con la lista (solo quienes están en curso).
- Se actualiza solo cada 45 s y al volver a la pestaña (`refetchInterval` + `refetchOnWindowFocus`), sin Realtime (B-39). El indicador «Actualizado hace n s» muestra la antigüedad.

El armado de los marcadores es lógica pura en `src/features/geo/presence.ts` (`buildPresenceMarkers`), con tests.

### «Requiere atención»

Nuevo tipo `outsideGeo` (B-21): una asignación de hoy con inicio o fin «Fuera de zona» que la administración no marcó como válido (`has_outside_geo` de `v_assignments_board`). Es independiente de los demás avisos y va antes de «Llegada tarde». No se cuenta si el turno está cancelado.

### Correcciones (B-09, B-28, B-41)

- **Corregir hora** (`correct_attendance_time`): diálogo con la hora nueva (hora de Argentina, dentro del día del turno y nunca futura) y motivo obligatorio. El registro guarda el valor vigente y la corrección queda en `attendance_corrections`. Solo para fichajes de servicio.
- **Marcar como válido** (`override_geo_validation`): solo si el fichaje está en rojo o gris y no se corrigió antes. Motivo obligatorio. El resultado original se conserva; se ve «Validado (corregido)».
- El historial de correcciones (`attendance_corrections`) muestra quién, cuándo, qué cambió y el motivo.

Los mensajes de error de estas RPC están fijados en `src/features/geo/errors.ts` (un texto por cada `hint`); el servidor ya manda `message` en español y se usa como respaldo.

## Estructura

- `src/api/geo.ts`: `fetchPresenceToday`, `fetchAttendanceLocation`, `correctAttendanceTime`, `overrideGeoValidation`, `fetchAttendanceCorrections`, `setGeofenceRadius`, `fetchCompanyGeofence`.
- `src/api/attendance.ts`: `BoardAttendanceGeo` y `checkInGeo` / `checkOutGeo` / `hasOutsideGeo` en `AttendanceBoardRow`. `src/api/supervisions.ts`: las mismas validaciones en `SupervisionListRow`. `src/api/sites.ts`: `geofenceRadiusM` en el detalle, el formulario y el mapa. `src/api/settings.ts`: `locationConsentUpdatedAt`.
- `src/features/geo/`: `schemas.ts` (radio 50 a 1000, motivo obligatorio), `queries.ts` (claves `['geo', …]`), `errors.ts`, `permissions.ts`, `presence.ts`, `outsideZone.ts`, `radius.ts`, `printText.ts` y los componentes `PresenceMap`, `RecordGeoDetail`, `CorrectTimeDialog`, `OverrideGeoDialog`, `CorrectionsHistory`, `LocationMiniMap`, `GeoValidationCell` y `GeofenceRadiusField`.

## Decisiones menores

- El mapa de presencia va después de «Servicios de hoy» para no empujar la tabla hacia abajo en el celular.
- En las tablas la validación se muestra sin el motivo de «Sin validar» (queda en el detalle) para no ensanchar la columna.
- El mini mapa del detalle se abre con «Ver en el mapa» (no se carga hasta que se pide) y solo aparece si el fichaje tiene posición guardada.
- El círculo del mini mapa usa el radio **vigente al fichar** (B-08), no el actual de la sede.
- «Solo fuera de zona» no incluye los fichajes que la administración ya marcó como válidos.

## Pendiente

- El resumen de servicios por cliente imprimible trae desde `0056` (P22.4b) una columna «Validación» (`geoPrintText`): «Validado», «Fuera de zona (350 m)», «Validado (corregido)» o «Sin validar», para el inicio y el fin, sin coordenadas. Las filas de inasistencia llevan «—».
- El radio terrestre de `haversineDistanceM` (6 371 008,8 m) difiere del de la base (6 371 000 m): lo señaló P22.2 y se corrige en `src/lib/geo`, no acá.
