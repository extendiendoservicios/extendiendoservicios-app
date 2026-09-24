// tests/e2e-clients-sites/helpers/interceptMap.ts — SITE-008 (P08.5)
//
// Regla 5 del encargo: la búsqueda de Nominatim NO se llama de verdad en los e2e (servicio
// externo con límite de uso, `RateLimiter` de `src/components/map/nominatimClient.ts`). Esta
// suite carga las coordenadas a mano en los campos de latitud y longitud de `MapPicker`
// (`useCoordinateFields`), así que en la práctica ningún spec aprieta "Buscar dirección" — pero
// se intercepta la ruta igual, por si algún flujo futuro la ejecutara sin querer, para que un
// pedido real a Nominatim nunca salga de esta suite.
//
// Los tiles de OpenStreetMap (`MapView`/`MapPicker`, `TileLayer`) sí se piden apenas se monta
// cualquier mapa: se intercepta también, con un PNG de 1×1 transparente, para no depender de la
// red ni de OSM en cada corrida (y para que la suite sea estable, TEST-029).

import type { Page } from '@playwright/test'

/** PNG de 1×1, transparente, codificado en base64 (el tile más chico posible). */
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** Intercepta Nominatim y los tiles de OSM antes de navegar a cualquier pantalla con mapa. */
export async function interceptMapRequests(page: Page): Promise<void> {
  await page.route('https://nominatim.openstreetmap.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    })
  })

  await page.route('**tile.openstreetmap.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(TRANSPARENT_PNG_BASE64, 'base64'),
    })
  })
}
