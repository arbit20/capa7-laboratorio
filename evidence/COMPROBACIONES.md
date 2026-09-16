# Comprobaciones de entrega

Fecha de validación: **16 de septiembre de 2026**. Directorio: `C:\SistemasComunicacion`.

## Motor, consola y persistencia

Se ejecutó `npx vitest run src` y `npx tsc --noEmit` para verificar el motor, el analizador de consola, la importación y los tipos de TypeScript. La cobertura comprueba comportamientos observables: rutas y fallos, datos que realmente llegan al destino, estado de correo y archivos, autenticación, HTTP, DNS, SNMP, reproducción determinista y recuperación del laboratorio.

**Resultado:** 75 pruebas aprobadas en cuatro archivos; comprobación TypeScript aprobada. Incluye conservación y reparación de fallos activos después de exportar/importar, compatibilidad de archivos anteriores y rechazo de datos de fallos malformados.

Durante la revisión se detectaron y corrigieron IP duplicadas que no impedían tráfico, TTL al exportar y reutilización indebida de una sesión ante una contraseña explícita incorrecta. Las regresiones forman parte de la suite.

Comandos reproducibles:

```powershell
npx vitest run src
npx tsc --noEmit
npm run build
npm run test:e2e
```

## Iniciador y servidor local

Prueba real con la compilación `dist` presente:

| Comprobación ejecutada | Resultado |
|---|---|
| Ejecutar `scripts/launch.ps1` | Servidor iniciado y navegador abierto |
| Ejecutarlo dos veces más | Misma instancia reutilizada; sin duplicar el proceso |
| Identificación `GET /__health` | HTTP 200; aplicación y carpeta correctas |
| Escucha de red | Únicamente `127.0.0.1:4173` |
| `GET /` | HTTP 200 y tipo `text/html` |
| Recursos referenciados por el HTML | Tres recursos locales disponibles; tipos JavaScript/CSS correctos |
| `HEAD /` | HTTP 200 sin cuerpo |
| Archivo JS inexistente | HTTP 404 |
| Traversal codificado con `../` | HTTP 403; no se expone README ni archivos externos |
| Ruta con barra inversa codificada o byte nulo | HTTP 400 |
| `POST /` | HTTP 405; servidor estático de lectura |
| Sintaxis de `serve.mjs` y `launch.ps1` | Aprobada |
| Mensajes del iniciador en PowerShell 5 | Acentos correctos después de guardar el script como UTF-8 con BOM |

El servidor quedó activo para la validación de navegador. No se utilizaron dependencias remotas para servir la aplicación. La comprobación de escucha y recursos locales no sustituye la prueba de navegación con conexiones externas bloqueadas.

## Fuente académica

Se comprobó el archivo `Presentacion_Capa7.pptx`:

- Tamaño: **272.564 bytes**.
- **13 diapositivas** y 87 entradas en el contenedor ZIP.
- Integridad ZIP: **aprobada**, sin entradas dañadas.
- La presentación fuente continúa disponible en la carpeta del proyecto.

## Navegador y evidencia visual

**76 pruebas E2E aprobadas**, 0 fallos, 0 omitidas y 0 inestables. Chrome y Edge, en 1366×768 y 1920×1080. Duración de Playwright: 191.1 segundos.

Todos los escenarios se ejecutaron con conexiones externas bloqueadas. Se comprobaron movimiento real de sobres, pausa, datos HTTP/HTTPS, correo, archivos, terminal remota, SNMP, fallos y recuperación, edición de la red, persistencia y guía de presentación.

Se revisaron capturas del laboratorio, del tráfico en movimiento y de la guía. La guía ocupa la pestaña inferior para conservar libre la topología. El navegador simulado mantiene el contenido en un iframe aislado sin permisos de scripts. El diagnóstico específico del navegador sobre ejecución bloqueada dentro de ese iframe se adjunta cuando aparece; todos los demás errores de consola y los errores JavaScript hacen fallar la prueba.

- [Galería de capturas](index.html)
- [Resultados unitarios](unit-results.json)
- [Resultados Playwright](playwright-results.json)
- [Resumen y SHA-256 de la compilación](summary.json)

Validación reproducible completa: `npm run test:all`. Para explorar el reporte interactivo: `npx playwright show-report evidence/playwright-report`.
