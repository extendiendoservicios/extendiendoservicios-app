// tests/e2e-responsive/globalSetup.ts — RESP-003 (P17.2)
//
// Vacía los archivos de hallazgos de la corrida anterior. Se hace acá y no en un `beforeAll`
// porque Playwright reinicia el proceso de trabajo después de cada test fallido y volvería a
// ejecutar el `beforeAll`, borrando los hallazgos que ya se habían registrado.

import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { CAPTURAS_DIR } from './helpers/checks.ts'

export default function globalSetup(): void {
  mkdirSync(CAPTURAS_DIR, { recursive: true })
  for (const file of readdirSync(CAPTURAS_DIR)) {
    if (file.startsWith('hallazgos-') && file.endsWith('.jsonl')) {
      rmSync(path.join(CAPTURAS_DIR, file))
    }
  }
}
