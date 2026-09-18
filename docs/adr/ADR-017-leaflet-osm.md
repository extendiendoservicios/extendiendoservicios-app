# ADR-017 · Leaflet + OpenStreetMap para mapas

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-023 (aclarado el 17 sep), P-028

## Problema

Mike pidió coordenadas en clientes y sedes para verlos en un mapa. La V3 excluye "mapas" de los costos (punto 3) y cotiza la geolocalización avanzada aparte.

## Alternativas

1. Leaflet + tiles de OpenStreetMap, con Nominatim para buscar direcciones.
2. Google Maps Platform (requiere tarjeta y tiene costos por uso).
3. Mapbox (capa gratuita con límite, requiere cuenta).

## Decisión

Alternativa 1: mapa estático de sedes (ADM-24) y MapPicker en los formularios. Sin presencia de empleados ni GPS en tiempo real (módulo B).

## Motivo

Sin costo ni cuentas de terceros; suficiente para marcar y ubicar sedes; sin datos personales enviados a terceros (las coordenadas de sedes no son datos de personas).

## Consecuencias

- Uso de Nominatim con `User-Agent` propio, sin autocompletar por tecla (una búsqueda por clic) para respetar su política de uso.
- Atribución de OpenStreetMap visible.
- Si el módulo de geolocalización avanzada exige más (rutas, tráfico), se evalúa un proveedor pago en su ADR.
