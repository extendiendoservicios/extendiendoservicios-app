import { test } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { definirCapturasP28 } from '../../fixtures/capturas-p28.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'

// P28.7: capturas de las pantallas nuevas a 390 px (proyecto `mobile`, táctil) y comprobación de que
// ninguna tiene scroll horizontal de la página.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('owner') })

definirCapturasP28(test, 'celular 390')
