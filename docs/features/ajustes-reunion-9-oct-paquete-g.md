# Paquete G (AJ2-02): alto contraste

## Qué es
Un tema adicional de alto contraste (WCAG AAA donde se puede): texto casi negro,
bordes oscuros y visibles, botones primarios más oscuros (texto blanco >= 9:1),
semánticos más oscuros con fondo claro y borde, y foco grueso (anillo de 3 px más
contorno). El fondo sigue siendo blanco. El tema normal no cambia.

## Dónde se activa
En «Mi perfil» (COM-04, común a administración y celular), sección «Accesibilidad»,
interruptor «Alto contraste». Se guarda en la cuenta (`profiles.high_contrast`,
RPC `set_my_high_contrast`), así que vale en todos los dispositivos de la persona.

## Cómo funciona
- `<html data-contrast="high">` activa `:root[data-contrast='high']` en `src/styles/tokens.css`.
- `src/lib/contrast.ts` pone/quita el atributo y recuerda el último valor en
  `localStorage` (`es.highContrast`); un script en `index.html` lo aplica antes de
  que cargue React para evitar el parpadeo.
- `AuthProvider` aplica `profile.highContrast` (manda sobre lo guardado) y lo quita al
  cerrar sesión.
- El cambio en Perfil es optimista: si la RPC falla, se revierte y sale un aviso.

## Cómo extender los tokens
Agregá o ajustá la variable en el bloque `:root[data-contrast='high']` con el mismo
nombre que en `:root`. Los alias de shadcn y las utilidades de Tailwind la siguen
solos. En componentes usá siempre tokens (`text-text-2`, `border-border`), nunca hex
sueltos, o el tema no los alcanza.
