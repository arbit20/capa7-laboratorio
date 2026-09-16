# Laboratorio Capa 7 · UNIFRANZ

Simulador web 2D de la capa de aplicación para la exposición de **Sistemas de Comunicaciones**, basado en las 13 diapositivas proporcionadas. El lienzo muestra cómo una solicitud atraviesa dos redes, qué mensajes intercambian las aplicaciones y qué datos llegan al destino. El archivo original `Presentacion_Capa7.pptx` se conserva.

## Iniciar la presentación

Con la carpeta `dist` incluida y **Node.js 22.12 o posterior** instalado, haz doble clic en **`Iniciar-Simulador.cmd`**. Se abre `http://127.0.0.1:4173` en el navegador predeterminado. Todos los recursos de la aplicación están en la carpeta local; no se necesita Internet para utilizarla.

El iniciador ejecuta el servidor local en segundo plano. Si esta misma copia ya está abierta, la reutiliza. Si otro programa o copia utiliza el puerto 4173, informa del conflicto sin cerrar procesos. Los mensajes de diagnóstico se guardan en `.local/server.log` y `.local/server-error.log`.

También puedes iniciar el servidor en una terminal y detenerlo con `Ctrl+C`:

```powershell
cd C:\SistemasComunicacion
npm run demo
```

Abre `http://127.0.0.1:4173`. `npm run demo` utiliza únicamente Node.js y los archivos de `dist`; no necesita descargar paquetes.

## Desarrollo y reconstrucción

La instalación inicial de las dependencias necesita Internet. Una vez instaladas, el desarrollo y la compilación pueden realizarse localmente.

```powershell
npm ci
npm run dev
```

Para actualizar la versión utilizada por el iniciador:

```powershell
npm run build
npm run demo
```

La aplicación utiliza React, TypeScript, Vite y React Flow. El motor de simulación es independiente del lienzo: los formularios y la consola crean las mismas acciones, y la interfaz reproduce sus eventos. Avanzar manualmente y reproducir automáticamente ejecutan la misma cola determinista.

## Publicación posterior en Vercel

Repositorio del proyecto: [arbit20/capa7-laboratorio](https://github.com/arbit20/capa7-laboratorio). Para acceder al repositorio privado, inicia sesión en GitHub con una cuenta autorizada.

El proyecto incluye `vercel.json` con la configuración de compilación. Cuando quieras publicarlo, importa el repositorio de GitHub en Vercel, usa la raíz del repositorio como **Root Directory** y selecciona **Node.js 24.x**. Los demás valores quedan definidos en el archivo:

| Ajuste | Valor |
|---|---|
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

No se necesitan variables de entorno, claves ni servicios de backend: el laboratorio se ejecuta en el navegador. El iniciador de Windows sigue disponible para la exposición local sin Internet. El guardado del sitio publicado pertenece a su propio dominio; usa **Exportar** e **Importar** para trasladar un laboratorio desde la versión local.

Preparar estos archivos no crea un despliegue. La publicación se realizará al importar el repositorio y pulsar **Deploy** en Vercel. Referencias oficiales: [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite), [configuración de `vercel.json`](https://vercel.com/docs/project-configuration/vercel-json) y [versiones de Node.js](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Recorrido del laboratorio

1. Elige un escenario: navegación web, DNS, correo, archivos, acceso remoto o SNMP.
2. Pulsa **Iniciar flujo** en la herramienta preparada o escribe un comando en la consola.
3. Usa **Reproducir simulación**, **Pausar** o **Avanzar un evento**. Ajusta la velocidad para explicar el recorrido.
4. Selecciona un mensaje en el lienzo o la línea temporal. Inspecciona direcciones, puertos, protocolo y datos.
5. Alterna **En el equipo** y **En tránsito** para comparar datos descifrados en el extremo con lo observable en el enlace.
6. Utiliza la vista OSI para relacionar la aplicación con transporte y red.

El editor permite agregar dispositivos, arrastrarlos, unir sus puntos de conexión, seleccionar equipos para configurarlos y eliminar elementos. Una modificación de configuración cancela las operaciones pendientes, de modo que una transferencia nunca termina utilizando una topología anterior. Mover un icono no cancela la ejecución.

Los fallos permiten interrumpir enlaces o servicios, alterar DNS, rechazar credenciales y rechazar certificados. Durante una ejecución, el motor conserva los pasos ya realizados y verifica el fallo al llegar al siguiente intercambio afectado. Después de mostrar el error, desactiva el fallo y repite la operación. **Restaurar escenario** recupera el laboratorio inicial, incluidos archivos, buzones, caché y sesiones. **Presentar** activa la vista para exposición.

El guion de siete minutos está en [GUIA_EXPOSICION.md](GUIA_EXPOSICION.md).

## Red y datos de demostración

| Equipo | Dirección | Uso |
|---|---|---|
| PC · Estudiante | `192.168.10.10/24` | Cliente principal |
| PC · Compañero | `192.168.10.11/24` | Segundo cliente |
| Router · Campus | `192.168.10.1` y `192.168.20.1` | Une las dos LAN |
| Servidor DNS | `192.168.20.10` | Resuelve nombres `.test` |
| Servidor Web | `192.168.20.20` | HTTP y HTTPS |
| Servidor de Aplicaciones | `192.168.20.30` | Correo, archivos, acceso remoto y SNMP |

Nombres preparados: `web.aula.test`, `correo.aula.test`, `archivos.aula.test` y `servidor.aula.test`.

**Cuenta ficticia:** usuario `alumno`, contraseña `redes123`. **Buzón:** `alumno@aula.test`. Los archivos `notas.txt` y `tarea.txt` comienzan en el cliente; `bienvenida.txt` y `redes.txt` comienzan en el servidor.

## Consola

La consola controla exclusivamente el entorno simulado. `help` muestra la sintaxis disponible, las flechas recuperan el historial y `Tab` autocompleta comandos. Las acciones no soportadas muestran ayuda explícita.

```text
help
ipconfig
ping 192.168.20.20
nslookup web.aula.test
curl http://web.aula.test/
curl https://web.aula.test/api/cursos
curl http://web.aula.test/no-existe
curl -X POST -d '{"mensaje":"Hola clase"}' http://web.aula.test/api/mensajes
curl http://web.aula.test/api/mensajes
```

Archivos: inicia sesión y utiliza `ls`, `get`, `put` y `exit`. La subida utiliza el contenido del archivo del cliente.

```text
ftp alumno@archivos.aula.test
ls
get bienvenida.txt
put notas.txt
exit
sftp alumno@archivos.aula.test
get redes.txt
exit
```

Acceso remoto: admite `hostname`, `whoami`, `ls`, `cat ARCHIVO` y `exit`.

```text
ssh alumno@servidor.aula.test
whoami
ls
cat redes.txt
exit
telnet alumno@servidor.aula.test
hostname
exit
```

Correo y monitoreo:

```text
smtp alumno@aula.test "Saludo de clase" "Este mensaje recorre la red simulada."
imap correo.aula.test list
imap correo.aula.test read welcome
pop3 correo.aula.test read welcome
snmpget 192.168.10.1 1.3.6.1.2.1.1.5.0
snmpget 192.168.10.1 1.3.6.1.2.1.1.3.0
snmpget 192.168.10.1 1.3.6.1.2.1.2.2.1.11.1
```

Puedes probar autenticación incorrecta con `ssh alumno@servidor.aula.test -p incorrecta`. Estas contraseñas pertenecen al modelo didáctico y no corresponden a cuentas externas.

## Guardado y exportación

El laboratorio se guarda en el almacenamiento local del navegador. Exportar produce un archivo JSON con `schemaVersion: 1`, la topología y el estado de las aplicaciones. Importar permite cargarlo en otro navegador o equipo conservando archivos, buzones, estados de lectura, recursos web creados y contadores. Los fallos activados también se guardan con sus valores originales: después de recargar o importar, puedes desactivarlos y reparar el laboratorio. La importación comienza detenida con un nuevo reloj, sin operaciones pendientes, caché DNS ni sesiones abiertas; vuelve a consultar nombres e inicia sesión para continuar. El historial de animación no se conserva y no constituye una captura de tráfico real.

El guardado pertenece al navegador y al origen utilizado: `localhost`, `127.0.0.1` y distintos puertos tienen almacenamientos separados. Conserva un JSON exportado antes de borrar datos del navegador. Restaurar reemplaza el estado de trabajo por el escenario inicial.

## Verificación reproducible

```powershell
npm run test
npm run build
npm run test:e2e
npm run test:all
```

Las pruebas unitarias cubren conectividad y puerta de enlace, IP duplicadas, caché DNS, TTL, NXDOMAIN y timeout, HTTP y certificados, correo compartido, transferencias y sesiones, SNMP, persistencia y cancelación. También comparan la consola con las acciones gráficas y la ejecución por pasos con la ejecución completa. Las pruebas de importación verifican la conservación de datos y el rechazo de esquemas desconocidos, estructuras inválidas y archivos demasiado grandes.

Las pruebas de navegador se ejecutan con Playwright en Chrome y Edge, a 1366×768 y 1920×1080, e incluyen operación sin conexiones externas. Las evidencias y los resultados reales de la ejecución acompañan la entrega; una prueba disponible en el código no implica por sí misma que haya sido aprobada.

`npm run test:all` ejecuta las pruebas unitarias, compila, valida los navegadores y genera la [galería de evidencia](evidence/index.html). El [informe de comprobaciones](evidence/COMPROBACIONES.md) contiene los resultados y `evidence/summary.json` identifica los archivos compilados mediante SHA-256. Para explorar trazas y adjuntos: `npx playwright show-report evidence/playwright-report`.

## Alcance didáctico

- El modelo representa IPv4 estática, switches transparentes, subredes y redes directamente conectadas por un router. TCP, Ethernet y encapsulación se resumen para mantener el foco en la capa 7; no se implementan un sistema operativo de red, DHCP, ARP, NAT ni enrutamiento dinámico.
- La secuencia de eventos utiliza segundos simulados. La velocidad visual cambia el ritmo de exposición; no mide rendimiento de una red física.
- DNS modela registros A y caché con TTL, sin recursión real ni registros AAAA, MX o PTR. Los nombres `.test` se resuelven dentro del laboratorio. El fallo de registro incorrecto apunta a una IP sin equipo y vacía explícitamente la caché al activarlo y repararlo para que su efecto sea observable.
- HTTP/1.1 representa peticiones, cabeceras, estados y recursos. HTTPS incorpora una secuencia TLS 1.3 simplificada. La protección de contenido en tránsito es una visualización didáctica; no se generan claves ni cifrado criptográfico real.
- SMTP entrega mensajes; IMAP conserva el estado de lectura en el servidor. El perfil inicial utiliza SMTP/587 con STARTTLS, IMAP/993 y POP3/995. POP3 recupera sin borrar: se representa el comportamiento de conservar una copia, y no se implementa `DELE`.
- FTP utiliza control y datos separados en modo pasivo. SFTP representa operaciones sobre un canal SSH; no es FTP cifrado.
- SSH y Telnet ejecutan una lista limitada de comandos sobre archivos simulados. SNMPv2c permite consultas de lectura a OID preparados; no modifica dispositivos.
- Las animaciones representan mensajes lógicos o agrupaciones simplificadas. Los bytes corresponden al contenido didáctico codificado en UTF-8; los contadores SNMP agregan eventos del equipo y no equivalen a mediciones de una interfaz física.
- La aplicación no realiza solicitudes a los dominios simulados, no abre sesiones reales y no envía correos ni archivos fuera del laboratorio.

## Fuentes de apoyo

El contenido temático parte de `Presentacion_Capa7.pptx`. Para contrastar protocolos, se utilizaron fuentes primarias:

- [DNS: RFC 1035](https://www.rfc-editor.org/rfc/rfc1035), consultas, respuestas y caché.
- [HTTP: RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html), semántica de solicitudes y respuestas.
- [TLS 1.3: RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html), establecimiento de comunicación protegida.
- [SMTP: RFC 5321](https://www.rfc-editor.org/rfc/rfc5321), transporte de correo.
- [FTP: RFC 959](https://www.rfc-editor.org/rfc/rfc959), separación de control y datos.
- [SFTP: manual de OpenBSD](https://man.openbsd.org/sftp), transferencia sobre transporte SSH.
- [SNMPv2: RFC 3416](https://www.rfc-editor.org/rfc/rfc3416), operaciones de consulta y respuesta.
