import { test } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { definirCapturasP28 } from '../../fixtures/capturas-p28.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'

// P28.7: capturas de las pantallas nuevas a 1280 px (proyecto `chromium`). Las de 390 px están en
// `p28-capturas.movil.admin.ts`; las dos usan el mismo recorrido (`fixtures/capturas-p28.ts`).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('owner') })

definirCapturasP28(test, 'escritorio 1280')
