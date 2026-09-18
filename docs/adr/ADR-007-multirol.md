# ADR-007 · Varios roles por persona

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-013, P-038, P-042

## Problema
Un supervisor puede hacer servicios de limpieza; un administrador podría supervisar. El modelo de un rol por usuario obligaría a dos cuentas por persona.

## Alternativas
1. Un rol por usuario (columna en `profiles`); dos cuentas para dos funciones.
2. Tabla `user_roles` (persona × rol) y una sola cuenta.

## Decisión
Alternativa 2. Una tabla `profiles` para todas las personas, `employees` para los datos laborales de quien tiene rol empleado o supervisor, `user_roles` para los roles.

## Motivo
Refleja la operación real; una sola sesión en el celular; los claims del JWT llevan un array de roles.

## Consecuencias
- Las tres vías se muestran según los roles: el tabbar del empleado suma "Supervisión" en Más, y viceversa.
- La redirección tras el login prioriza: administración en escritorio; empleado en móvil; supervisor si solo tiene ese rol.
- Reglas: el rol empleado o supervisor exige fila en `employees`; siempre queda al menos un dueño.
- Caso borde: un supervisor asignado a un turno donde trabaja como empleado recibe advertencia y no puede calificarse a sí mismo.
