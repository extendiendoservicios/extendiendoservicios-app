"""Achica las capturas de `docs/guias/img/` reduciendo la paleta (DOC-018 a DOC-020, P19.4).

Es un paso opcional que se corre después de `capturas.ts`. Necesita Pillow (`pip install pillow`).
Deja los PNG con 128 colores, sin tramado: el texto y los íconos de la app se ven igual y cada
imagen pesa alrededor de un tercio.

Uso, desde la raíz de `app/`:

    python docs/guias/optimizar-png.py
"""

from pathlib import Path

from PIL import Image

CARPETA = Path(__file__).parent / "img"
COLORES = 128


def main() -> None:
    antes = 0
    despues = 0
    for archivo in sorted(CARPETA.glob("*.png")):
        antes += archivo.stat().st_size
        with Image.open(archivo) as imagen:
            reducida = imagen.convert("RGB").quantize(
                colors=COLORES, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
            )
            reducida.save(archivo, format="PNG", optimize=True)
        despues += archivo.stat().st_size
    print(f"{antes // 1024} KB antes, {despues // 1024} KB después.")


if __name__ == "__main__":
    main()
