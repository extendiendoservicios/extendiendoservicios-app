# Ajustes de la reunión del 9 de octubre, paquete C: fotos

Cubre AJ2-06 «foto de clientes» y AJ2-07 «foto al crear cliente o empleado».
La base de datos está en la migración `0039_p19_6c_foto_de_clientes.sql` (ver
«Foto de clientes» en `docs/database.md`).

## AJ2-06: foto de clientes

- Dato: `clients.photo_path` (ruta, no URL), expuesto por `v_clients`. Bucket
  público `client-photos`, 2 MB, solo `image/jpeg`, ruta `{client_id}/{uuid}.jpg`.
  Se muestra con `getPublicUrl` (`clientPhotoUrl` en `src/api/photos.ts`), igual
  que los avatares de personas.
- Quién puede subir, reemplazar o quitar: dueño y administrador (las pantallas
  de clientes ya son solo para ellos). El empleado no ve la foto.
- Formulario de cliente (`ClientFormPage`, ADM-20): bloque «Foto del cliente».
  En edición usa `ClientPhotoUpload`, que sube y guarda al instante (sin esperar
  a «Guardar cambios»), igual que la foto de perfil del empleado. Al reemplazar,
  borra la anterior con la Storage API.
- Ficha del cliente (`ClientDetailPage`, ADM-21): la foto va en el encabezado.
- Listado (`ClientsPage`, ADM-19): avatar chico junto al nombre, con las
  iniciales si no hay foto (color por hash del id, como en las personas).
- No se tocaron la búsqueda global ni el selector de clientes.

## AJ2-07: elegir la foto al crear

- `PendingPhotoPicker` (`src/components/`): elegir y recortar la foto en el
  formulario de alta. No sube nada: deja el JPEG recortado en memoria.
- Alta de cliente: después de crear el cliente y tener su `id`, se sube con
  `savePhoto('client', id, blob)`.
- Alta de empleado: después de que la Edge Function `admin-users` devuelve el
  `profile_id`, se sube con `savePhoto('profile', profileId, blob)` al bucket
  `avatars`, con la misma ruta (`{profile_id}/{uuid}.jpg`) y el mismo permiso que
  la edición. Las políticas de `avatars` (0014, 0030) dejan a owner y admin
  escribir en la carpeta de cualquier persona (`app.is_admin()`), así que no hizo
  falta ningún permiso nuevo.
- Si la subida falla, el alta NO se deshace: aviso (toast de advertencia) «Se
  creó X, pero no se pudo guardar la foto. Probá de nuevo desde Editar.» y se
  navega igual a la ficha.

## Código

- `src/api/photos.ts`: `savePhoto` (sube, guarda la ruta, borra la anterior y
  limpia el archivo si no pudo guardar la ruta), `removePhoto`, `clientPhotoUrl`,
  `photoPublicUrl`. Errores tipados con `ApiError` y hints `PHOTO_UPLOAD_FAILED`,
  `PHOTO_SAVE_FAILED`, `PHOTO_REMOVE_FAILED`.
- `src/components/PhotoCropDialog.tsx`: el diálogo de recorte, extraído de
  `AvatarUpload` sin cambios de comportamiento, más `prepareCropState`.
- `AvatarUpload` ahora acepta `kind` (`'profile'` por defecto o `'client'`) y usa
  `src/api/photos.ts`; `ClientPhotoUpload` es el envoltorio para clientes.
- `ClientListRow` y `ClientDetail` suman `photoPath`.

## Pruebas

`src/api/photos.test.ts`, `src/components/PendingPhotoPicker.test.tsx`,
`src/components/ClientPhotoUpload.test.tsx`,
`src/pages/admin/ClientFormPage.test.tsx` y
`src/pages/admin/EmployeeFormPage.test.tsx` (alta con foto, con foto que falla y
sin foto).
