# Guía de Insumos para administración (dueño y administradores)

P25.6, módulo E (Insumos y control de stock). Cómo llevar el stock de los insumos de limpieza desde la oficina: cargar el catálogo, registrar ingresos, ajustar, ver quién retiró qué, controlar el depósito con la planilla impresa y atender los avisos de faltante que mandan los empleados y los coordinadores.

Esta guía es para el **dueño** y los **administradores**. Lo que hace cada empleado o coordinador desde el celular (retirar insumos y avisar faltantes) está en la [guía del empleado](guia-empleado.md#pedir-insumos) y en la [guía del coordinador](guia-supervisor.md#insumos). El resto de la administración está en la [guía de administración](guia-admin.md).

## Índice

1. [Quién puede qué](#quién-puede-qué)
2. [Cómo está ordenado](#cómo-está-ordenado)
3. [Cómo funciona el stock, en pocas palabras](#cómo-funciona-el-stock-en-pocas-palabras)
4. [Categorías](#categorías)
5. [Cargar un artículo nuevo](#cargar-un-artículo-nuevo)
6. [La lista de Stock: colores y filtros](#la-lista-de-stock-colores-y-filtros)
7. [La ficha del artículo](#la-ficha-del-artículo)
8. [Precios y su historial](#precios-y-su-historial)
9. [Registrar un ingreso o una devolución](#registrar-un-ingreso-o-una-devolución)
10. [Ajustar el stock](#ajustar-el-stock)
11. [Desactivar un artículo](#desactivar-un-artículo)
12. [Retirar en nombre de otra persona](#retirar-en-nombre-de-otra-persona)
13. [Movimientos: consultar, anular y exportar](#movimientos-consultar-anular-y-exportar)
14. [Los retiros de una persona](#los-retiros-de-una-persona)
15. [Consumo por cliente](#consumo-por-cliente)
16. [Controlar el depósito: planilla, «Cargar control» y Controles](#controlar-el-depósito-planilla-cargar-control-y-controles)
17. [Faltantes avisados](#faltantes-avisados)
18. [Las tarjetas del Resumen](#las-tarjetas-del-resumen)
19. [Lo que todavía no incluye](#lo-que-todavía-no-incluye)
20. [Cuando algo no anda](#cuando-algo-no-anda)

---

## Quién puede qué

| Quién                                   | Qué puede hacer en Insumos                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dueño**                               | Todo. Tiene el permiso «Gestionar stock» sin que nadie se lo dé.                                                                                                                                                         |
| **Administrador con «Gestionar stock»** | Todo.                                                                                                                                                                                                                    |
| **Administrador sin «Gestionar stock»** | **Mirar** toda la sección (stock, precios, movimientos, consumo, controles, faltantes) y **resolver avisos de faltante**. No puede mover stock ni cambiar el catálogo: los botones de abajo directamente no le aparecen. |
| **Empleado y coordinador**              | No ven esta sección. Tienen su propia pestaña **Insumos** en el celular, sin cantidades ni precios.                                                                                                                      |

El permiso «Gestionar stock» habilita: **Nuevo artículo**, **Editar**, **Cambiar precios**, **Desactivar**, **Ajustar**, **Ingreso**, **Retiro en nombre de**, **Anular**, **Imprimir planilla**, **Cargar control** y los cambios de categorías.

**Solo dueño: dar el permiso.** En **Configuración**, **Usuarios**, menú de la persona, **Editar roles y capacidades**, activá **Gestionar stock**. Se guarda solo al activarlo.

---

## Cómo está ordenado

En el menú de la izquierda, **Insumos** está después de **Tareas**. Junto al nombre aparece un número con los **avisos de faltante abiertos** (si no hay ninguno, no se muestra). En el celular, **Insumos** está en **Más**.

Arriba hay seis pestañas:

| Pestaña                 | Para qué sirve                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| **Stock**               | La lista de artículos con su cantidad, y los botones para operar (es la que abre primero) |
| **Movimientos**         | Todo lo que entró, salió o se ajustó; anular y exportar a Excel                           |
| **Faltantes**           | Los avisos de faltante que mandó el personal, para resolverlos                            |
| **Consumo por cliente** | Cuánto se retiró en un período, por cliente y sede, a costo y a venta                     |
| **Controles**           | El historial de los controles de stock que se cargaron                                    |
| **Categorías**          | Las categorías para ordenar el catálogo                                                   |

Las listas se actualizan solas cada minuto y dicen «Actualizado hace n s».

---

## Cómo funciona el stock, en pocas palabras

- **Cada presentación es un artículo.** «Lavandina 1 L» y «Lavandina 5 L» son dos artículos, cada uno con su código y su stock. El stock se cuenta en **unidades enteras** de esa presentación.
- **Los insumos son consumibles:** lo que se retira no vuelve. Si alguien devuelve algo, se carga como un ingreso de tipo **Devolución**.
- **No hay aprobación.** Cuando un empleado o un coordinador registra un retiro, el stock **se descuenta en ese momento**. No se puede retirar más de lo que hay.
- **Nada se borra ni se edita.** Cada movimiento queda en el historial. Un error se corrige con un **ajuste** (con motivo) o, si fue un ingreso o un retiro, con **Anular** (con motivo): el original queda marcado **Anulado** y las cantidades vuelven a su lugar.
- **El precio queda guardado en cada movimiento.** Si después cambia el precio, lo que ya pasó no se recalcula.
- **El sistema solo sabe lo que se registra.** Si alguien se lleva insumos sin cargarlos, el stock del sistema queda más alto que el real. Para eso está el control del depósito ([ver más abajo](#controlar-el-depósito-planilla-cargar-control-y-controles)).

---

## Categorías

En la pestaña **Categorías** armás los grupos para ordenar el catálogo (por ejemplo, químicos, descartables, protección, utensilios). Cada artículo tiene **una** categoría.

1. Tocá **Nueva categoría**, escribí el **Nombre** y tocá **Guardar**. El nombre no se puede repetir.
2. Con las flechas de cada fila **subís o bajás** la categoría: ese es el orden en que se ve la lista de Stock y la planilla impresa.
3. Con el lápiz cambiás el nombre.
4. **Desactivar** una categoría la saca de la lista de opciones. No se borra y se puede **Activar** de nuevo. Si todavía tiene artículos activos, no te deja: movelos de categoría primero.

Conviene tener las categorías antes de cargar artículos.

---

## Cargar un artículo nuevo

**Permiso «Gestionar stock».** Los artículos se cargan **de a uno**; no hay planilla de importación.

1. En **Stock**, tocá **Nuevo artículo**.
2. Completá:
   - **Código interno:** el que usa la empresa. No puede repetirse (da lo mismo mayúsculas o minúsculas). Después se puede corregir.
   - **Categoría.**
   - **Artículo:** el nombre (por ejemplo, «Lavandina»).
   - **Presentación (opcional):** por ejemplo, «Bidón de 5 L».
   - **Stock mínimo (opcional):** si el stock llega a este número o baja de él, la fila se marca en amarillo. Si lo dejás vacío, el artículo no avisa por mínimo. Cero es un mínimo válido.
   - **Precio de costo ($)** y **Precio de venta ($)**: se escriben como `1250,50` o `1.250,50`. No pueden ser negativos ni tener más de dos decimales.
   - **Notas (opcional).**
   - **Imagen del artículo (opcional):** tocá **Elegir imagen** y elegí una foto (JPG, PNG o WEBP, de hasta 15 MB). La app la achica sola antes de subirla. Con **Cambiar imagen** o **Quitar imagen** la modificás después.
3. Tocá **Cargar artículo**.

El artículo nace con **stock cero**. Para darle las primeras unidades, registrá un [ingreso](#registrar-un-ingreso-o-una-devolución).

Para **editar** un artículo (código, nombre, presentación, mínimo, notas o imagen), abrí su ficha y tocá **Editar**. Los **precios** no se cambian ahí: se cambian con **Cambiar precios**, para que quede el historial.

---

## La lista de Stock: colores y filtros

En la pestaña **Stock** ves, por artículo: imagen chica, código, nombre y presentación, categoría, **stock**, **mínimo**, **costo**, **venta** y **valor a costo** (stock por costo). Abajo está el total: cantidad de artículos y **valor del stock a costo** de lo que estás viendo.

**Colores de las filas:**

| Color        | Cuándo                                                                | Etiqueta      |
| ------------ | --------------------------------------------------------------------- | ------------- |
| **Amarillo** | El artículo tiene mínimo y el stock es **igual o menor** a ese mínimo | «Bajo mínimo» |
| **Rojo**     | El stock es **cero** (aunque el artículo no tenga mínimo)             | «Sin stock»   |
| Sin color    | Todo en orden, o el artículo no tiene mínimo y todavía hay stock      | —             |

Siempre hay una etiqueta de texto además del color. Un artículo **Inactivo** se ve con esa etiqueta y sin color: no cuenta como aviso.

**Filtros:**

- **Buscar por código o nombre…** (también encuentra por presentación).
- **Todas las categorías:** elegís una.
- **Solo con aviso:** deja los amarillos y los rojos.
- **Incluir inactivos:** muestra también los artículos desactivados.

Por omisión se ordena por categoría (en el orden de la pestaña Categorías) y nombre. También podés ordenar tocando el encabezado de una columna.

**Botones de arriba** (con «Gestionar stock»): **Ingreso**, **Retiro en nombre de**, **Imprimir planilla**, **Cargar control** y **Nuevo artículo**. **En cada fila:** **Ajustar** y **Ficha**.

En el celular la tabla se ve como tarjetas, con los mismos datos y botones.

---

## La ficha del artículo

Tocá **Ficha** en la fila del artículo. Ahí ves:

- Los datos y la imagen, con la etiqueta **Activo** o **Inactivo**, y «Sin mínimo» si no tiene.
- Los botones **Editar**, **Cambiar precios**, **Ajustar** y **Desactivar** (o **Activar**).
- El [historial de precios](#precios-y-su-historial).
- Los **movimientos del artículo**, con filtro de fechas **Desde** y **Hasta**: fecha y hora, tipo, cantidad con signo (`+12`, `−3`), stock que quedó, quién, para qué turno o sede, la observación y la marca **Anulado** si corresponde. Desde acá no se anula: eso se hace en la pestaña [Movimientos](#movimientos-consultar-anular-y-exportar).

---

## Precios y su historial

Cada artículo tiene un **precio de costo** (lo que le cuesta a la empresa) y un **precio de venta**. Sirven para el **valor del stock** y para el [Consumo por cliente](#consumo-por-cliente).

**Cambiar los precios:** en la ficha, **Cambiar precios**, corregí el **Precio de costo ($)** y el **Precio de venta ($)** y tocá **Guardar precios**. Si no cambiaste nada, no hay nada para guardar.

Cada cambio queda en el **historial de precios** de la ficha: cuándo, quién, de cuánto a cuánto, y el origen (**Alta del artículo**, **Cambio de precios** o **Costo de un ingreso**). Cuando un valor no cambió entre dos revisiones, dice «sin cambio».

**Los movimientos viejos no se recalculan.** Cada ingreso, retiro o ajuste guarda el costo y la venta que regían ese día. Si hoy subís la lavandina, los retiros de la semana pasada siguen valiendo lo de entonces.

---

## Registrar un ingreso o una devolución

**Permiso «Gestionar stock».** Es la forma de sumar stock: compras, reposiciones, o una devolución.

1. En **Stock**, tocá **Ingreso**.
2. En **Tipo de movimiento** elegí **Ingreso** o **Devolución**. Una devolución es algo que vuelve al depósito: suma igual que un ingreso, pero queda anotada como devolución.
3. En **Artículos**, buscá con **Buscar y agregar un artículo…** y tocá el que quieras. Por cada artículo indicá la **Cantidad** (un número entero mayor que cero) y, si lo sabés, el **Costo unitario (opcional)**. Con **Quitar** sacás una fila. Ves el stock y el costo actuales de cada artículo para guiarte.
4. Si querés, completá **Proveedor (opcional)**, **Remito o factura (opcional)** y **Observación (opcional)**. Pueden quedar vacíos: hay ingresos sin comprobante.
5. Tocá **Registrar ingreso** (o **Registrar devolución**).

**Si cargaste un costo distinto del vigente**, antes de guardar aparece **Costos distintos del vigente** y te pregunta, artículo por artículo, «¿Actualizar el precio de costo de X a $ N?». Tenés que contestar cada uno:

- **Sí, actualizar:** el precio de costo del artículo pasa a ser ese. Queda en el historial de precios como «Costo de un ingreso».
- **No, dejar el actual:** el ingreso guarda el costo que pusiste, pero el precio del artículo no cambia.

Después tocás **Confirmar ingreso**. El **precio de venta** nunca se cambia desde un ingreso: solo desde la ficha.

Al terminar ves un resumen con cada artículo, la cantidad, el costo y el **stock que quedó**.

---

## Ajustar el stock

**Permiso «Gestionar stock».** Si el número del sistema no coincide con lo que hay, **no se pisa**: se registra un ajuste, con motivo, y queda en el historial.

1. En **Stock**, en la fila del artículo, tocá **Ajustar** (también está en la ficha).
2. En **Tipo de ajuste** elegí **Sumar (+)** o **Restar (−)**.
3. Escribí la **Cantidad** (entero). Antes de confirmar, el diálogo te dice cómo va a quedar el stock. No deja restar más de lo que hay.
4. Elegí el **Motivo**: **Control de stock**, **Rotura**, **Vencimiento**, **Error de carga** u **Otro**. Con **Otro** la observación es obligatoria; en los demás es opcional.
5. Tocá **Registrar ajuste**.

Un ajuste **no se anula**. Si te equivocaste, hacé otro ajuste que lo corrija.

---

## Desactivar un artículo

Los artículos **no se borran**: se desactivan, y dejan de aparecer para retirar y en la planilla. Se puede volver a **Activar** cuando quieras.

1. En la ficha, tocá **Desactivar**.
2. Si el stock **no es cero**, el diálogo dice «Primero ajustá el stock a cero» y te ofrece **Ajustar stock**. Registrá el ajuste (por ejemplo, con motivo Vencimiento) y volvé.
3. Con stock cero, confirmá con **Desactivar**.

Un artículo desactivado con stock cero **no** cuenta como «Sin stock» ni como faltante.

---

## Retirar en nombre de otra persona

**Permiso «Gestionar stock».** Sirve cuando alguien retiró insumos pero no pudo registrarlo desde su celular (sin señal, se olvidó, retiró en el depósito). Es el mismo formulario del celular, con la elección de la persona.

1. En **Stock**, tocá **Retiro en nombre de**.
2. En **Quién retira**, elegí a la persona (empleados y coordinadores activos).
3. En **Para qué retira** elegí:
   - **Un turno:** y elegí el **Turno**. Ves los turnos de **30 días atrás a 7 días adelante**, de **todos** los clientes (sin los cancelados), porque la carga suele hacerse después del hecho.
   - **Una sede:** y elegí la **Sede**. Es para un retiro que no corresponde a un turno puntual (por ejemplo, «reposición de la semana»). En ese caso la **observación es obligatoria**.
4. En **Artículos**, agregá cada artículo con su cantidad. Solo ofrece artículos activos con stock. Si ponés más de lo que hay, te avisa «No alcanza el stock: hay N».
5. Escribí una observación si querés (obligatoria con sede) y tocá **Registrar retiro**.

El retiro queda **a nombre de la persona**, con tu nombre como quien lo registró. Descuenta el stock en el momento. Al terminar ves el resumen.

> **Si además de administrar trabajás turnos** (sos dueño o administrador y también empleado o coordinador): cuando cargás un retiro **en nombre de otra persona**, ves las opciones de la administración, es decir, de 30 días atrás a 7 días adelante y todos los turnos. Cuando retirás **para vos mismo** desde la pestaña **Insumos** de tu celular, valen las reglas de tu rol de empleado o coordinador (ver las guías del [empleado](guia-empleado.md#pedir-insumos) y del [coordinador](guia-supervisor.md#insumos)).

---

## Movimientos: consultar, anular y exportar

La pestaña **Movimientos** muestra, uno por uno, todo lo que pasó con el stock: **Ingreso**, **Devolución**, **Retiro**, **Ajuste**, **Control de stock** y **Anulación**. Cada movimiento es una tarjeta con su fecha y hora, quién lo registró, la persona que retiró (tocándola abrís sus [retiros](#los-retiros-de-una-persona)), el turno o la sede, el proveedor y el comprobante, el motivo del ajuste y la observación. Abajo, la lista de artículos con su cantidad, el costo y la venta de cada uno, el stock que quedó y los totales a costo y a venta. Tocando un artículo abrís su ficha.

**Filtros:** fechas **Desde** y **Hasta**, tipo, persona, artículo, cliente y sede (la lista de sedes se acota al cliente elegido). Todos arrancan en «Todos»; **Limpiar filtros** los vuelve a ese estado. En pantalla se ven hasta 500 líneas: si hay más, un aviso te pide acotar los filtros.

### Anular un movimiento

**Permiso «Gestionar stock».** Sirve para corregir un **ingreso**, una **devolución** o un **retiro** cargado por error.

1. En la tarjeta del movimiento, tocá **Anular**.
2. Escribí el **motivo** (es obligatorio). El diálogo te explica qué va a pasar: si anulás un **retiro**, las cantidades **vuelven al stock**; si anulás un **ingreso** o una **devolución**, las cantidades **se descuentan**.
3. Confirmá.

El movimiento original queda con la etiqueta tachada **Anulado**, con quién lo anuló y por qué, y aparece un movimiento nuevo de tipo **Anulación** enlazado a él. Si anulás un ingreso cuyas unidades ya se usaron en retiros, no te deja (no puede quedar stock negativo): primero resolvé esos retiros.

Los **ajustes**, los **controles** y las **anulaciones** no se anulan: se corrigen con un ajuste nuevo.

### Exportar a Excel

Con **Exportar a Excel** bajás **todo lo que tenés filtrado** (no solo las 500 líneas que se ven), con una fila por artículo de cada movimiento: fecha, tipo, estado, persona, quién registró, cliente, sede, turno, proveedor, comprobante, motivo, código, artículo, presentación, cantidad, costo y venta unitarios y totales, y stock que quedó. El archivo se llama `movimientos-insumos-AAAA-MM-DD.xlsx`. Los importes salen como números con formato de pesos.

---

## Los retiros de una persona

En la ficha de un empleado o de un coordinador (**Empleados**) hay una pestaña **Retiros**. Muestra, por defecto, el **mes en curso** (podés cambiar las fechas o tocar **Este mes**): cuándo retiró, para qué turno o sede, la observación, los artículos y cantidades, los retiros **Anulado** con su motivo y, si los cargó la oficina, «Lo cargó X». Arriba está el **total a venta del período**, sin contar los anulados.

La ven el dueño y todos los administradores, tengan o no «Gestionar stock». El empleado y el coordinador nunca ven precios.

---

## Consumo por cliente

La pestaña **Consumo por cliente** suma lo que se retiró en un período y lo reparte por cliente y por sede, **a costo y a venta**. Sirve para saber cuánto insumo consume cada cliente.

1. Elegí el período con **Desde** y **Hasta** (arranca en el mes en curso; hay atajos **Este mes** y **Mes anterior**).
2. Si querés, filtrá por cliente y por sede.
3. Ves el **total del período** y, por cliente y por sede, las unidades y los importes. Tocando una sede se despliega el **detalle por artículo**.
4. **Exportar a Excel** baja las filas del período.

Los retiros **anulados no cuentan**, y se usan los precios que tenía cada retiro cuando se hizo. Los retiros hechos «para una sede» (sin turno) se suman a esa sede.

---

## Controlar el depósito: planilla, «Cargar control» y Controles

Como el sistema solo sabe lo que se registra, conviene **contar el depósito de vez en cuando** y comparar. Son tres pasos: imprimir la planilla, contar a mano y pasar lo contado al sistema. **Permiso «Gestionar stock»** para los dos primeros.

### 1. Imprimir la planilla

1. En **Stock**, tocá **Imprimir planilla**.
2. Si querés, elegí una **Categoría** (por omisión, la que tenías filtrada). Con «Todas las categorías» sale todo, separado por categoría.
3. Se abre la vista previa. Tocá **Imprimir o guardar como PDF**.

La planilla es una hoja A4 vertical con el membrete de la empresa. Tiene la **fecha** y «Revisó: ____». Cada fila es un artículo activo, en el mismo orden que la lista de Stock, con: código, artículo, presentación, **stock del sistema**, un espacio para lo **Contado**, un casillero para tildar, un espacio para el **+ / −** y otro para la **Observación**. Al pie: observaciones generales, **firma y aclaración** del responsable y la fecha. Se puede imprimir en cualquier momento.

### 2. Contar

Con la hoja en la mano, contá lo que hay en el depósito y anotá la cantidad en **Contado**, y la diferencia en **+ / −** si querés. Firmá al pie.

### 3. Cargar control

1. En **Stock**, tocá **Cargar control**.
2. Indicá cuándo se hizo el conteo: **Día del control** y **Hora del control** (por omisión, ahora; no puede ser en el futuro).
3. En **Quién revisó** elegí **Una persona de la app** (y elegila en la lista **Persona**) o **Un nombre escrito**. Es una cosa o la otra. No viene ninguna elegida para que el control no quede a nombre de quien lo carga sin querer.
4. Escribí las **Observaciones** si hay.
5. En la tabla de artículos, escribí la cantidad en **Contado**. Podés buscar un artículo o filtrar por categoría.
   - **Una fila en blanco no se toca.** No significa cero: significa «no lo conté».
   - **Cero es un conteo válido** («no hay nada»).
6. Tocá **Confirmar control**. Ves un resumen con el **stock del sistema**, lo **contado** y la **diferencia** de cada artículo.

**Cómo se calcula la diferencia:** contra el **stock que el sistema tenía a la hora del control**, no contra el de ahora. Por eso, si entre que contaste y que cargaste alguien hizo un retiro, ese retiro **no se toma como un faltante**. La pantalla te avisa en cada artículo: «Tuvo 2 movimientos después de esa hora; se tienen en cuenta».

Las diferencias distintas de cero se registran como **un solo movimiento «Control de stock»** en Movimientos, con el nombre de quien revisó. Los artículos sin diferencia no generan nada.

### Controles

La pestaña **Controles** guarda el historial: fecha y hora del conteo, quién revisó, quién lo cargó y cuándo, las observaciones, cuántos artículos se contaron y el detalle de las diferencias.

---

## Faltantes avisados

Los empleados y los coordinadores pueden **avisar que falta un insumo** desde el celular. No hay pedidos de reposición: el aviso es para que la oficina se entere. Aparecen en la pestaña **Faltantes** y, como número, junto a **Insumos** en el menú.

Cada aviso muestra quién avisó y cuándo, el artículo (con enlace a su ficha) o, si lo escribió a mano porque no está cargado, el texto con la etiqueta **No está en el catálogo**, el turno o la sede, y el comentario. Los **abiertos** van primero.

**Resolver un aviso** (lo puede hacer cualquier dueño o administrador, **aunque no tenga «Gestionar stock»**):

1. Tocá **Resolver** en el aviso.
2. Escribí la **Nota de resolución**: contale a quien avisó qué pasó. Por ejemplo, «Se compró» o «Hay en el depósito». Es obligatoria.
3. Tocá **Resolver**.

El aviso pasa a **Resuelto**, con la nota y quién lo resolvió. Quien avisó lo ve en **Mis avisos** de su celular, con tu nota.

Si el faltante es de un artículo que sí existe, lo normal es: comprar, registrar el [ingreso](#registrar-un-ingreso-o-una-devolución) y resolver el aviso. Si el artículo no estaba cargado, podés [cargarlo](#cargar-un-artículo-nuevo) para que la próxima vez se elija del catálogo.

---

## Las tarjetas del Resumen

En el **Resumen**, debajo de los indicadores de hoy, hay dos tarjetas de Insumos (solo las ven el dueño y los administradores):

- **Faltantes avisados:** cuántos **artículos** tienen aviso abierto (si dos personas avisan del mismo, cuenta uno) y abajo cuántos avisos hay. Amarilla si hay alguno. Al tocarla vas a la pestaña **Faltantes**.
- **Stock bajo:** la cantidad de artículos en aviso, y abajo el detalle «N sin stock · M bajo mínimo». **Roja** si hay algún artículo sin stock, **amarilla** si solo hay bajo mínimo. Al tocarla vas a **Stock** con **Solo con aviso** puesto.

Si hay un problema para calcular los números, las tarjetas no se muestran y el resto del Resumen sigue igual.

---

## Lo que todavía no incluye

- **Herramientas y equipos que se devuelven** (aspiradoras, escobillones, etc.): por ahora el stock es de **consumibles**. Si la empresa decide controlar herramientas, hace falta un circuito de préstamo y devolución por persona, que sería una ampliación.
- **Pedidos de reposición:** solo hay avisos de faltante.
- **Retiros sin conexión:** un retiro necesita señal. Sin señal, la persona puede cargarlo después desde el celular, o lo carga la oficina en su nombre.
- **Importar el catálogo desde una planilla:** los artículos se cargan de a uno.

---

## Cuando algo no anda

- **No veo los botones «Ingreso», «Ajustar» o «Nuevo artículo»:** te falta el permiso **Gestionar stock**. Pedile al dueño que te lo active (ver [Quién puede qué](#quién-puede-qué)). Mientras tanto podés mirar todo y resolver avisos.
- **No me deja desactivar un artículo:** tiene stock. Ajustalo a cero primero.
- **No me deja anular un ingreso:** parte de esas unidades ya se retiraron. Anulá o resolvé primero esos retiros.
- **«No alcanza el stock»:** el retiro pide más de lo que hay. Revisá la cantidad o hacé antes el ingreso.
- **Un empleado dice que un insumo figura «Sin stock» y hay en el depósito:** el sistema tiene cero. Registrá el [ingreso](#registrar-un-ingreso-o-una-devolución) o hacé un [control](#controlar-el-depósito-planilla-cargar-control-y-controles).
- **Un empleado dice que no encuentra su turno al retirar:** solo ve sus turnos de hoy y de los próximos 7 días. Si el retiro es de otro día, cargalo vos con [Retiro en nombre de](#retirar-en-nombre-de-otra-persona).

Los problemas generales (sesión, instalación, sin conexión) están en [`troubleshooting.md`](troubleshooting.md).
