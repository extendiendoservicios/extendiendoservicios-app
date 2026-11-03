# Informes en A4 horizontal y cronograma del empleado (P27.4)

Observaciones de los dueños del 2 de noviembre de 2026: OD-01 a OD-03, OD-18 y OD-19.

## Orientación de la hoja imprimible (OD-18)

`PrintSheet` (`src/features/print/PrintSheet.tsx`) recibe la prop `orientation`:

- `portrait` (por omisión): A4 vertical, 210 × 297 mm, margen de 15 mm. Es la del control de stock.
- `landscape`: A4 horizontal, 297 × 210 mm, margen de 10 mm (277 mm útiles de ancho).

La vista previa y el papel usan la misma orientación. En pantalla, la hoja toma el ancho y el alto de página de la orientación (también para las líneas que marcan los cortes de página y para la paginación simulada del bloque de firmas). Al imprimir, `print.css` declara una página con nombre (`@page landscape`) y la aplica al portal con `[data-orientation='landscape']`. La clase `print-exact` fuerza que salgan los colores de fondo.

Informes que pasaron a horizontal: detalle de asistencia (ficha del empleado y del coordinador), licencias y ausencias, resumen de servicios por cliente y el cronograma. Todos terminan con el pie de firma en conformidad (`PrintSignatures` con el texto de conformidad). El resumen por cliente no tenía texto de conformidad ni segundo firmante: ahora lleva «Responsable (administración)» y «Cliente».

## Licencias día por día (OD-19)

En el detalle de asistencia, cada licencia o vacación ocupa una fila por cada día corrido dentro del período, con la leyenda «Licencia — <motivo>» (o «Sin motivo»). Una licencia abierta llega hasta el fin del período o hasta hoy, lo que ocurra primero. El contador «Licencias» de los datos del encabezado sigue contando licencias, no días.

## Pestaña «Cronograma» (OD-01 a OD-03)

Está en la ficha del empleado (ADM-17), después de «Datos» (`?pestana=cronograma`). Lógica en `src/features/employees/cronograma.ts` y pantalla en `src/features/employees/components/EmployeeCronogramaTab.tsx`.

- Selector de mes y botón «Imprimir» (vista previa en A4 horizontal con la misma grilla que se ve en la pestaña).
- Encabezado: «MES DE <MES> <AÑO>», línea «FIRMA DE EMPLEADO / ACLARACIÓN / DNI» para completar a mano y «<legajo> <NOMBRE>».
- Grilla de lunes a domingo, una fila por semana. Cada celda lleva el número del día a la izquierda y, a la derecha, los turnos apilados: casillas de inicio y fin y, debajo, la sede en mayúsculas con el color de su cliente.
- Licencia: la celda entera con el motivo en mayúsculas o «LICENCIA». Feriado: la celda entera en rojo con «FERIADO». Sin nada: vacía. Los días de las semanas parciales que caen en otro mes quedan en gris, sin número.
- Datos: turnos con asignación vigente del empleado no cancelados, también los futuros (`v_assignments_board`); licencias (`employee_leaves`) y feriados (`holidays`). Una licencia abierta llega hasta el fin del mes.
- Si un día tiene licencia, manda la licencia. Si un feriado tiene turnos, se muestran los turnos con una franja roja «FERIADO».
- En celular la grilla conserva el diseño de la hoja y se desplaza horizontalmente.
