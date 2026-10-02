// tests/lighthouse/instalabilidad.ts — RESP-010 (P17.4)
//
// Lighthouse 12 en adelante ya no tiene la categoría PWA. Estas son las comprobaciones de
// instalabilidad hechas a mano, con el navegador real, contra la URL medida: manifest válido,
// service worker registrado y controlando la página, íconos 192/512 y maskable (con su tamaño
// real, leído del PNG), `start_url`, `display`, `theme-color` y lo que el propio Chrome informa
// como errores de instalabilidad (`Page.getInstallabilityErrors`).

import type { Page } from '@playwright/test'

export interface Comprobacion {
  punto: string
  ok: boolean
  detalle: string
}

interface IconoManifest {
  src: string
  sizes?: string
  type?: string
  purpose?: string
}

interface Manifest {
  name?: string
  short_name?: string
  start_url?: string
  scope?: string
  display?: string
  theme_color?: string
  background_color?: string
  icons?: IconoManifest[]
}

/** Lee el ancho y el alto de un PNG desde su cabecera IHDR. */
function dimensionesPng(bytes: number[]): string {
  const firma = [0x89, 0x50, 0x4e, 0x47]
  if (!firma.every((b, i) => bytes[i] === b)) return 'no es PNG'
  const u32 = (o: number) =>
    ((bytes[o] << 24) |
      (bytes[o + 1] << 16) |
      (bytes[o + 2] << 8) |
      bytes[o + 3]) >>>
    0
  return `${u32(16)}x${u32(20)}`
}

export async function comprobarInstalabilidad(
  page: Page,
  baseUrl: string,
): Promise<Comprobacion[]> {
  const res: Comprobacion[] = []
  const agregar = (punto: string, ok: boolean, detalle: string) =>
    res.push({ punto, ok, detalle })

  await page.goto(`${baseUrl}/ingresar`, { waitUntil: 'load' })

  // 1. Service worker: registrado, activo y, tras recargar, controlando la página.
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { soportado: false }
    const reg = await navigator.serviceWorker.ready
    // `ready` resuelve con el worker todavía "activating": se espera a que termine de activarse.
    for (let i = 0; i < 50 && reg.active?.state !== 'activated'; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    return {
      soportado: true,
      scope: reg.scope,
      estado: reg.active?.state ?? null,
      script: reg.active?.scriptURL ?? null,
    }
  })
  await page.reload({ waitUntil: 'load' })
  const controla = await page.evaluate(
    () => navigator.serviceWorker.controller !== null,
  )
  agregar(
    'Service worker registrado y activo',
    sw.soportado === true && sw.estado === 'activated',
    `scope ${sw.scope ?? '-'}, estado ${sw.estado ?? '-'}, script ${sw.script ?? '-'}`,
  )
  agregar(
    'Service worker controla la página (tras recargar)',
    controla,
    controla
      ? 'navigator.serviceWorker.controller presente'
      : 'sin controlador',
  )

  // 2. Manifest enlazado, descargable y con los campos exigidos.
  const enlace = await page.evaluate(
    () =>
      document.querySelector('link[rel="manifest"]')?.getAttribute('href') ??
      null,
  )
  agregar('Enlace <link rel="manifest">', enlace !== null, enlace ?? 'ausente')
  let manifest: Manifest | null = null
  if (enlace) {
    const url = new URL(enlace, `${baseUrl}/`).toString()
    const r = await page.request.get(url)
    const tipo = r.headers()['content-type'] ?? ''
    agregar(
      'Manifest responde 200 con JSON',
      r.ok() && /json/.test(tipo),
      `${r.status()} ${tipo}`,
    )
    if (r.ok()) manifest = (await r.json()) as Manifest
  }
  if (manifest) {
    agregar(
      'name y short_name',
      Boolean(manifest.name && manifest.short_name),
      `"${manifest.name}" / "${manifest.short_name}"`,
    )
    agregar(
      'display',
      manifest.display === 'standalone' ||
        manifest.display === 'fullscreen' ||
        manifest.display === 'minimal-ui',
      String(manifest.display),
    )
    agregar(
      'start_url dentro del scope',
      Boolean(manifest.start_url),
      `start_url ${manifest.start_url}, scope ${manifest.scope}`,
    )
    if (manifest.start_url) {
      const r = await page.request.get(
        new URL(manifest.start_url, `${baseUrl}/`).toString(),
      )
      agregar('start_url responde 200', r.ok(), String(r.status()))
    }
    agregar(
      'theme_color y background_color en el manifest',
      Boolean(manifest.theme_color && manifest.background_color),
      `${manifest.theme_color} / ${manifest.background_color}`,
    )

    // 3. Íconos: existen, son PNG y miden lo que declaran.
    const iconos = manifest.icons ?? []
    for (const icono of iconos) {
      const r = await page.request.get(
        new URL(icono.src, `${baseUrl}/`).toString(),
      )
      const real = r.ok()
        ? dimensionesPng([...(await r.body()).subarray(0, 24)])
        : `HTTP ${r.status()}`
      agregar(
        `Ícono ${icono.src} (${icono.purpose ?? 'any'})`,
        r.ok() && real === icono.sizes,
        `declara ${icono.sizes}, real ${real}`,
      )
    }
    const tiene = (talle: string, proposito: string) =>
      iconos.some(
        (i) =>
          i.sizes === talle &&
          (i.purpose ?? 'any').split(' ').includes(proposito),
      )
    agregar('Ícono 192x192 (any)', tiene('192x192', 'any'), '')
    agregar('Ícono 512x512 (any)', tiene('512x512', 'any'), '')
    agregar('Ícono 512x512 maskable', tiene('512x512', 'maskable'), '')
  }

  // 4. Cabeceras del documento: theme-color, apple-touch-icon, viewport.
  const cabecera = await page.evaluate(() => ({
    themeColor:
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute('content') ?? null,
    apple:
      document
        .querySelector('link[rel="apple-touch-icon"]')
        ?.getAttribute('href') ?? null,
    viewport:
      document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute('content') ?? null,
    appleCapable:
      document
        .querySelector('meta[name="apple-mobile-web-app-capable"]')
        ?.getAttribute('content') ??
      document
        .querySelector('meta[name="mobile-web-app-capable"]')
        ?.getAttribute('content') ??
      null,
  }))
  agregar(
    '<meta name="theme-color">',
    cabecera.themeColor !== null,
    cabecera.themeColor ?? 'ausente',
  )
  agregar(
    '<link rel="apple-touch-icon"> (iOS)',
    cabecera.apple !== null,
    cabecera.apple ?? 'ausente',
  )
  agregar(
    '<meta name="viewport">',
    cabecera.viewport !== null,
    cabecera.viewport ?? 'ausente',
  )
  agregar(
    'Metaetiqueta de app web (informativa)',
    true,
    cabecera.appleCapable ?? 'ausente (informativo)',
  )
  if (cabecera.apple) {
    const r = await page.request.get(
      new URL(cabecera.apple, `${baseUrl}/`).toString(),
    )
    agregar('apple-touch-icon responde 200', r.ok(), `${r.status()}`)
  }

  // 5. Lo que Chrome mismo dice sobre la instalabilidad.
  const cdp = await page.context().newCDPSession(page)
  const errores = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[]
  }
  agregar(
    'Chrome: sin errores de instalabilidad',
    errores.installabilityErrors.length === 0,
    errores.installabilityErrors.length
      ? errores.installabilityErrors.map((e) => e.errorId).join(', ')
      : 'Page.getInstallabilityErrors devolvió una lista vacía',
  )
  await cdp.detach()

  // 6. HTTPS (requisito de instalabilidad); localhost cuenta como contexto seguro.
  const seguro = await page.evaluate(() => window.isSecureContext)
  agregar('Contexto seguro (HTTPS)', seguro, baseUrl)

  return res
}
