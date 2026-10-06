// scripts/import-initial/pruebas/planilla-ficticia.ts — DATA-005
//
// Arma en memoria planillas FICTICIAS con la misma estructura que `docs/plantilla-carga-inicial.xlsx`
// (título, descripción, encabezados en la fila 3 con asterisco en las obligatorias, fila de
// ejemplo con relleno amarillo y renglón separador). Los datos de los tests son inventados:
// ninguna persona ni empresa real.

import ExcelJS from 'exceljs'
import { ESQUEMA } from '../esquema.ts'
import { NOMBRES_HOJAS, type Celda, type NombreHoja } from '../tipos.ts'

export type FilaDatos = Record<string, Celda>
export type DatosPlanilla = Partial<Record<NombreHoja, FilaDatos[]>>

/** CUIT/CUIL válido a partir de los 10 primeros dígitos (módulo 11, calculado a mano acá). */
export function cuitValido(primeros10: string): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((a, p, i) => a + p * Number(primeros10[i]), 0)
  const resto = suma % 11
  const digito = resto === 0 ? 0 : 11 - resto
  if (digito === 10)
    throw new Error('Elegí otros 10 dígitos: este da verificador 10.')
  return `${primeros10}${digito}`
}

/** Hora de Excel (celda de solo hora): fecha base de Excel más la hora, en UTC. */
export function horaExcel(horas: number, minutos = 0): Date {
  return new Date(Date.UTC(1899, 11, 30, horas, minutos))
}

export function fechaExcel(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes - 1, dia))
}

const EJEMPLOS: Partial<Record<NombreHoja, FilaDatos[]>> = {
  Clientes: [
    { cuit: '30712345678', razonSocial: 'Ejemplo Limpiezas Del Sur S.A.' },
    { cuit: '30798765432', razonSocial: 'Ejemplo Textiles Norte S.R.L.' },
  ],
  Contactos: [
    {
      cliente: '30712345678',
      nombre: 'Ejemplo Laura Fernández',
      principal: 'Sí',
    },
  ],
  Sedes: [
    {
      cliente: '30712345678',
      nombre: 'Sede Ejemplo Centro',
      direccion: 'Av. Ejemplo 1234, CABA',
    },
  ],
  Empleados: [
    {
      dni: '30111222',
      nombre: 'Ejemplo María',
      apellido: 'González',
      email: 'maria.ejemplo@correo.com',
    },
  ],
  Supervisores: [
    {
      dni: '28555666',
      nombre: 'Ejemplo Carla',
      apellido: 'Pérez',
      email: 'carla.ejemplo@correo.com',
    },
  ],
  Servicios: [
    {
      cliente: '30712345678',
      nombre: 'Limpieza turno mañana',
      sede: 'Sede Ejemplo Centro',
      lunes: 'Sí',
      inicio: horaExcel(7),
      fin: horaExcel(15),
      desde: fechaExcel(2024, 2, 1),
    },
  ],
  // Estas tres hojas no tienen la palabra "Ejemplo": se reconocen por el relleno amarillo.
  Habilitaciones: [{ dni: '30111222', cliente: '30712345678' }],
  Feriados: [{ fecha: fechaExcel(2026, 1, 1), nombre: 'Año Nuevo' }],
  Criterios: [{ orden: 1, titulo: 'Prolijidad' }],
}

export interface OpcionesPlanilla {
  /** Hojas que no se incluyen en el archivo. */
  sinHojas?: NombreHoja[]
  /** Columnas (por campo) que se omiten del encabezado, por hoja. */
  sinColumnas?: Partial<Record<NombreHoja, string[]>>
  /** Si es `false`, no se agregan las filas de ejemplo ni el separador. */
  conEjemplos?: boolean
}

/** Genera el `.xlsx` en memoria (un `Buffer`) con los datos pedidos. */
export async function crearPlanilla(
  datos: DatosPlanilla,
  opciones: OpcionesPlanilla = {},
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook()
  const instrucciones = libro.addWorksheet('Instrucciones')
  instrucciones.getCell('B1').value =
    'Carga inicial de datos (ficticia, para tests)'

  for (const nombre of NOMBRES_HOJAS) {
    if (opciones.sinHojas?.includes(nombre)) continue
    const ws = libro.addWorksheet(nombre)
    const omitidas = opciones.sinColumnas?.[nombre] ?? []
    const columnas = ESQUEMA[nombre].filter((c) => !omitidas.includes(c.campo))
    ws.getCell('A1').value = nombre
    ws.getCell('A2').value = 'Descripción de la hoja'
    columnas.forEach((col, i) => {
      ws.getCell(3, i + 1).value = col.obligatoria
        ? `${col.titulo} (*)`
        : col.titulo
    })
    let fila = 4
    const escribir = (valores: FilaDatos, ejemplo: boolean) => {
      columnas.forEach((col, i) => {
        const celda = ws.getCell(fila, i + 1)
        const valor = valores[col.campo]
        if (valor !== undefined && valor !== null) celda.value = valor
        if (
          valor instanceof Date &&
          (col.campo === 'inicio' || col.campo === 'fin')
        ) {
          celda.numFmt = 'hh:mm'
        } else if (valor instanceof Date) {
          celda.numFmt = 'dd/mm/yyyy'
        }
        if (ejemplo) {
          celda.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFDF3E0' },
          }
        }
      })
      fila++
    }
    if (opciones.conEjemplos !== false) {
      for (const ejemplo of EJEMPLOS[nombre] ?? []) escribir(ejemplo, true)
      ws.getCell(fila, 1).value =
        'Borrá la fila de ejemplo de arriba y cargá tus datos reales desde la fila de abajo ↓'
      fila++
    }
    for (const valores of datos[nombre] ?? []) escribir(valores, false)
  }
  return Buffer.from(await libro.xlsx.writeBuffer())
}

/** Datos mínimos válidos y coherentes entre hojas, base de varios tests. */
export function datosValidos(): DatosPlanilla {
  const cuitA = cuitValido('3071234567')
  const cuitB = cuitValido('3079876543')
  return {
    Clientes: [
      {
        cuit: cuitA,
        razonSocial: 'Test Limpiezas Alfa S.A.',
        direccion: 'Calle Falsa 123, CABA',
      },
      { cuit: cuitB, razonSocial: 'Test Textiles Beta S.R.L.' },
      {
        razonSocial: 'Test Sin Cuit Gamma',
        direccion: 'Calle Inventada 45, Quilmes',
      },
    ],
    Contactos: [
      {
        cliente: cuitA,
        nombre: 'Test Contacto Uno',
        telefono: 1144445555,
        email: 'contacto.uno@prueba.test',
        principal: 'Sí',
      },
    ],
    Sedes: [
      {
        cliente: cuitB,
        nombre: 'Planta Uno',
        direccion: 'Av. Inventada 100, San Martín',
        latitud: -34.6,
        longitud: -58.4,
        celular: 'Sí',
      },
    ],
    Empleados: [
      {
        dni: '40111222',
        nombre: 'Test Ana',
        apellido: 'Uno',
        email: 'ana.uno@prueba.test',
        cuil: cuitValido('2740111222'),
        telefono: 1155551111,
        nacimiento: fechaExcel(1990, 3, 15),
        ingreso: fechaExcel(2024, 2, 1),
      },
      {
        dni: '40333444',
        nombre: 'Test Beto',
        apellido: 'Dos',
        email: 'beto.dos@prueba.test',
      },
    ],
    Supervisores: [
      {
        dni: '40333444',
        nombre: 'Test Beto',
        apellido: 'Dos',
        email: 'beto.dos@prueba.test',
      },
      {
        dni: '40555666',
        nombre: 'Test Carla',
        apellido: 'Tres',
        email: 'carla.tres@prueba.test',
      },
    ],
    Servicios: [
      {
        cliente: cuitB,
        sede: 'Planta Uno',
        nombre: 'Limpieza mañana',
        lunes: 'Sí',
        martes: 'Sí',
        viernes: 'Sí',
        inicio: horaExcel(7),
        fin: horaExcel(15, 30),
        dotacion: 2,
        desde: fechaExcel(2026, 3, 1),
        feriados: 'No',
      },
      {
        cliente: 'test sin  cuit gamma ',
        sede: 'Principal',
        nombre: 'Limpieza tarde',
        sabado: 'Sí',
        inicio: '14:00',
        fin: '18:00',
        desde: fechaExcel(2026, 3, 1),
      },
    ],
    Habilitaciones: [
      { dni: '40111222', cliente: cuitA },
      { dni: '40333444', cliente: 'Test Sin Cuit Gamma' },
    ],
    Feriados: [
      { fecha: fechaExcel(2026, 5, 25), nombre: 'Revolución de Mayo' },
      { fecha: fechaExcel(2026, 7, 9), nombre: 'Día de la Independencia' },
    ],
    Criterios: [
      { orden: 1, titulo: 'Prolijidad', descripcion: 'Orden general.' },
      { orden: 2, titulo: 'Puntualidad' },
    ],
  }
}
