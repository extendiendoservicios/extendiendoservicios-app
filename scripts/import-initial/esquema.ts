// scripts/import-initial/esquema.ts — DATA-003
//
// Hojas y columnas de `docs/plantilla-carga-inicial.xlsx`, tal cual están hoy (el importador lee
// la plantilla sin cambiarla). Cada columna tiene una clave de campo (la que usa el validador) y
// el título que ve la empresa, sin el asterisco de obligatoria. Si la plantilla cambia de
// columnas, este archivo es lo único que hay que tocar junto con `validar.ts`.

import type { NombreHoja } from './tipos.ts'

export interface ColumnaEsquema {
  campo: string
  /** Título visible, sin " (*)". */
  titulo: string
  /** Según la plantilla; el validador decide qué es realmente obligatorio. */
  obligatoria: boolean
  /** Títulos anteriores que también se aceptan (plantilla de septiembre). */
  alias: string[]
}

const c = (
  campo: string,
  titulo: string,
  obligatoria = false,
  alias: string[] = [],
): ColumnaEsquema => ({ campo, titulo, obligatoria, alias })

/** Título de la columna que vincula una fila con su cliente, en la versión 2 de la plantilla. */
const TITULO_CLIENTE_V2 = 'Cliente (CUIT o razón social)'
/** Título de la plantilla de septiembre, que también se acepta. */
const TITULO_CLIENTE_V1 = 'CUIT del cliente'

const COLUMNAS_PERSONAL: ColumnaEsquema[] = [
  c('dni', 'DNI', true),
  c('nombre', 'Nombre', true),
  c('apellido', 'Apellido', true),
  c('email', 'Email', true),
  c('cuil', 'CUIL'),
  c('telefono', 'Teléfono'),
  c('domicilio', 'Domicilio'),
  c('nacimiento', 'Fecha de nacimiento'),
  c('ingreso', 'Fecha de ingreso'),
  c('emergenciaNombre', 'Contacto de emergencia: nombre'),
  c('emergenciaTelefono', 'Contacto de emergencia: teléfono'),
  c('emergenciaVinculo', 'Contacto de emergencia: vínculo'),
  c('legajo', 'Legajo'),
  c('estado', 'Estado'),
  c('notas', 'Notas'),
]

export const ESQUEMA: Record<NombreHoja, ColumnaEsquema[]> = {
  Clientes: [
    // En la plantilla de septiembre el CUIT figura como obligatorio; desde la versión 2 (decisión
    // del 6 oct 2026) es opcional (el cliente sin CUIT se vincula por razón social).
    c('cuit', 'CUIT'),
    c('razonSocial', 'Razón social', true),
    c('nombreFantasia', 'Nombre de fantasía'),
    c('direccion', 'Dirección administrativa'),
    c('latitud', 'Latitud'),
    c('longitud', 'Longitud'),
    c('estado', 'Estado'),
    c('notas', 'Notas'),
  ],
  Contactos: [
    c('cliente', TITULO_CLIENTE_V2, true, [TITULO_CLIENTE_V1]),
    c('nombre', 'Nombre del contacto', true),
    c('cargo', 'Cargo'),
    c('telefono', 'Teléfono'),
    c('email', 'Email'),
    c('principal', '¿Es el contacto principal?'),
  ],
  Sedes: [
    c('cliente', TITULO_CLIENTE_V2, true, [TITULO_CLIENTE_V1]),
    c('nombre', 'Nombre de la sede', true),
    c('direccion', 'Dirección', true),
    c('localidad', 'Localidad'),
    c('latitud', 'Latitud'),
    c('longitud', 'Longitud'),
    c('contactoNombre', 'Nombre de contacto en la sede'),
    c('contactoTelefono', 'Teléfono de contacto en la sede'),
    c('acceso', 'Instrucciones de acceso'),
    c('horario', 'Horario del edificio'),
    c('celular', '¿Restringe el uso del celular?'),
    c('fotos', '¿Prohíbe sacar fotos?'),
    c('otras', 'Otras restricciones'),
    c('estado', 'Estado'),
  ],
  Empleados: COLUMNAS_PERSONAL,
  Supervisores: COLUMNAS_PERSONAL,
  Servicios: [
    c('cliente', TITULO_CLIENTE_V2, true, [TITULO_CLIENTE_V1]),
    c('sede', 'Nombre de la sede', true),
    c('nombre', 'Nombre del servicio', true),
    c('lunes', 'Lunes'),
    c('martes', 'Martes'),
    c('miercoles', 'Miércoles'),
    c('jueves', 'Jueves'),
    c('viernes', 'Viernes'),
    c('sabado', 'Sábado'),
    c('domingo', 'Domingo'),
    c('inicio', 'Hora de inicio', true),
    c('fin', 'Hora de fin', true),
    c('dotacion', 'Dotación'),
    c('desde', 'Vigente desde', true),
    c('hasta', 'Vigente hasta'),
    c('feriados', '¿Se presta en los feriados?'),
    c('horasMinimas', 'Horas mínimas mensuales'),
    c('horasMaximas', 'Horas máximas mensuales'),
    c('estado', 'Estado'),
    c('notas', 'Notas'),
  ],
  Habilitaciones: [
    c('dni', 'DNI del empleado o supervisor', true),
    c('cliente', TITULO_CLIENTE_V2, true, [
      TITULO_CLIENTE_V1,
      'CUIT del cliente habilitado',
    ]),
  ],
  Feriados: [c('fecha', 'Fecha', true), c('nombre', 'Nombre', true)],
  Criterios: [
    c('orden', 'Orden', true),
    c('titulo', 'Título', true),
    c('descripcion', 'Descripción'),
    c('desde', 'Vigente desde'),
    c('hasta', 'Vigente hasta'),
  ],
}

/** Días de la semana de la hoja Servicios, con el número que usa `services.weekdays`. */
export const DIAS_SERVICIO: Array<{ campo: string; numero: number }> = [
  { campo: 'domingo', numero: 0 },
  { campo: 'lunes', numero: 1 },
  { campo: 'martes', numero: 2 },
  { campo: 'miercoles', numero: 3 },
  { campo: 'jueves', numero: 4 },
  { campo: 'viernes', numero: 5 },
  { campo: 'sabado', numero: 6 },
]

export function tituloColumna(hoja: NombreHoja, campo: string): string {
  return ESQUEMA[hoja].find((col) => col.campo === campo)?.titulo ?? campo
}
