# `src/components`

Componentes reutilizables en toda la app, sin lógica de un dominio
particular:

- `ui/` — componentes base de shadcn/ui (Radix + Tailwind 4), desde F5.
- `status/` — `StatusBadge` y afines sobre el mapa de estados del design
  system, desde F5.
- `map/` — `MapPicker` y `MapView` (Leaflet), desde F8.
- `search/` — `GlobalSearch`, desde F9.
- El resto (Button, Card, DataTable, etc.) va directo en esta carpeta.

Carpeta vacía hasta F5 (design system).

## `StarRating` (MOB-SUP-001)

Cinco estrellas (o `max` estrellas) para calificar a un empleado (SUP-05) o
mostrar un puntaje ya cargado (ADM-13, ADM-17). Componente controlado, sin
estado propio del valor.

```tsx
<StarRating value={rating} onValueChange={setRating} aria-label="Calificación" />
<StarRating value={rating} readOnly />              // solo lectura
<StarRating value={rating} readOnly size="sm" />     // tabla densa
<StarRating value={null} onValueChange={setRating} aria-label="Calificación" /> // sin calificar
```

Props:

| Prop            | Tipo                      | Default | Notas                                                                                                                                                                            |
| --------------- | ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`         | `number \| null`          | —       | Puntaje de 1 a `max`; `null` cuando todavía no hay calificación.                                                                                                                 |
| `onValueChange` | `(value: number) => void` | —       | Solo se usa en modo editable (`readOnly=false`).                                                                                                                                 |
| `readOnly`      | `boolean`                 | `false` | Sin interacción: se renderiza como `role="img"` con el puntaje como nombre accesible ("3 de 5 estrellas" o "Sin calificar").                                                     |
| `disabled`      | `boolean`                 | `false` | Solo aplica en modo editable.                                                                                                                                                    |
| `max`           | `number`                  | `5`     | Cantidad de estrellas.                                                                                                                                                           |
| `size`          | `'sm' \| 'md'`            | `'md'`  | Solo afecta el tamaño del ícono en modo de solo lectura (16 px en `sm`, para celdas de tabla); en modo editable el botón siempre mide 44×44 px como mínimo, sin importar `size`. |
| `aria-label`    | `string`                  | —       | Etiqueta del grupo completo en modo editable (p. ej. "Calificación"). No aplica en solo lectura.                                                                                 |

Accesibilidad: en modo editable es un `radiogroup` con foco itinerante, igual
patrón que `SegmentedControl` (flechas mueven y eligen, Home/End van a los
extremos), pero sin dar la vuelta en los límites porque el puntaje no es
circular. Cada estrella tiene nombre propio ("N de 5 estrellas"). Los botones
son de 44×44 px como mínimo (la tabla de `07` sección 2.2 pedía 36 px, pero
eso repetía el problema pendiente de `Stepper` en F14, así que se corrigió).
El relleno (ícono lleno vs. contorno) no depende solo del color de la
estrella.
