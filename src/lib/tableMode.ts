/**
 * Decisión tabla / tarjetas (OF-17, P28.2).
 *
 * Antes dependía solo del ancho (< 1024 px): con el navegador agrandado al
 * 150-200 % (la dueña tiene baja visión) el ancho CSS baja de 1024 px y las
 * tablas pasaban a tarjetas. Ahora las tarjetas (`RowCard`) quedan solo para
 * celular real: puntero táctil (`pointer: coarse`) y ancho menor a 768 px
 * (`md`). En computadora (mouse, `pointer: fine`) siempre hay tabla, con
 * desplazamiento horizontal, sin importar el zoom. Una tableta táctil de 768
 * px o más también ve la tabla.
 *
 * Se usa `pointer` (el dispositivo principal de entrada) y no `hover`, porque
 * es lo que mejor distingue "dedo" de "mouse" y no cambia con el zoom.
 */
export const CARD_LAYOUT_QUERY = '(pointer: coarse) and (max-width: 767px)'
