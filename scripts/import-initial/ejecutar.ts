// scripts/import-initial/ejecutar.ts — DATA-003, DATA-004
//
// Flujo completo del importador, separado de `scripts/import-initial.ts` (que solo lee los
// argumentos y el entorno) para poder probarlo entero desde los tests. Devuelve el código de
// salida: 0 todo bien, 1 la planilla tiene errores o ya hay datos cargados (no se escribió nada),
// 2 mal uso o entorno mal configurado, 3 la carga empezó y tuvo fallas.

import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import {
  cargar,
  contarYaCargados,
  leerExistentes,
  type OpcionesCarga,
} from './cargar.ts'
import { ErrorDeEntorno, resolverConexion } from './entorno.ts'
import {
  escribirInformeCarga,
  escribirListaDeCuentas,
  escribirInformeValidacion,
  resumir,
  type MetaInforme,
} from './informe.ts'
import { leerPlantilla } from './leer-plantilla.ts'
import { validar } from './validar.ts'

export const CARPETA_DE_INFORMES_POR_DEFECTO = 'informes-importacion'

export const AYUDA = `Importador de la carga inicial (DATA-003).

Uso:
  node --env-file-if-exists=.env.local scripts/import-initial.ts <planilla.xlsx> [opciones]
  pnpm import:initial <planilla.xlsx> [opciones]

Opciones:
  --dry-run             Solo valida y escribe el informe. No toca la base ni necesita conexión.
  --consultar-base      Con --dry-run: además lee (sin escribir) la base de destino para avisar
                        qué ya está cargado. Necesita IMPORT_ENTORNO.
  --resume              Reintento: omite lo que ya está cargado (se reconoce por DNI, CUIT,
                        razón social, nombre, fecha o título) y carga lo que falta.
  --salida <carpeta>    Dónde escribir los informes (por defecto ./${CARPETA_DE_INFORMES_POR_DEFECTO}, que git ignora).
                        Con una planilla real, usá una carpeta fuera del repositorio.
  --permitir-produccion-f20
                        Permite IMPORT_ENTORNO=app (producción). Solo para el encargo de F20.
  --ayuda               Muestra esta ayuda.

Entorno (variables):
  IMPORT_ENTORNO        Obligatoria para escribir: "app_dev" o "app".
  VITE_SUPABASE_URL     URL del proyecto; tiene que coincidir con IMPORT_ENTORNO.
  SUPABASE_SERVICE_ROLE_KEY
                        Clave de servicio (solo en .env.local, nunca en el repositorio).

Si la planilla tiene al menos un error, no se escribe nada en la base.`

export interface Salida {
  log: (mensaje: string) => void
  error: (mensaje: string) => void
}

export interface DependenciasEjecucion {
  env: Record<string, string | undefined>
  salida: Salida
  /** Punto de extensión: contraseña al crear la cuenta (el flujo normal usa `pnpm credenciales:inicial`). */
  contrasenaInicial?: OpcionesCarga['contrasenaInicial']
}

export async function ejecutarImportacion(
  argumentos: string[],
  deps: DependenciasEjecucion,
): Promise<number> {
  const { salida } = deps
  let parseados
  try {
    parseados = parseArgs({
      args: argumentos,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean', default: false },
        'consultar-base': { type: 'boolean', default: false },
        resume: { type: 'boolean', default: false },
        salida: { type: 'string' },
        'permitir-produccion-f20': { type: 'boolean', default: false },
        ayuda: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    salida.error(
      `Opción no válida: ${error instanceof Error ? error.message : String(error)}\n\n${AYUDA}`,
    )
    return 2
  }
  const { values, positionals } = parseados
  if (values.ayuda) {
    salida.log(AYUDA)
    return 0
  }
  if (positionals.length !== 1) {
    salida.error(
      `Falta indicar la planilla a importar (un solo archivo .xlsx).\n\n${AYUDA}`,
    )
    return 2
  }
  const dryRun = values['dry-run']
  if (dryRun && values.resume) {
    salida.error(
      '--dry-run y --resume no se combinan: --dry-run no escribe nada.',
    )
    return 2
  }
  if (values['consultar-base'] && !dryRun) {
    salida.error('--consultar-base solo tiene sentido junto con --dry-run.')
    return 2
  }

  const archivo = resolve(positionals[0])
  const carpeta = resolve(values.salida ?? CARPETA_DE_INFORMES_POR_DEFECTO)
  const necesitaBase = !dryRun || values['consultar-base']

  // El entorno se verifica antes de leer nada: si está mal configurado, se corta de entrada.
  let conexion = null
  if (necesitaBase) {
    try {
      conexion = resolverConexion(deps.env, {
        permitirProduccionF20: values['permitir-produccion-f20'],
      })
    } catch (error) {
      if (error instanceof ErrorDeEntorno) {
        salida.error(error.message)
        return 2
      }
      throw error
    }
  }

  salida.log(`Leyendo ${basename(archivo)}...`)
  const lectura = await leerPlantilla(archivo)
  const resultado = validar(lectura)
  const resumen = resumir(resultado)

  const meta: MetaInforme = {
    archivo: basename(archivo),
    modo: dryRun ? 'simulacion' : values.resume ? 'carga-reintento' : 'carga',
    entorno: conexion?.entorno ?? null,
    fecha: new Date(),
  }
  const informe = await escribirInformeValidacion(resultado, meta, carpeta)

  salida.log(
    `Validación: ${resumen.errores} error(es), ${resumen.advertencias} advertencia(s), ${resumen.ignoradas} fila(s) ignorada(s).`,
  )
  for (const h of resumen.porHoja) {
    salida.log(
      `  ${h.hoja}: ${h.errores} error(es), ${h.advertencias} advertencia(s), ${h.ignoradas} ignorada(s)`,
    )
  }
  salida.log(`Informe de validación: ${informe.txt}`)
  salida.log(`Informe en Excel (para filtrar por hoja): ${informe.xlsx}`)

  if (resumen.errores > 0) {
    salida.log(
      'La planilla tiene errores: no se escribió nada. Corregila y volvé a correr.',
    )
    return 1
  }

  if (!conexion) {
    salida.log(
      'Simulación terminada: la planilla se puede cargar. No se escribió nada.',
    )
    return 0
  }

  salida.log(
    `Entorno de destino verificado: ${conexion.entorno} (proyecto ${conexion.ref}).`,
  )
  const admin = createClient(conexion.url, conexion.claveServicio, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const existentes = await leerExistentes(admin)
  const yaCargado = contarYaCargados(resultado.plan, existentes)

  if (dryRun) {
    if (yaCargado.total === 0) {
      salida.log(
        'La base de destino no tiene nada de esta planilla: se cargaría todo.',
      )
    } else {
      salida.log(
        'La base de destino ya tiene datos de esta planilla (se omitirían con --resume):',
      )
      for (const d of yaCargado.detalle) {
        if (d.cantidad > 0) salida.log(`  ${d.entidad}: ${d.cantidad}`)
      }
    }
    salida.log('Simulación terminada. No se escribió nada.')
    return 0
  }

  if (!values.resume && yaCargado.total > 0) {
    salida.error(
      'La base de destino ya tiene datos de esta planilla, así que no se escribió nada:',
    )
    for (const d of yaCargado.detalle) {
      if (d.cantidad > 0) salida.error(`  ${d.entidad}: ${d.cantidad}`)
    }
    salida.error(
      'Si es un reintento de una carga anterior, corré el mismo comando con --resume.',
    )
    return 1
  }

  const rastro = await cargar(admin, resultado.plan, existentes, {
    resume: values.resume,
    contrasenaInicial: deps.contrasenaInicial,
    avance: (mensaje) => salida.log(mensaje),
  })
  const rutaCarga = await escribirInformeCarga(rastro, meta, carpeta)
  for (const p of rastro.pasos) {
    salida.log(
      `  ${p.entidad}: ${p.creados} creado(s), ${p.omitidos} ya existía(n), ${p.fallidos.length} con falla`,
    )
  }
  salida.log(`Informe de carga: ${rutaCarga}`)
  const rutaCuentas = await escribirListaDeCuentas(rastro, meta, carpeta)
  if (rutaCuentas) {
    salida.log(
      `Lista de las ${rastro.emailsSinContrasena.length} cuenta(s) creadas sin contraseña (para pnpm credenciales:inicial): ${rutaCuentas}`,
    )
  }
  const fallas = rastro.pasos.reduce((a, p) => a + p.fallidos.length, 0)
  if (rastro.interrumpidaEn !== null) {
    salida.error(
      `La carga se interrumpió en "${rastro.interrumpidaEn.split(' (')[0]}". Lo ya cargado queda en la base: reintentá con --resume.`,
    )
    return 3
  }
  if (fallas > 0) {
    salida.error(
      `La carga terminó con ${fallas} falla(s). Revisá el informe y reintentá con --resume.`,
    )
    return 3
  }
  salida.log('Carga terminada sin fallas.')
  return 0
}
