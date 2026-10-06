// scripts/import-initial/informe.ts — DATA-003, DATA-004
//
// Informe de la validación y de la carga, en español, para quien no es técnico: un texto legible,
// un Excel con las incidencias (para filtrar por hoja) y un JSON para el orquestador. Los
// mensajes pueden incluir datos del archivo (un CUIT repetido, un DNI): por eso los informes se
// escriben fuera del repositorio cuando el archivo es real (`--salida`) y la carpeta por defecto
// está ignorada por git. La consola nunca imprime los mensajes, solo cantidades.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import type { Incidencia, Nivel, ResultadoValidacion } from './tipos.ts'

export interface MetaInforme {
  /** Nombre del archivo leído (sin carpeta). */
  archivo: string
  modo: 'simulacion' | 'carga' | 'carga-reintento'
  /** Entorno de destino (`app_dev`, `app`) o `null` si no hubo conexión. */
  entorno: string | null
  fecha: Date
}

export interface Cantidades {
  clientes: number
  contactos: number
  sedes: number
  sedesAutomaticas: number
  personas: number
  empleados: number
  supervisores: number
  conAmbosRoles: number
  servicios: number
  habilitaciones: number
  feriados: number
  criterios: number
}

export interface Resumen {
  errores: number
  advertencias: number
  ignoradas: number
  porHoja: Array<{
    hoja: string
    errores: number
    advertencias: number
    ignoradas: number
  }>
  porCodigo: Array<{
    nivel: Nivel
    hoja: string
    codigo: string
    cantidad: number
  }>
  cantidades: Cantidades
}

const TITULO_NIVEL: Record<Nivel, string> = {
  error: 'ERRORES (hay que corregirlos: mientras haya uno no se carga nada)',
  advertencia: 'ADVERTENCIAS (no frenan la carga; conviene revisarlas)',
  ignorada: 'FILAS IGNORADAS (ejemplos de la plantilla)',
}

export function resumir(resultado: ResultadoValidacion): Resumen {
  const { incidencias, plan } = resultado
  const hojas = new Map<
    string,
    { hoja: string; errores: number; advertencias: number; ignoradas: number }
  >()
  const codigos = new Map<
    string,
    { nivel: Nivel; hoja: string; codigo: string; cantidad: number }
  >()
  for (const inc of incidencias) {
    const h = hojas.get(inc.hoja) ?? {
      hoja: inc.hoja,
      errores: 0,
      advertencias: 0,
      ignoradas: 0,
    }
    if (inc.nivel === 'error') h.errores++
    else if (inc.nivel === 'advertencia') h.advertencias++
    else h.ignoradas++
    hojas.set(inc.hoja, h)

    const clave = `${inc.nivel}|${inc.hoja}|${inc.codigo}`
    const k = codigos.get(clave) ?? {
      nivel: inc.nivel,
      hoja: inc.hoja,
      codigo: inc.codigo,
      cantidad: 0,
    }
    k.cantidad++
    codigos.set(clave, k)
  }
  const cuenta = (n: Nivel) => incidencias.filter((i) => i.nivel === n).length
  return {
    errores: cuenta('error'),
    advertencias: cuenta('advertencia'),
    ignoradas: cuenta('ignorada'),
    porHoja: [...hojas.values()],
    porCodigo: [...codigos.values()],
    cantidades: {
      clientes: plan.clientes.length,
      contactos: plan.contactos.length,
      sedes: plan.sedes.length,
      sedesAutomaticas: plan.sedes.filter((s) => s.automatica).length,
      personas: plan.personas.length,
      empleados: plan.personas.filter((p) => p.roles.includes('employee'))
        .length,
      supervisores: plan.personas.filter((p) => p.roles.includes('supervisor'))
        .length,
      conAmbosRoles: plan.personas.filter((p) => p.roles.length === 2).length,
      servicios: plan.servicios.length,
      habilitaciones: plan.habilitaciones.length,
      feriados: plan.feriados.length,
      criterios: plan.criterios.length,
    },
  }
}

function fechaLegible(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(fecha.getDate())}/${p(fecha.getMonth() + 1)}/${fecha.getFullYear()} ${p(fecha.getHours())}:${p(fecha.getMinutes())}`
}

export function sello(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}${p(fecha.getMonth() + 1)}${p(fecha.getDate())}-${p(fecha.getHours())}${p(fecha.getMinutes())}${p(fecha.getSeconds())}`
}

function ubicacion(inc: Incidencia): string {
  const partes: string[] = []
  if (inc.fila !== null) partes.push(`fila ${inc.fila}`)
  if (inc.columna !== null) partes.push(`columna "${inc.columna}"`)
  return partes.length ? partes.join(', ') : 'toda la hoja'
}

export function informeTexto(
  resultado: ResultadoValidacion,
  meta: MetaInforme,
): string {
  const resumen = resumir(resultado)
  const c = resumen.cantidades
  const lineas: string[] = []
  const titulo = {
    simulacion:
      'INFORME DE VALIDACIÓN (simulación: no se escribió nada en la base)',
    carga: 'INFORME DE VALIDACIÓN PREVIO A LA CARGA',
    'carga-reintento': 'INFORME DE VALIDACIÓN PREVIO A LA CARGA (reintento)',
  }[meta.modo]
  lineas.push(titulo, '='.repeat(titulo.length))
  lineas.push(`Archivo: ${meta.archivo}`)
  lineas.push(`Fecha: ${fechaLegible(meta.fecha)}`)
  lineas.push(
    `Entorno de destino: ${meta.entorno ?? 'ninguno (no hubo conexión a la base)'}`,
  )
  lineas.push('')
  lineas.push(
    resumen.errores === 0
      ? 'RESULTADO: sin errores. La planilla se puede cargar.'
      : `RESULTADO: ${resumen.errores} error(es). No se puede cargar hasta corregirlos.`,
  )
  lineas.push(
    `Errores: ${resumen.errores}   Advertencias: ${resumen.advertencias}   Filas ignoradas: ${resumen.ignoradas}`,
  )
  lineas.push('')
  lineas.push('Qué se cargaría si no hubiera errores')
  lineas.push('-------------------------------------')
  lineas.push(`Clientes: ${c.clientes}`)
  lineas.push(`Contactos: ${c.contactos}`)
  lineas.push(
    `Sedes: ${c.sedes} (de las cuales ${c.sedesAutomaticas} "Principal" creadas automáticamente)`,
  )
  lineas.push(
    `Personas con usuario: ${c.personas} (${c.empleados} con rol empleado, ${c.supervisores} con rol supervisor, ${c.conAmbosRoles} con los dos)`,
  )
  lineas.push(`Servicios: ${c.servicios}`)
  lineas.push(`Habilitaciones: ${c.habilitaciones}`)
  lineas.push(`Feriados: ${c.feriados}`)
  lineas.push(`Criterios: ${c.criterios}`)

  if (resumen.porHoja.length > 0) {
    lineas.push('', 'Resumen por hoja')
    lineas.push('----------------')
    for (const h of resumen.porHoja) {
      lineas.push(
        `${h.hoja}: ${h.errores} error(es), ${h.advertencias} advertencia(s), ${h.ignoradas} ignorada(s)`,
      )
    }
  }

  for (const nivel of ['error', 'advertencia', 'ignorada'] as const) {
    const lista = resultado.incidencias.filter((i) => i.nivel === nivel)
    if (lista.length === 0) continue
    lineas.push('', TITULO_NIVEL[nivel], '-'.repeat(TITULO_NIVEL[nivel].length))
    let hojaActual = ''
    for (const inc of lista) {
      if (inc.hoja !== hojaActual) {
        hojaActual = inc.hoja
        lineas.push('', `Hoja ${inc.hoja}`)
      }
      lineas.push(`  - ${ubicacion(inc)}: ${inc.mensaje}`)
    }
  }
  lineas.push('')
  return lineas.join('\n')
}

export interface RastroCarga {
  /** Por entidad: cuántos se crearon, cuántos ya existían y cuáles fallaron. */
  pasos: Array<{
    entidad: string
    creados: number
    omitidos: number
    fallidos: Array<{ fila: number | null; mensaje: string }>
  }>
  /** Sedes `Principal` creadas por el importador (ya contadas en `Sedes`). */
  sedesAutomaticas: number
  /** Cuentas de Auth creadas sin contraseña (a la espera de DATA-008). */
  cuentasSinContrasena: number
  interrumpidaEn: string | null
}

export function informeCargaTexto(
  rastro: RastroCarga,
  meta: MetaInforme,
): string {
  const lineas: string[] = []
  const titulo = 'INFORME DE CARGA'
  lineas.push(titulo, '='.repeat(titulo.length))
  lineas.push(`Archivo: ${meta.archivo}`)
  lineas.push(`Fecha: ${fechaLegible(meta.fecha)}`)
  lineas.push(`Entorno de destino: ${meta.entorno ?? '-'}`)
  lineas.push(
    `Modo: ${meta.modo === 'carga-reintento' ? 'reintento (--resume): se omite lo ya cargado' : 'carga completa'}`,
  )
  lineas.push('')
  let fallos = 0
  for (const p of rastro.pasos) {
    lineas.push(
      `${p.entidad}: ${p.creados} creado(s), ${p.omitidos} ya existía(n), ${p.fallidos.length} con falla`,
    )
    fallos += p.fallidos.length
  }
  lineas.push('')
  lineas.push(
    `Cuentas de acceso creadas sin contraseña: ${rastro.cuentasSinContrasena}`,
  )
  if (rastro.cuentasSinContrasena > 0) {
    lineas.push(
      '  (Todavía no pueden iniciar sesión: las contraseñas iniciales se generan en un paso aparte, DATA-008.)',
    )
  }
  if (rastro.interrumpidaEn !== null) {
    lineas.push('', `LA CARGA SE INTERRUMPIÓ en: ${rastro.interrumpidaEn}`)
    lineas.push(
      'Lo ya cargado queda en la base. Corregí la causa y volvé a correr el mismo comando con --resume.',
    )
  } else if (fallos > 0) {
    lineas.push(
      '',
      `HUBO ${fallos} FALLA(S). Revisá el detalle y reintentá con --resume.`,
    )
  } else {
    lineas.push('', 'La carga terminó sin fallas.')
  }
  for (const p of rastro.pasos) {
    if (p.fallidos.length === 0) continue
    lineas.push('', `Fallas en ${p.entidad}`)
    for (const f of p.fallidos) {
      lineas.push(
        `  - ${f.fila === null ? 'sin fila' : `fila ${f.fila}`}: ${f.mensaje}`,
      )
    }
  }
  lineas.push('')
  return lineas.join('\n')
}

export interface ArchivosInforme {
  txt: string
  xlsx: string
  json: string
}

/** Escribe el informe de validación (texto, Excel y JSON) en la carpeta indicada. */
export async function escribirInformeValidacion(
  resultado: ResultadoValidacion,
  meta: MetaInforme,
  carpeta: string,
): Promise<ArchivosInforme> {
  await mkdir(carpeta, { recursive: true })
  const base = join(carpeta, `informe-validacion-${sello(meta.fecha)}`)
  const resumen = resumir(resultado)

  await writeFile(`${base}.txt`, informeTexto(resultado, meta), 'utf8')
  await writeFile(
    `${base}.json`,
    JSON.stringify(
      {
        archivo: meta.archivo,
        fecha: meta.fecha.toISOString(),
        entorno: meta.entorno,
        resumen,
        incidencias: resultado.incidencias,
      },
      null,
      2,
    ),
    'utf8',
  )

  const libro = new ExcelJS.Workbook()
  const hojaResumen = libro.addWorksheet('Resumen')
  hojaResumen.columns = [
    { header: 'Dato', key: 'dato', width: 44 },
    { header: 'Valor', key: 'valor', width: 14 },
  ]
  hojaResumen.addRows([
    { dato: 'Errores', valor: resumen.errores },
    { dato: 'Advertencias', valor: resumen.advertencias },
    { dato: 'Filas ignoradas', valor: resumen.ignoradas },
    { dato: 'Clientes a cargar', valor: resumen.cantidades.clientes },
    { dato: 'Contactos a cargar', valor: resumen.cantidades.contactos },
    { dato: 'Sedes a cargar', valor: resumen.cantidades.sedes },
    {
      dato: '  de las cuales "Principal" automáticas',
      valor: resumen.cantidades.sedesAutomaticas,
    },
    { dato: 'Personas con usuario', valor: resumen.cantidades.personas },
    { dato: 'Servicios a cargar', valor: resumen.cantidades.servicios },
    {
      dato: 'Habilitaciones a cargar',
      valor: resumen.cantidades.habilitaciones,
    },
    { dato: 'Feriados a cargar', valor: resumen.cantidades.feriados },
    { dato: 'Criterios a cargar', valor: resumen.cantidades.criterios },
  ])
  for (const [nombre, nivel] of [
    ['Errores', 'error'],
    ['Advertencias', 'advertencia'],
    ['Ignoradas', 'ignorada'],
  ] as const) {
    const ws = libro.addWorksheet(nombre)
    ws.columns = [
      { header: 'Hoja', key: 'hoja', width: 16 },
      { header: 'Fila', key: 'fila', width: 8 },
      { header: 'Columna', key: 'columna', width: 30 },
      { header: 'Qué pasa', key: 'mensaje', width: 110 },
    ]
    ws.getRow(1).font = { bold: true }
    ws.autoFilter = { from: 'A1', to: 'D1' }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    for (const inc of resultado.incidencias.filter((i) => i.nivel === nivel)) {
      ws.addRow({
        hoja: inc.hoja,
        fila: inc.fila,
        columna: inc.columna,
        mensaje: inc.mensaje,
      })
    }
  }
  hojaResumen.getRow(1).font = { bold: true }
  await libro.xlsx.writeFile(`${base}.xlsx`)

  return { txt: `${base}.txt`, xlsx: `${base}.xlsx`, json: `${base}.json` }
}

export async function escribirInformeCarga(
  rastro: RastroCarga,
  meta: MetaInforme,
  carpeta: string,
): Promise<string> {
  await mkdir(carpeta, { recursive: true })
  const ruta = join(carpeta, `informe-carga-${sello(meta.fecha)}.txt`)
  await writeFile(ruta, informeCargaTexto(rastro, meta), 'utf8')
  return ruta
}
