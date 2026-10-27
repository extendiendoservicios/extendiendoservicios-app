# Insumos en el celular: catálogo, retiros y avisos de faltante (P25.4)

Especificación: `Docs/Plan_Maestro/modulos/E_insumos_y_stock.md` (IS-11 a IS-14, IS-20, IS-28, IS-29, IS-33). Contrato de la
base: `docs/database.md`, sección «Insumos y control de stock» (migraciones `0069` a `0071`, P25.1).

Las mismas pantallas las usan el empleado y el coordinador. Nunca muestran cantidades de stock ni precios (IS-20).

## Pantallas

| Pantalla               | Ruta empleado           | Ruta coordinador        | Archivo                                       |
| ---------------------- | ----------------------- | ----------------------- | --------------------------------------------- |
| INS-01 Insumos         | `/app/insumos`          | `/sup/insumos`          | `src/features/myStock/pages/SuppliesPage.tsx` |
| INS-02 Retirar         | `/app/insumos/retirar`  | `/sup/insumos/retirar`  | `src/features/myStock/pages/WithdrawPage.tsx` |
| INS-03 Avisar faltante | `/app/insumos/faltante` | `/sup/insumos/faltante` | `src/features/myStock/pages/ShortagePage.tsx` |

Las rutas se definen una vez en `src/app/routes/stockMobileRoutes.tsx` y cada vía las suma con `...stockMobileRoutes`.

- **Barra inferior:** empleado «Hoy · Insumos · Fichar (botón) · Más»; coordinador «Hoy · Supervisiones · Insumos · Historial · Más».
- **INS-01:** buscador y categorías, catálogo con imagen (URL firmada del bucket privado `supply-images`), código, nombre y
  presentación; los artículos sin stock muestran «Sin stock» y no se pueden elegir. Botones «Retirar insumos» y «Avisar
  faltante». Debajo, «Mis retiros» (con «Anulado» y el motivo si corresponde) y «Mis avisos» (estado y nota de resolución).
- **INS-02:** pasos Destino, Artículos, Revisar y Resumen. El destino es un turno de `v_withdrawal_shift_options` o «Para una
  sede, sin turno puntual» (sede de `v_withdrawal_site_options` y observación obligatoria). El coordinador ve primero «Mis
  sedes» (`is_priority`) y después el resto, con buscador. Cantidades enteras mayores que cero. Sin conexión, «Confirmar» queda
  deshabilitado con un aviso y no hay cola. El resumen muestra la hora que devuelve el servidor.
- **INS-03:** un artículo del catálogo o una descripción libre (uno de los dos); turno o sede y comentario, opcionales.
- **Atajo:** «Retirar insumos» en el detalle del servicio del empleado (EMP-04) y en SUP-03 abre INS-02 con `?turno=<id>`. Solo
  aparece si el turno está entre las opciones permitidas (`WithdrawShortcut`).

## Capa de datos

`src/api/myStock.ts` (funciones) y `src/features/myStock/queries.ts` (hooks de TanStack Query). Ver `docs/api.md`.

## Decisiones menores

- Los mensajes de error son propios de cada código; `INSUFFICIENT_STOCK` muestra el del servidor, que para estos roles ya
  viene sin la cantidad.
- Las listas «Mis retiros» y «Mis avisos» traen los últimos 30.
- Las imágenes se firman en una sola llamada por lista y duran una hora.
