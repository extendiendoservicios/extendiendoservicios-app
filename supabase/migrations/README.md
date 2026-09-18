# `supabase/migrations`

Migraciones numeradas (`0001_...sql`, `0002_...sql`, ...) según el orden de
`04_Modelo_de_Datos.md` sección 11. Una vez aplicada una migración en
`App_dev` no se edita más: un cambio posterior es una migración nueva.

`pnpm db:push` las aplica contra el proyecto vinculado. Carpeta vacía hasta
F4.
