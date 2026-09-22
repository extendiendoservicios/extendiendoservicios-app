#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generar-plantilla-carga-inicial.py — DATA-001 y DATA-002
(08_Fases_y_Backlog.md, F19 · Staging, UAT y carga inicial).

Genera `docs/plantilla-carga-inicial.xlsx`: la planilla que la empresa
completa con sus datos reales (clientes, sedes, empleados, servicios...)
para la carga inicial de la Plataforma Base. La lee gente que no trabaja
en software, así que el texto va en español con voseo, sin nombres de
columnas de la base de datos ni de las enumeraciones en inglés.

Es un script Python (no Node/TypeScript, a diferencia del resto de
`scripts/`) porque la planilla se generó con la skill de Excel del
proyecto (openpyxl). No es una dependencia del stack de la app: para
volver a correrlo hace falta Python 3 con `openpyxl` instalado
(`pip install openpyxl`), nada más. Uso: `python scripts/generar-plantilla-carga-inicial.py`
desde la raíz de `app/` (o con la ruta completa). Sobrescribe el `.xlsx`.

Cada regla de validación de esta planilla replica una restricción real
de `supabase/migrations/` (0002 enumeraciones, 0005 clientes y sedes,
0006 empleados, 0007 servicios, 0004 feriados, 0010 criterios, 0016
formato de CUIT/CUIL/DNI) para que nada que la base vaya a rechazar
llegue siquiera a completarse acá. El detalle de qué respalda cada
columna está en `docs/carga-inicial.md` (DATA-010, tarea de F19) y en
el reporte de la tarea P04.8.
"""

from __future__ import annotations

import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

# -------------------------------------------------------------------------------------------
# Paleta y tipografía: los mismos tonos de `07_Design_System.md` (sección de tokens de color),
# para que la planilla se sienta parte de la misma marca sin tocar ningún asset de `Images/`.
# -------------------------------------------------------------------------------------------

FUENTE = "Arial"
COLOR_PRIMARIO = "569EA4"
COLOR_PRIMARIO_OSCURO = "356A70"
COLOR_PRIMARIO_CLARO = "F2F8F9"
COLOR_TEXTO = "13151E"
COLOR_TEXTO_2 = "4A5061"
COLOR_BORDE = "D5DAE3"
COLOR_EJEMPLO = "FDF3E0"  # `--warning-bg`: usado para marcar lo que hay que borrar.
COLOR_EJEMPLO_TEXTO = "9A6408"  # `--warning` oscurecido, tono de badge del design system.
COLOR_OBLIGATORIA = "CE4B52"  # `--danger`: asterisco de columna obligatoria.
COLOR_SEPARADOR = "E6E9EF"

FILAS_DE_DATOS = 300  # Hasta esta fila llegan las validaciones de cada hoja (margen generoso).

fuente_encabezado = Font(name=FUENTE, size=10.5, bold=True, color="FFFFFF")
fuente_dato = Font(name=FUENTE, size=10.5, color=COLOR_TEXTO)
fuente_ejemplo = Font(name=FUENTE, size=10.5, italic=True, color=COLOR_EJEMPLO_TEXTO)
fuente_nota = Font(name=FUENTE, size=9.5, italic=True, color=COLOR_TEXTO_2)
fuente_titulo_hoja = Font(name=FUENTE, size=13, bold=True, color=COLOR_PRIMARIO_OSCURO)

relleno_encabezado = PatternFill("solid", fgColor=COLOR_PRIMARIO)
relleno_ejemplo = PatternFill("solid", fgColor=COLOR_EJEMPLO)
relleno_separador = PatternFill("solid", fgColor=COLOR_SEPARADOR)
relleno_alerta_roja = PatternFill("solid", fgColor="FBEBEC")

borde_fino = Border(
    left=Side(style="thin", color=COLOR_BORDE),
    right=Side(style="thin", color=COLOR_BORDE),
    top=Side(style="thin", color=COLOR_BORDE),
    bottom=Side(style="thin", color=COLOR_BORDE),
)

ALINEACION_ENCABEZADO = Alignment(horizontal="center", vertical="center", wrap_text=True)
ALINEACION_DATO = Alignment(horizontal="left", vertical="center")


class Columna:
    """Una columna de una hoja de datos: encabezado, ancho, tipo de validación y ayuda."""

    def __init__(
        self,
        titulo: str,
        ancho: int,
        obligatoria: bool,
        ayuda: str,
        tipo: str = "texto",
        opciones: list[str] | None = None,
        minimo: float | None = None,
        maximo: float | None = None,
    ) -> None:
        self.titulo = titulo
        self.ancho = ancho
        self.obligatoria = obligatoria
        self.ayuda = ayuda
        self.tipo = tipo
        self.opciones = opciones or []
        self.minimo = minimo
        self.maximo = maximo


def _titulo_con_asterisco(columna: Columna) -> str:
    return f"{columna.titulo} (*)" if columna.obligatoria else columna.titulo


def _aplicar_validacion(ws: Worksheet, columna: Columna, letra: str, fila_desde: int, fila_hasta: int) -> None:
    """Agrega la `DataValidation` de Excel que corresponde al tipo de columna.

    Las listas desplegables salen de las etiquetas en español de `04_Modelo_de_Datos.md`
    sección 3 (las enumeraciones de Postgres). Los patrones de CUIT/CUIL/DNI y las horas sin
    cruce de medianoche replican los `check` de `supabase/migrations/0016_hardening.sql` y
    `0007_services_shifts_assignments.sql`.
    """
    rango = f"{letra}{fila_desde}:{letra}{fila_hasta}"

    if columna.tipo == "lista":
        formula = '"' + ",".join(columna.opciones) + '"'
        dv = DataValidation(
            type="list",
            formula1=formula,
            allow_blank=not columna.obligatoria,
            showDropDown=False,  # `False` en openpyxl es lo que en Excel SÍ muestra la flechita.
            showErrorMessage=True,
            errorTitle="Opción no válida",
            error="Elegí una opción de la lista desplegable, no escribas un valor distinto.",
        )
    elif columna.tipo == "si_no":
        dv = DataValidation(
            type="list",
            formula1='"Sí,No"',
            allow_blank=not columna.obligatoria,
            showDropDown=False,
            showErrorMessage=True,
            errorTitle="Opción no válida",
            error='Elegí "Sí" o "No" de la lista desplegable.',
        )
    elif columna.tipo == "cuit" or columna.tipo == "cuil":
        # 11 dígitos exactos, sin puntos ni guiones (clients_cuit_format_check /
        # employees_cuil_format_check de 0016_hardening.sql).
        dv = DataValidation(
            type="custom",
            formula1=f'=AND(LEN({letra}{fila_desde})=11,ISNUMBER(VALUE({letra}{fila_desde})))',
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorTitle="Tiene que tener 11 dígitos",
            error="Ingresá los 11 dígitos, sin puntos, guiones ni espacios (por ejemplo 30712345678).",
        )
    elif columna.tipo == "dni":
        # `employees_dni_format_check` de 0016_hardening.sql exige solo dígitos, sin largo fijo.
        # Acá se acota a 6-9 dígitos (el rango real de un DNI argentino) para ayudar a detectar
        # errores de tipeo, pero como **la base no impone ese largo**, el aviso no bloquea: sale
        # como advertencia y quien completa puede seguir igual. La regla general de esta plantilla
        # es bloquear solo donde Postgres también rechazaría (por ejemplo CUIT y CUIL de 11
        # dígitos, que sí son un `check`), y avisar donde es una ayuda nuestra. Si bloqueara,
        # un documento legítimo fuera de ese rango dejaría a alguien sin poder cargarse.
        dv = DataValidation(
            type="custom",
            formula1=(
                f'=AND(LEN({letra}{fila_desde})>=6,LEN({letra}{fila_desde})<=9,'
                f'ISNUMBER(VALUE({letra}{fila_desde})))'
            ),
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorStyle="warning",
            errorTitle="Revisá el DNI",
            error=(
                "Ingresá solo números, sin puntos ni espacios (por ejemplo 30111222). "
                "Si el documento es correcto y tiene otra cantidad de dígitos, aceptá igual."
            ),
        )
    elif columna.tipo == "fecha":
        dv = DataValidation(
            type="date",
            operator="between",
            formula1=datetime.date(2000, 1, 1),
            formula2=datetime.date(2100, 12, 31),
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorTitle="Fecha no válida",
            error="Ingresá una fecha con el formato DD/MM/AAAA.",
        )
    elif columna.tipo == "hora":
        dv = DataValidation(
            type="time",
            operator="between",
            formula1="0:00",
            formula2="23:59",
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorTitle="Hora no válida",
            error="Ingresá una hora con el formato HH:MM, de 00:00 a 23:59.",
        )
    elif columna.tipo == "hora_fin":
        # Además de ser una hora válida, tiene que ser posterior a la de inicio (columna
        # anterior): el servicio no puede cruzar la medianoche (services_time_range_check).
        letra_inicio = get_column_letter(ws[f"{letra}1"].column - 1)
        dv = DataValidation(
            type="custom",
            formula1=(
                f'=AND(ISNUMBER({letra}{fila_desde}),{letra}{fila_desde}>{letra_inicio}{fila_desde})'
            ),
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorTitle="Tiene que ser posterior a la hora de inicio",
            error="La hora de fin tiene que ser una hora válida y posterior a la de inicio (el servicio no puede cruzar la medianoche).",
        )
    elif columna.tipo == "entero":
        dv = DataValidation(
            type="whole",
            operator="between",
            formula1=columna.minimo if columna.minimo is not None else 0,
            formula2=columna.maximo if columna.maximo is not None else 999999,
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorTitle="Número no válido",
            error=f"Ingresá un número entero entre {columna.minimo} y {columna.maximo}.",
        )
    elif columna.tipo == "decimal":
        dv = DataValidation(
            type="decimal",
            operator="between",
            formula1=columna.minimo if columna.minimo is not None else -999999,
            formula2=columna.maximo if columna.maximo is not None else 999999,
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorTitle="Número no válido",
            error="Ingresá un número (podés usar coma o punto decimal).",
        )
    elif columna.tipo == "email":
        dv = DataValidation(
            type="custom",
            formula1=f'=ISNUMBER(FIND("@",{letra}{fila_desde}))',
            allow_blank=not columna.obligatoria,
            showErrorMessage=True,
            errorTitle="Email no válido",
            error="Ingresá un email con arroba (@), por ejemplo nombre@correo.com.",
        )
    else:
        return  # Texto libre: sin validación de Excel.

    ws.add_data_validation(dv)
    dv.add(rango)


def _crear_hoja_datos(
    wb: Workbook,
    nombre: str,
    titulo_visible: str,
    descripcion: str,
    columnas: list[Columna],
    filas_ejemplo: list[list],
) -> Worksheet:
    """Arma una hoja de datos completa: título, encabezados, ejemplos y validaciones."""
    ws = wb.create_sheet(nombre)
    ws.sheet_view.showGridLines = False

    n_columnas = len(columnas)
    ultima_letra = get_column_letter(n_columnas)

    # Fila 1: título visible de la hoja, combinado.
    ws.merge_cells(f"A1:{ultima_letra}1")
    ws["A1"] = titulo_visible
    ws["A1"].font = fuente_titulo_hoja
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 22

    # Fila 2: descripción breve de la hoja, combinada.
    ws.merge_cells(f"A2:{ultima_letra}2")
    ws["A2"] = descripcion
    ws["A2"].font = fuente_nota
    ws["A2"].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws.row_dimensions[2].height = 28

    fila_encabezado = 3
    fila_ejemplo_desde = fila_encabezado + 1
    fila_ejemplo_hasta = fila_ejemplo_desde + len(filas_ejemplo) - 1
    fila_separador = fila_ejemplo_hasta + 1
    fila_datos_desde = fila_separador + 1
    fila_datos_hasta = fila_datos_desde + FILAS_DE_DATOS

    # Encabezados con comentario de ayuda.
    for i, columna in enumerate(columnas, start=1):
        letra = get_column_letter(i)
        celda = ws[f"{letra}{fila_encabezado}"]
        celda.value = _titulo_con_asterisco(columna)
        celda.font = fuente_encabezado
        celda.fill = relleno_encabezado
        celda.alignment = ALINEACION_ENCABEZADO
        celda.border = borde_fino
        celda.comment = Comment(columna.ayuda, "Extendiendo Servicios")
        ws.column_dimensions[letra].width = columna.ancho
    ws.row_dimensions[fila_encabezado].height = 34

    # Filas de ejemplo (ficticias, con relleno de advertencia).
    for offset, fila in enumerate(filas_ejemplo):
        fila_actual = fila_ejemplo_desde + offset
        for i, valor in enumerate(fila, start=1):
            letra = get_column_letter(i)
            celda = ws[f"{letra}{fila_actual}"]
            celda.value = valor
            celda.font = fuente_ejemplo
            celda.fill = relleno_ejemplo
            celda.alignment = ALINEACION_DATO
            celda.border = borde_fino
            if columnas[i - 1].tipo == "fecha":
                celda.number_format = "DD/MM/YYYY"
            elif columnas[i - 1].tipo in ("hora", "hora_fin"):
                celda.number_format = "HH:MM"
        ws.row_dimensions[fila_actual].height = 16
    if filas_ejemplo:
        ws[f"A{fila_ejemplo_desde}"].comment = Comment(
            "Esta fila es un EJEMPLO ficticio (ninguna persona ni empresa real). Sirve para "
            "que veas cómo se completa cada columna. Borrala antes de devolvernos la planilla.",
            "Extendiendo Servicios",
        )

    # Fila separadora, marca visual de dónde empiezan los datos reales.
    ws.merge_cells(f"A{fila_separador}:{ultima_letra}{fila_separador}")
    celda_separador = ws[f"A{fila_separador}"]
    celda_separador.value = "Borrá la fila de ejemplo de arriba y cargá tus datos reales desde la fila de abajo ↓"
    celda_separador.font = Font(name=FUENTE, size=9.5, bold=True, color=COLOR_TEXTO_2)
    celda_separador.fill = relleno_separador
    celda_separador.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[fila_separador].height = 16

    # Formato y validación de las filas de datos reales (vacías, listas para completar).
    for i, columna in enumerate(columnas, start=1):
        letra = get_column_letter(i)
        for fila_actual in range(fila_datos_desde, fila_datos_hasta + 1):
            celda = ws[f"{letra}{fila_actual}"]
            celda.font = fuente_dato
            celda.alignment = ALINEACION_DATO
            celda.border = borde_fino
            if columna.tipo == "fecha":
                celda.number_format = "DD/MM/YYYY"
            elif columna.tipo in ("hora", "hora_fin"):
                celda.number_format = "HH:MM"
            elif columna.tipo in ("cuit", "cuil", "dni"):
                celda.number_format = "@"  # Texto: no perder ceros ni pasar a notación científica.
        _aplicar_validacion(ws, columna, letra, fila_datos_desde, fila_datos_hasta)
        # Las validaciones de tipo lista/si_no/etc. también alcanzan la fila de ejemplo, así el
        # ejemplo se ve exactamente como se espera que se complete el resto.
        if columna.tipo not in ("texto",):
            _aplicar_validacion(ws, columna, letra, fila_ejemplo_desde, fila_ejemplo_hasta)

    ws.freeze_panes = f"A{fila_datos_desde}"
    return ws


# -------------------------------------------------------------------------------------------
# Hoja "Instrucciones"
# -------------------------------------------------------------------------------------------


def _crear_hoja_instrucciones(wb: Workbook) -> None:
    ws = wb.create_sheet("Instrucciones")
    # `create_sheet` la agrega al final: la lleva a la posición 0 (primera solapa del libro).
    indice_actual = wb.sheetnames.index("Instrucciones")
    wb.move_sheet("Instrucciones", offset=-indice_actual)
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 108

    fila = 1

    def titulo(texto: str, tamano: int = 15) -> None:
        nonlocal fila
        ws.merge_cells(f"B{fila}:B{fila}")
        c = ws[f"B{fila}"]
        c.value = texto
        c.font = Font(name=FUENTE, size=tamano, bold=True, color=COLOR_PRIMARIO_OSCURO)
        fila += 1

    def subtitulo(texto: str) -> None:
        nonlocal fila
        fila += 1
        c = ws[f"B{fila}"]
        c.value = texto
        c.font = Font(name=FUENTE, size=12, bold=True, color=COLOR_TEXTO)
        fila += 1

    def parrafo(texto: str, alto: int = 30) -> None:
        nonlocal fila
        c = ws[f"B{fila}"]
        c.value = texto
        c.font = Font(name=FUENTE, size=10.5, color=COLOR_TEXTO)
        c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        ws.row_dimensions[fila].height = alto
        fila += 1

    def item(texto: str, alto: int = 16) -> None:
        parrafo(f"•  {texto}", alto=alto)

    titulo("Carga inicial de datos — Extendiendo Servicios", 16)
    parrafo(
        "Esta planilla sirve para pasarnos, en un solo archivo, los datos con los que arranca "
        "la plataforma: tus clientes, sus sedes, tu personal y los servicios que prestás. La "
        "completa quien conozca esa información en la empresa; no hace falta saber nada de "
        "sistemas.",
        alto=42,
    )

    subtitulo("Cómo está organizada")
    parrafo(
        "Cada solapa de abajo (al pie de la pantalla) es una hoja con un tipo de dato. Te "
        "conviene completarlas en este orden, porque las de más adelante usan datos de las "
        "anteriores:",
        alto=30,
    )
    for texto in [
        "1. Clientes — las empresas a las que les prestás servicio.",
        "2. Contactos — las personas de referencia en cada cliente.",
        "3. Sedes — los lugares donde se trabaja (puede haber varias por cliente).",
        "4. Empleados — tu personal de limpieza.",
        "5. Supervisores — quienes supervisan el trabajo del personal.",
        "6. Servicios — qué días y en qué horario se trabaja en cada sede.",
        "7. Habilitaciones — en qué clientes puede trabajar cada persona (opcional).",
        "8. Feriados — el calendario de feriados que la empresa respeta.",
        "9. Criterios — las pautas con las que los supervisores califican el trabajo.",
    ]:
        item(texto)

    subtitulo("Reglas generales para completar cada hoja")
    for texto in [
        "Las columnas marcadas con (*) son obligatorias: si falta un dato ahí, esa fila entera "
        "no se va a poder cargar.",
        "En la primera fila de datos de cada hoja hay un EJEMPLO con fondo amarillo, con "
        "personas y empresas inventadas. Fijate cómo está completado y después BORRALO antes "
        "de devolvernos la planilla (dejá solamente tus datos reales).",
        "Pasando el mouse sobre el título de una columna aparece una ayuda con lo que se "
        "espera en esa columna.",
        "Donde hay una flechita a la derecha de la celda, es una lista de opciones: hacé clic "
        "y elegí una, no escribas el valor a mano.",
        "Las fechas se escriben como DD/MM/AAAA (por ejemplo 05/03/2026) y las horas como "
        "HH:MM, en formato de 24 horas (por ejemplo 14:30 para las 2:30 de la tarde).",
        "El CUIT y el CUIL se escriben con sus 11 números, sin puntos ni guiones (por ejemplo "
        "30712345678). El DNI se escribe solo con números, sin puntos.",
        "No hace falta llenar todas las filas de una vez: podés guardar y seguir después. Lo "
        "importante es que, cuando nos la devuelvas, ya no queden filas de ejemplo.",
        "Si un dato no lo tenés a mano (por ejemplo, la ubicación exacta de una sede en el "
        "mapa), dejalo en blanco: eso se puede completar después, ya usando la aplicación.",
    ]:
        item(texto, alto=26)

    subtitulo("Sobre el personal (hojas Empleados y Supervisores)")
    parrafo(
        "Cada persona que va a usar la aplicación necesita un email propio: es el usuario con "
        "el que va a entrar. Si una persona es empleada Y supervisora al mismo tiempo, cargala "
        "en las DOS hojas, con el mismo DNI en ambas — el sistema la va a reconocer como la "
        "misma persona y le va a dar los dos accesos. Las contraseñas iniciales no van en esta "
        "planilla: te las vamos a hacer llegar aparte, por un medio seguro, una vez que "
        "carguemos los datos.",
        alto=56,
    )

    subtitulo("Sobre las habilitaciones")
    parrafo(
        "Si una persona no aparece en la hoja Habilitaciones, va a poder trabajar en cualquier "
        "cliente. Cargala ahí solamente si querés restringirla a determinados clientes.",
        alto=30,
    )

    subtitulo("Datos personales")
    parrafo(
        "Esta planilla va a tener datos personales reales (DNI, domicilios, teléfonos). "
        "Enviánosla por un medio que ustedes consideren seguro y evitá dejarla en carpetas "
        "compartidas de acceso público.",
        alto=30,
    )

    subtitulo("Ante cualquier duda")
    parrafo(
        "Escribinos y te ayudamos a completarla. Preferimos una consulta de más a una planilla "
        "con datos incompletos o inventados para poder mandarla.",
        alto=26,
    )


# -------------------------------------------------------------------------------------------
# Definición de cada hoja de datos
# -------------------------------------------------------------------------------------------


def construir_libro() -> Workbook:
    wb = Workbook()
    wb.remove(wb.active)  # La hoja en blanco que Workbook() trae por defecto.

    # ---- Clientes --------------------------------------------------------------------------
    columnas_clientes = [
        Columna(
            "CUIT", 16, True,
            "Los 11 números del CUIT del cliente, sin puntos ni guiones. Es la clave con la "
            "que vamos a vincular sus contactos, sedes y servicios en las otras hojas: "
            "escribilo igual en todas.",
            tipo="cuit",
        ),
        Columna("Razón social", 34, True, "El nombre legal completo del cliente, como figura en su CUIT."),
        Columna(
            "Nombre de fantasía", 26, False,
            "Como lo conoce la gente, si es distinto de la razón social (por ejemplo un nombre comercial). Dejalo en blanco si es el mismo.",
        ),
        Columna("Dirección administrativa", 34, False, "El domicilio de la oficina o de facturación del cliente (no el de las sedes donde se trabaja: eso va en la hoja Sedes)."),
        Columna(
            "Latitud", 12, False,
            "Coordenada del mapa, opcional. Si no la tenés, no pasa nada: se puede ubicar después desde el mapa dentro de la aplicación.",
            tipo="decimal", minimo=-90, maximo=90,
        ),
        Columna(
            "Longitud", 12, False,
            "Coordenada del mapa, opcional. Si no la tenés, no pasa nada: se puede ubicar después desde el mapa dentro de la aplicación.",
            tipo="decimal", minimo=-180, maximo=180,
        ),
        Columna(
            "Estado", 14, False,
            "Si dejás esta celda en blanco, el cliente queda Activo. Elegí Suspendido o Baja solo si ya sabés que no vas a operar más con ese cliente.",
            tipo="lista", opciones=["Activo", "Suspendido", "Baja"],
        ),
        Columna("Notas", 30, False, "Cualquier observación libre sobre este cliente."),
    ]
    filas_ejemplo_clientes = [
        [
            "30712345678", "Ejemplo Limpiezas Del Sur S.A.", "Limpiezas Del Sur",
            "Av. Ejemplo 1234, CABA", None, None, "Activo",
            "Cliente ficticio de ejemplo.",
        ],
        [
            "30798765432", "Ejemplo Textiles Norte S.R.L.", None,
            "Calle Ejemplo 890, San Martín, Buenos Aires", None, None, "Activo", None,
        ],
    ]
    _crear_hoja_datos(
        wb, "Clientes", "Clientes",
        "Las empresas a las que Extendiendo Servicios les presta servicio de limpieza.",
        columnas_clientes, filas_ejemplo_clientes,
    )

    # ---- Contactos ---------------------------------------------------------------------------
    columnas_contactos = [
        Columna(
            "CUIT del cliente", 16, True,
            "El mismo CUIT que cargaste para ese cliente en la hoja Clientes (11 dígitos, sin puntos ni guiones).",
            tipo="cuit",
        ),
        Columna("Nombre del contacto", 26, True, "Nombre y apellido de la persona de referencia en ese cliente."),
        Columna("Cargo", 22, False, "Su puesto o función (por ejemplo \"Encargada de limpieza\" o \"Administración\")."),
        Columna("Teléfono", 18, False, "Un teléfono de contacto."),
        Columna("Email", 26, False, "Un email de contacto.", tipo="email"),
        Columna(
            "¿Es el contacto principal?", 16, False,
            "Si dejás esta celda en blanco, se toma como No. Puede haber un solo contacto principal por cliente (si marcás \"Sí\" en más de uno para el mismo CUIT, la celda se resalta en rojo).",
            tipo="si_no",
        ),
    ]
    filas_ejemplo_contactos = [
        ["30712345678", "Ejemplo Laura Fernández", "Encargada de limpieza", "011-4444-5555", "laura.ejemplo@correo.com", "Sí"],
    ]
    ws_contactos = _crear_hoja_datos(
        wb, "Contactos", "Contactos",
        "Las personas de referencia de cada cliente (podés cargar más de una por cliente).",
        columnas_contactos, filas_ejemplo_contactos,
    )
    # Formato condicional: más de un contacto principal ("Sí") para el mismo CUIT.
    fila_datos_desde_contactos = 3 + len(filas_ejemplo_contactos) + 2
    fila_datos_hasta_contactos = fila_datos_desde_contactos + FILAS_DE_DATOS
    rango_principal = f"F{fila_datos_desde_contactos}:F{fila_datos_hasta_contactos}"
    ws_contactos.conditional_formatting.add(
        rango_principal,
        FormulaRule(
            formula=[
                f'COUNTIFS($A${fila_datos_desde_contactos}:$A${fila_datos_hasta_contactos},$A{fila_datos_desde_contactos},'
                f'$F${fila_datos_desde_contactos}:$F${fila_datos_hasta_contactos},"Sí")>1'
            ],
            fill=relleno_alerta_roja,
        ),
    )

    # ---- Sedes --------------------------------------------------------------------------------
    columnas_sedes = [
        Columna("CUIT del cliente", 16, True, "El CUIT del cliente al que pertenece esta sede (el mismo de la hoja Clientes).", tipo="cuit"),
        Columna("Nombre de la sede", 24, True, "Un nombre que identifique el lugar (por ejemplo \"Sede Centro\" o \"Planta 2\"). Tiene que ser único dentro del mismo cliente."),
        Columna("Dirección", 34, True, "La dirección donde se presta el servicio."),
        Columna("Localidad", 20, False, "Localidad o barrio."),
        Columna("Latitud", 12, False, "Coordenada del mapa, opcional: se puede ubicar después desde el mapa dentro de la aplicación.", tipo="decimal", minimo=-90, maximo=90),
        Columna("Longitud", 12, False, "Coordenada del mapa, opcional: se puede ubicar después desde el mapa dentro de la aplicación.", tipo="decimal", minimo=-180, maximo=180),
        Columna("Nombre de contacto en la sede", 24, False, "La persona a la que el personal puede recurrir en ese lugar (puede ser distinta del contacto administrativo del cliente)."),
        Columna("Teléfono de contacto en la sede", 20, False, "Teléfono de esa persona."),
        Columna("Instrucciones de acceso", 30, False, "Cómo entrar al lugar: timbre, portón, a quién pedir, etc. Esto lo va a ver el personal asignado."),
        Columna("Horario del edificio", 24, False, "Texto libre, por ejemplo \"Lunes a viernes de 7 a 20\"."),
        Columna("¿Restringe el uso del celular?", 16, False, "Si dejás esta celda en blanco, se toma como No. Es solo informativo para el personal, no bloquea nada.", tipo="si_no"),
        Columna("¿Prohíbe sacar fotos?", 16, False, "Si dejás esta celda en blanco, se toma como No. Es solo informativo para el personal, no bloquea nada.", tipo="si_no"),
        Columna("Otras restricciones", 26, False, "Cualquier otra restricción del lugar."),
        Columna("Estado", 14, False, "Si dejás esta celda en blanco, la sede queda Activa. Elegí Inactiva solo si ya sabés que no se va a trabajar más ahí.", tipo="lista", opciones=["Activa", "Inactiva"]),
    ]
    filas_ejemplo_sedes = [
        [
            "30712345678", "Sede Ejemplo Centro", "Av. Ejemplo 1234, CABA", "CABA", None, None,
            "Marisa Ejemplo", "011-4444-6666", "Timbre en portería, pedir por Marisa.",
            "Lunes a viernes de 7 a 20", "No", "No", None, "Activa",
        ],
    ]
    _crear_hoja_datos(
        wb, "Sedes", "Sedes",
        "Los lugares donde se presta el servicio. Un cliente puede tener una o varias sedes.",
        columnas_sedes, filas_ejemplo_sedes,
    )

    # ---- Empleados y Supervisores (misma estructura) --------------------------------------
    def columnas_personal() -> list[Columna]:
        return [
            Columna("DNI", 14, True, "Solo números, sin puntos. Es la clave con la que vamos a identificar a esta persona en toda la planilla (por ejemplo en Habilitaciones).", tipo="dni"),
            Columna("Nombre", 20, True, "Nombre de pila."),
            Columna("Apellido", 20, True, "Apellido."),
            Columna("Email", 28, True, "El email con el que esta persona va a entrar a la aplicación. Tiene que ser un email propio de cada persona, no compartido con otra."),
            Columna("CUIL", 16, False, "Los 11 números del CUIL, sin puntos ni guiones.", tipo="cuil"),
            Columna("Teléfono", 18, False, "Un teléfono de contacto."),
            Columna("Domicilio", 30, False, "Domicilio particular."),
            Columna("Fecha de nacimiento", 16, False, "Formato DD/MM/AAAA.", tipo="fecha"),
            Columna("Fecha de ingreso", 16, False, "Formato DD/MM/AAAA.", tipo="fecha"),
            Columna("Contacto de emergencia: nombre", 24, False, "A quién avisar ante una emergencia."),
            Columna("Contacto de emergencia: teléfono", 20, False, "Teléfono de esa persona."),
            Columna("Contacto de emergencia: vínculo", 18, False, "Por ejemplo \"Esposo\", \"Madre\", \"Hermana\"."),
            Columna("Legajo", 10, False, "Dejalo en blanco si no tenés un número de legajo asignado: el sistema le va a asignar uno.", tipo="entero", minimo=1, maximo=999999),
            Columna("Estado", 14, False, "Si dejás esta celda en blanco, la persona queda Activa.", tipo="lista", opciones=["Activo", "Baja"]),
            Columna("Notas", 26, False, "Cualquier observación libre."),
        ]

    fila_ejemplo_empleado = [
        "30111222", "Ejemplo María", "González", "maria.ejemplo@correo.com", "27301112224",
        "011-5555-1111", "Calle Ejemplo 321, Avellaneda", datetime.date(1990, 3, 15),
        datetime.date(2024, 2, 1), "Juan Ejemplo", "011-5555-2222", "Esposo", None, "Activo", None,
    ]
    _crear_hoja_datos(
        wb, "Empleados", "Empleados",
        "El personal de limpieza. Si una persona también supervisa, cargala además en la hoja Supervisores con el mismo DNI.",
        columnas_personal(), [fila_ejemplo_empleado],
    )

    fila_ejemplo_supervisor = [
        "28555666", "Ejemplo Carla", "Pérez", "carla.ejemplo@correo.com", "27285556665",
        "011-5555-3333", "Calle Ejemplo 654, Quilmes", datetime.date(1985, 7, 22),
        datetime.date(2023, 6, 1), "Ana Ejemplo", "011-5555-4444", "Hermana", None, "Activo", None,
    ]
    _crear_hoja_datos(
        wb, "Supervisores", "Supervisores",
        "Quienes supervisan el trabajo del personal. Si una persona también limpia, cargala además en la hoja Empleados con el mismo DNI.",
        columnas_personal(), [fila_ejemplo_supervisor],
    )

    # ---- Servicios ------------------------------------------------------------------------
    columnas_servicios = [
        Columna("CUIT del cliente", 16, True, "El CUIT del cliente (el mismo de la hoja Clientes).", tipo="cuit"),
        Columna("Nombre de la sede", 22, True, "El nombre de la sede (el mismo que le pusiste en la hoja Sedes), para ese mismo cliente."),
        Columna("Nombre del servicio", 26, True, "Un nombre que lo identifique (por ejemplo \"Limpieza turno mañana\")."),
        Columna("Lunes", 9, False, "¿Se trabaja los lunes en este servicio? En blanco = No.", tipo="si_no"),
        Columna("Martes", 9, False, "¿Se trabaja los martes en este servicio? En blanco = No.", tipo="si_no"),
        Columna("Miércoles", 10, False, "¿Se trabaja los miércoles en este servicio? En blanco = No.", tipo="si_no"),
        Columna("Jueves", 9, False, "¿Se trabaja los jueves en este servicio? En blanco = No.", tipo="si_no"),
        Columna("Viernes", 9, False, "¿Se trabaja los viernes en este servicio? En blanco = No.", tipo="si_no"),
        Columna("Sábado", 9, False, "¿Se trabaja los sábados en este servicio? En blanco = No.", tipo="si_no"),
        Columna("Domingo", 10, False, "¿Se trabaja los domingos en este servicio? En blanco = No. Tiene que haber al menos un día marcado \"Sí\" entre estas siete columnas.", tipo="si_no"),
        Columna("Hora de inicio", 13, True, "Formato HH:MM, de 24 horas (por ejemplo 07:00).", tipo="hora"),
        Columna("Hora de fin", 13, True, "Formato HH:MM. Tiene que ser una hora posterior a la de inicio: el servicio no puede cruzar la medianoche (por ejemplo, no se puede cargar de 22:00 a 02:00; cargá dos servicios si hace falta).", tipo="hora_fin"),
        Columna("Dotación", 11, False, "Cuántas personas hacen falta en simultáneo para este servicio, de 1 a 10. En blanco = 1.", tipo="entero", minimo=1, maximo=10),
        Columna("Vigente desde", 14, True, "Formato DD/MM/AAAA: desde cuándo rige este servicio.", tipo="fecha"),
        Columna("Vigente hasta", 14, False, "Formato DD/MM/AAAA. Dejalo en blanco si el servicio no tiene fecha de fin todavía.", tipo="fecha"),
        Columna("¿Se presta en los feriados?", 14, False, "En blanco = Sí. Elegí No si el servicio se suspende los feriados.", tipo="si_no"),
        Columna("Horas mínimas mensuales", 14, False, "Dato informativo, opcional (no afecta la generación de turnos).", tipo="decimal", minimo=0, maximo=999),
        Columna("Horas máximas mensuales", 14, False, "Dato informativo, opcional (no afecta la generación de turnos).", tipo="decimal", minimo=0, maximo=999),
        Columna("Estado", 14, False, "Si dejás esta celda en blanco, el servicio queda Activo. Solo un servicio Activo genera turnos.", tipo="lista", opciones=["Activo", "Pausado", "Finalizado"]),
        Columna("Notas", 24, False, "Cualquier observación libre."),
    ]
    filas_ejemplo_servicios = [
        [
            "30712345678", "Sede Ejemplo Centro", "Limpieza turno mañana",
            "Sí", "Sí", "Sí", "Sí", "Sí", "No", "No",
            datetime.time(7, 0), datetime.time(15, 0), 2,
            datetime.date(2024, 2, 1), None, "Sí", None, None, "Activo", None,
        ],
    ]
    _crear_hoja_datos(
        wb, "Servicios", "Servicios",
        "Los días y horarios en los que se trabaja en cada sede: la base para generar los turnos.",
        columnas_servicios, filas_ejemplo_servicios,
    )

    # ---- Habilitaciones ---------------------------------------------------------------------
    columnas_habilitaciones = [
        Columna("DNI del empleado o supervisor", 20, True, "El DNI de la persona (el mismo que cargaste en Empleados o Supervisores).", tipo="dni"),
        Columna("CUIT del cliente habilitado", 18, True, "El CUIT del cliente en el que esa persona puede trabajar.", tipo="cuit"),
    ]
    filas_ejemplo_habilitaciones = [
        ["30111222", "30712345678"],
    ]
    _crear_hoja_datos(
        wb, "Habilitaciones", "Habilitaciones",
        "Opcional. Si una persona no aparece acá, puede trabajar en cualquier cliente. Cargala solo si querés restringirla a determinados clientes.",
        columnas_habilitaciones, filas_ejemplo_habilitaciones,
    )

    # ---- Feriados -----------------------------------------------------------------------------
    columnas_feriados = [
        Columna("Fecha", 14, True, "Formato DD/MM/AAAA. No puede haber dos filas con la misma fecha.", tipo="fecha"),
        Columna("Nombre", 30, True, "El nombre del feriado (por ejemplo \"Día de la Independencia\")."),
    ]
    filas_ejemplo_feriados = [
        [datetime.date(2026, 1, 1), "Año Nuevo"],
    ]
    _crear_hoja_datos(
        wb, "Feriados", "Feriados",
        "El calendario de feriados que la empresa respeta, para no generar turnos esos días salvo que un servicio los trabaje igual.",
        columnas_feriados, filas_ejemplo_feriados,
    )

    # ---- Criterios ----------------------------------------------------------------------------
    columnas_criterios = [
        Columna("Orden", 10, True, "Un número que define en qué orden aparece este criterio al calificar (1, 2, 3...).", tipo="entero", minimo=1, maximo=99),
        Columna("Título", 24, True, "Un título corto para el criterio (por ejemplo \"Prolijidad\")."),
        Columna("Descripción", 40, False, "El texto de guía que ve quien califica, explicando qué se evalúa en este criterio."),
        Columna("Vigente desde", 14, False, "Formato DD/MM/AAAA. En blanco = a partir de hoy.", tipo="fecha"),
        Columna("Vigente hasta", 14, False, "Formato DD/MM/AAAA. Dejalo en blanco si no tiene fecha de fin todavía.", tipo="fecha"),
    ]
    filas_ejemplo_criterios = [
        [1, "Prolijidad", "Orden y limpieza general del área asignada al finalizar el servicio.", None, None],
    ]
    _crear_hoja_datos(
        wb, "Criterios", "Criterios",
        "Las pautas con las que los supervisores califican el trabajo del personal (no se puntúa por criterio: son una guía de texto).",
        columnas_criterios, filas_ejemplo_criterios,
    )

    _crear_hoja_instrucciones(wb)
    wb.active = 0
    return wb


def main() -> None:
    destino = Path(__file__).resolve().parent.parent / "docs" / "plantilla-carga-inicial.xlsx"
    destino.parent.mkdir(parents=True, exist_ok=True)
    wb = construir_libro()
    wb.save(destino)
    print(f"Planilla generada en: {destino}")


if __name__ == "__main__":
    main()
