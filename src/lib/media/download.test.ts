// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import {
  assignFileNames,
  buildMediaFileName,
  downloadFile,
  downloadZip,
  sanitizeNamePart,
} from './download'

describe('sanitizeNamePart', () => {
  it('saca tildes, espacios y símbolos, y pasa a mayúscula inicial', () => {
    expect(sanitizeNamePart('Cliente X')).toBe('ClienteX')
    expect(sanitizeNamePart('Sede Norte (2)')).toBe('SedeNorte2')
    expect(sanitizeNamePart('María José Ñandú')).toBe('MariaJoseNandu')
    expect(sanitizeNamePart("O'Higgins & Cía.")).toBe('OHigginsCia')
  })

  it('no deja pasar separadores de ruta ni caracteres prohibidos en Windows', () => {
    const result = sanitizeNamePart('../../etc/passwd: <a>|"b"?*')
    expect(result).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('un nombre vacío o solo símbolos queda como SinDato', () => {
    expect(sanitizeNamePart('')).toBe('SinDato')
    expect(sanitizeNamePart('***')).toBe('SinDato')
  })

  it('corta los nombres larguísimos', () => {
    expect(sanitizeNamePart('a'.repeat(100)).length).toBeLessThanOrEqual(30)
  })
})

describe('buildMediaFileName', () => {
  it('arma AAAA-MM-DD_Cliente_Sede_Persona_NN.ext', () => {
    expect(
      buildMediaFileName(
        {
          date: '2026-10-13',
          client: 'Cliente X',
          site: 'Sede Y',
          person: 'Nombre',
          extension: 'jpg',
        },
        1,
      ),
    ).toBe('2026-10-13_ClienteX_SedeY_Nombre_01.jpg')
  })

  it('usa el día de Buenos Aires, no el de UTC', () => {
    const name = buildMediaFileName(
      {
        date: new Date('2026-10-14T01:30:00Z'), // 22:30 del 13 en Buenos Aires
        client: 'C',
        site: 'S',
        person: 'P',
        extension: 'mp4',
      },
      12,
    )
    expect(name).toBe('2026-10-13_C_S_P_12.mp4')
  })

  it('sanea la extensión', () => {
    expect(
      buildMediaFileName(
        {
          date: '2026-10-13',
          client: 'C',
          site: 'S',
          person: 'P',
          extension: '.JPG/',
        },
        3,
      ),
    ).toMatch(/_03\.jpg$/)
  })
})

describe('assignFileNames', () => {
  const base = {
    date: '2026-10-13',
    client: 'Cliente X',
    site: 'Sede Y',
    extension: 'jpg',
  }

  it('numera dentro de cada persona y turno, sin repetir nombres', () => {
    const names = assignFileNames([
      { ...base, person: 'Ana' },
      { ...base, person: 'Ana' },
      { ...base, person: 'Luis' },
      { ...base, person: 'Ana', extension: 'mp4' },
      { ...base, person: 'Ana', date: '2026-10-14' },
    ])
    expect(names).toEqual([
      '2026-10-13_ClienteX_SedeY_Ana_01.jpg',
      '2026-10-13_ClienteX_SedeY_Ana_02.jpg',
      '2026-10-13_ClienteX_SedeY_Luis_01.jpg',
      '2026-10-13_ClienteX_SedeY_Ana_03.mp4',
      '2026-10-14_ClienteX_SedeY_Ana_01.jpg',
    ])
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('descargas', () => {
  const saved: Array<{ download: string; href: string }> = []

  beforeEach(() => {
    saved.length = 0
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ download: this.download, href: this.href })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('downloadFile baja la URL firmada y la guarda con el nombre dado', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
    )
    vi.stubGlobal('fetch', fetchMock)
    await downloadFile('https://storage.test/firmada?token=abc', 'foto.jpg')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.test/firmada?token=abc',
      expect.anything(),
    )
    expect(saved).toEqual([{ download: 'foto.jpg', href: 'blob:fake' }])
  })

  it('downloadFile avisa en español si la URL ya venció', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('no', { status: 400 }))),
    )
    await expect(
      downloadFile('https://x.test/a', 'a.jpg'),
    ).rejects.toMatchObject({
      code: 'download_failed',
      message: 'No pudimos descargar el archivo. Probá de nuevo.',
    })
  })

  it('downloadZip arma un ZIP con los nombres legibles y los bytes de cada archivo', async () => {
    const bodies: Record<string, number[]> = {
      'https://s.test/1': [10, 11],
      'https://s.test/2': [20, 21, 22],
      'https://s.test/3': [30],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(new Response(new Uint8Array(bodies[url] ?? []))),
      ),
    )
    const progress: number[] = []
    const blob = await downloadZip(
      [
        {
          url: 'https://s.test/1',
          date: '2026-10-13',
          client: 'Cliente X',
          site: 'Sede Y',
          person: 'Ana',
          extension: 'jpg',
        },
        {
          url: 'https://s.test/2',
          date: '2026-10-13',
          client: 'Cliente X',
          site: 'Sede Y',
          person: 'Ana',
          extension: 'jpg',
        },
        {
          url: 'https://s.test/3',
          date: '2026-10-13',
          client: 'Cliente X',
          site: 'Sede Y',
          person: 'Luis',
          extension: 'mp4',
        },
      ],
      {
        zipName: 'turno-13-oct.zip',
        onProgress: (done) => progress.push(done),
      },
    )

    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual([
      '2026-10-13_ClienteX_SedeY_Ana_01.jpg',
      '2026-10-13_ClienteX_SedeY_Ana_02.jpg',
      '2026-10-13_ClienteX_SedeY_Luis_01.mp4',
    ])
    expect(
      Array.from(files['2026-10-13_ClienteX_SedeY_Ana_02.jpg'] ?? []),
    ).toEqual([20, 21, 22])
    expect(progress).toEqual([1, 2, 3])
    expect(saved).toEqual([{ download: 'turno-13-oct.zip', href: 'blob:fake' }])
  })

  it('downloadZip falla entero si un archivo no se puede bajar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('no', { status: 403 }))),
    )
    await expect(
      downloadZip([
        {
          url: 'https://s.test/1',
          date: '2026-10-13',
          client: 'C',
          site: 'S',
          person: 'P',
          extension: 'jpg',
        },
      ]),
    ).rejects.toMatchObject({ code: 'download_failed' })
    expect(saved).toHaveLength(0)
  })

  it('downloadZip sin archivos es un error, no un ZIP vacío', async () => {
    await expect(downloadZip([])).rejects.toMatchObject({
      code: 'download_failed',
    })
  })
})
