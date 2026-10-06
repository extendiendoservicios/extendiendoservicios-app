// @vitest-environment node
// DATA-008: pruebas de las guardas del script de contraseñas (carpeta de salida, lista de emails,
// CSV) y de lo que el flujo corta antes de tocar la base.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ejecutarEntregaDeCredenciales } from './ejecutar.ts'
import {
  celdaCsv,
  ErrorDeGuarda,
  filaCsv,
  leerEmails,
  validarCarpetaDeSalida,
} from './guardas.ts'

let base: string
let dirApp: string
let afuera: string

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'cred-test-'))
  dirApp = join(base, 'repo', 'app')
  mkdirSync(join(dirApp, 'src'), { recursive: true })
  mkdirSync(join(base, 'repo', '.git'), { recursive: true })
  afuera = join(base, 'otra-carpeta', 'credenciales')
  mkdirSync(join(base, 'otra-carpeta'), { recursive: true })
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('validarCarpetaDeSalida', () => {
  it('rechaza si no se indica la carpeta', () => {
    expect(() => validarCarpetaDeSalida(undefined, dirApp)).toThrow(
      ErrorDeGuarda,
    )
    expect(() => validarCarpetaDeSalida('  ', dirApp)).toThrow(/Falta --salida/)
  })

  it('rechaza app/ y cualquier subcarpeta, existan o no', () => {
    expect(() => validarCarpetaDeSalida(dirApp, dirApp)).toThrow(
      /dentro del repositorio/,
    )
    expect(() => validarCarpetaDeSalida(join(dirApp, 'src'), dirApp)).toThrow(
      /dentro del repositorio/,
    )
    expect(() =>
      validarCarpetaDeSalida(join(dirApp, 'no-existe', 'todavia'), dirApp),
    ).toThrow(/dentro del repositorio/)
  })

  it('rechaza una ruta que sube y vuelve a entrar con ..', () => {
    expect(() =>
      validarCarpetaDeSalida(
        join(afuera, '..', '..', 'repo', 'app', 'x'),
        dirApp,
      ),
    ).toThrow(/dentro del repositorio/)
  })

  it('rechaza una carpeta de un repositorio git aunque no sea app/', () => {
    expect(() =>
      validarCarpetaDeSalida(join(base, 'repo', 'docs'), dirApp),
    ).toThrow(/repositorio git/)
  })

  it('no confunde una carpeta hermana con nombre parecido', () => {
    const parecida = join(base, 'otra-carpeta', 'app-credenciales')
    expect(validarCarpetaDeSalida(parecida, dirApp)).toBe(parecida)
  })

  it('acepta una carpeta de afuera, aunque todavía no exista', () => {
    expect(validarCarpetaDeSalida(afuera, dirApp)).toBe(afuera)
  })

  it('en Windows no distingue mayúsculas al comparar con app/', () => {
    if (process.platform !== 'win32') return
    expect(() =>
      validarCarpetaDeSalida(join(dirApp, 'src').toUpperCase(), dirApp),
    ).toThrow(/dentro del repositorio/)
  })
})

describe('leerEmails', () => {
  it('lee uno por línea, sin repetidos, en minúsculas, ignorando vacías y comentarios', () => {
    const r = leerEmails(
      '\uFEFF# cuentas creadas\nAna@Prueba.test\n\n  beto@prueba.test  \nana@prueba.test\r\n',
    )
    expect(r.emails).toEqual(['ana@prueba.test', 'beto@prueba.test'])
    expect(r.invalidos).toEqual([])
  })

  it('acepta separadores coma y punto y coma', () => {
    expect(leerEmails('a@x.test; b@x.test, c@x.test').emails).toHaveLength(3)
  })

  it('informa los renglones que no son un email', () => {
    const r = leerEmails('a@x.test\nno es un email\nb@x\n')
    expect(r.emails).toEqual(['a@x.test'])
    expect(r.invalidos).toEqual([2, 3])
  })
})

describe('CSV', () => {
  it('pone todo entre comillas y duplica las comillas internas', () => {
    expect(celdaCsv('Ana "la jefa"; Pérez')).toBe('"Ana ""la jefa""; Pérez"')
  })

  it('neutraliza las fórmulas de Excel', () => {
    expect(celdaCsv('=SUMA(A1)')).toBe('"\'=SUMA(A1)"')
    expect(celdaCsv('+54 11')).toBe('"\'+54 11"')
    expect(celdaCsv('@usuario')).toBe('"\'@usuario"')
  })

  it('arma una fila con punto y coma', () => {
    expect(filaCsv(['Ana', 'a@x.test', 'Empleado', 'Kq7m-Xw3p-Tn9d'])).toBe(
      '"Ana";"a@x.test";"Empleado";"Kq7m-Xw3p-Tn9d"',
    )
  })
})

describe('el flujo corta antes de tocar nada', () => {
  const ENV_DEV = {
    IMPORT_ENTORNO: 'app_dev',
    VITE_SUPABASE_URL: 'https://anesttvrnpsaaaxaquce.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'clave-de-prueba',
  }

  async function correr(
    argumentos: string[],
    env: Record<string, string | undefined> = ENV_DEV,
  ) {
    const errores: string[] = []
    const logs: string[] = []
    const codigo = await ejecutarEntregaDeCredenciales(argumentos, {
      env,
      dirApp,
      salida: { log: (m) => logs.push(m), error: (m) => errores.push(m) },
    })
    return { codigo, errores: errores.join('\n'), logs: logs.join('\n') }
  }

  function lista(): string {
    const ruta = join(base, 'lista.txt')
    writeFileSync(ruta, 'a@x.test\n')
    return ruta
  }

  it('sin --emails', async () => {
    const r = await correr(['--salida', afuera])
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('Falta --emails')
  })

  it('sin --salida', async () => {
    const r = await correr(['--emails', lista()])
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('Falta --salida')
  })

  it('con la salida dentro de app/', async () => {
    const r = await correr([
      '--emails',
      lista(),
      '--salida',
      join(dirApp, 'credenciales'),
    ])
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('dentro del repositorio')
  })

  it('con --dry-run también exige una salida segura', async () => {
    const r = await correr([
      '--emails',
      lista(),
      '--salida',
      dirApp,
      '--dry-run',
    ])
    expect(r.codigo).toBe(2)
  })

  it('sin IMPORT_ENTORNO', async () => {
    const r = await correr(['--emails', lista(), '--salida', afuera], {
      ...ENV_DEV,
      IMPORT_ENTORNO: undefined,
    })
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('IMPORT_ENTORNO')
  })

  it('contra producción sin la bandera de F20', async () => {
    const r = await correr(['--emails', lista(), '--salida', afuera], {
      ...ENV_DEV,
      IMPORT_ENTORNO: 'app',
      VITE_SUPABASE_URL: 'https://fysuppdadwvabrjpnnoh.supabase.co',
    })
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('PRODUCCIÓN')
  })

  it('con el entorno y la URL cruzados', async () => {
    const r = await correr(['--emails', lista(), '--salida', afuera], {
      ...ENV_DEV,
      VITE_SUPABASE_URL: 'https://fysuppdadwvabrjpnnoh.supabase.co',
    })
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('no coincide')
  })

  it('con una lista que tiene renglones que no son emails', async () => {
    const ruta = join(base, 'mala.txt')
    writeFileSync(ruta, 'a@x.test\nbasura\n')
    const r = await correr(['--emails', ruta, '--salida', afuera])
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('no son un email')
  })

  it('con un archivo de emails que no existe', async () => {
    const r = await correr([
      '--emails',
      join(base, 'no-existe.txt'),
      '--salida',
      afuera,
    ])
    expect(r.codigo).toBe(2)
    expect(r.errores).toContain('No se pudo leer')
  })

  it('--ayuda sale bien y no pide nada más', async () => {
    const r = await correr(['--ayuda'], {})
    expect(r.codigo).toBe(0)
    expect(r.logs).toContain('Entrega de contraseñas iniciales')
  })
})
