# Exposición de siete minutos · Capa 7

**Propósito:** mostrar que la capa de aplicación define mensajes, significados y servicios que los programas utilizan para comunicarse. Cada demostración debe unir tres elementos: acción del usuario, intercambio por la red y resultado en el destino.

## Preparación

Abre `Iniciar-Simulador.cmd` antes de comenzar. Pulsa **Restaurar escenario**, selecciona el PC Estudiante y activa **Presentar**. Mantén visible el lienzo y utiliza los paneles de consola e inspector cuando hagan falta. Pulsa **Iniciar flujo** para ejecutar la herramienta del escenario. Usa **Pausar** y **Avanzar un evento** para explicar un mensaje, o aumenta la velocidad para terminar una secuencia.

Todas las cuentas y direcciones son ficticias. La demostración funciona sin Internet. Si cambiaste el laboratorio para ensayar, exporta primero el JSON que quieras conservar y después restaura el escenario.

Selecciona **4×** para completar el recorrido de siete minutos. Usa **0,5×**, pausa o avance por evento cuando quieras detenerte a explicar un mensaje. La guía aparece en la pestaña inferior **Guía**, sin cubrir los equipos; puedes alternar con **Consola** y **Línea temporal**.

| Tiempo | Demostración | Idea que debe quedar clara |
|---|---|---|
| 0:00–3:00 | DNS, HTTP y HTTPS | Nombre → dirección → petición → respuesta |
| 3:00–4:00 | SMTP, IMAP y POP3 | Enviar, sincronizar y recuperar son funciones diferentes |
| 4:00–4:45 | FTP y SFTP | El archivo aparece en destino después de transferirse |
| 4:45–5:30 | SSH y Telnet | El comando se ejecuta en el equipo remoto |
| 5:30–6:00 | SNMP | El administrador consulta variables del dispositivo |
| 6:00–7:00 | Fallo, explicación y reparación | Una aplicación necesita servicios y conectividad disponibles |

## 0:00–3:00 · De un nombre a una página

**0:00–0:30.** Señala las dos LAN, el router y los servidores. Di: «El estudiante quiere una página. La aplicación necesita localizar el servicio, enviar una solicitud y entender su respuesta». Abre la vista OSI y señala la capa 7. Aclara que los mensajes viajan usando las capas inferiores.

**0:30–1:15.** Ejecuta:

```text
nslookup web.aula.test
```

Avanza por pasos. Selecciona la consulta DNS y luego la respuesta. Muestra el nombre consultado, la dirección `192.168.20.20`, el puerto 53 y el TTL. Repite la consulta para mostrar que la caché evita una nueva consulta de red mientras siga vigente.

**1:15–2:15.** En Navegación web abre `http://web.aula.test/`. Sigue los mensajes hasta el servidor. Inspecciona `GET /`, la respuesta `200` y su cuerpo. Señala que la página aparece al completar la respuesta. Visita `/no-existe` para observar `404`: el servidor respondió, aunque el recurso no existe.

**2:15–3:00.** Abre `https://web.aula.test/`. Muestra el establecimiento TLS y selecciona un mensaje HTTPS. Alterna **En tránsito** y **En el equipo**. Di: «Los extremos ven el contenido; un observador del enlace ve metadatos y contenido protegido». Explica que el cifrado mostrado es una representación didáctica. La ruta física puede ser la misma; cambia la protección de la conversación.

## 3:00–4:00 · Correo electrónico

Selecciona Correo, conserva la cuenta `alumno` / `redes123` y envía al buzón `alumno@aula.test` un mensaje titulado «Saludo de clase». Sigue la conversación SMTP hasta la confirmación de entrega.

Abre el mismo buzón mediante IMAP y lee el mensaje. Muestra el estado de lectura guardado en el servidor. Consulta después mediante POP3. Di: «SMTP transportó el mensaje; IMAP sincroniza el buzón; POP3 recupera mensajes». En esta demostración, POP3 conserva la copia del servidor: descargar no implica necesariamente borrar.

## 4:00–4:45 · Transferencia de archivos

Selecciona Archivos y descarga `bienvenida.txt` mediante FTP. Señala el canal de control del puerto 21 y el canal de datos pasivo. Comprueba que el archivo aparece en el cliente con el contenido correcto. Sube `notas.txt` para mostrar el sentido opuesto.

Cambia a SFTP y descarga `redes.txt`. Di: «SFTP utiliza SSH. Sus operaciones de archivo viajan por ese canal protegido». Selecciona un mensaje y muestra que está protegido en tránsito.

## 4:45–5:30 · Acceso remoto

Desde la consola:

```text
ssh alumno@servidor.aula.test
whoami
cat redes.txt
exit
telnet alumno@servidor.aula.test
hostname
```

Deja que termine cada comando antes del siguiente. Señala que el contenido de `redes.txt` pertenece al servidor. Compara los mensajes SSH protegidos con los de Telnet visibles en tránsito. Di: «La consola local envía una orden; el equipo remoto la ejecuta y devuelve su salida».

## 5:30–6:00 · Monitoreo SNMP

Selecciona SNMP, consulta el nombre del router y su contador de paquetes. En consola, los ejemplos equivalentes son:

```text
snmpget 192.168.10.1 1.3.6.1.2.1.1.5.0
snmpget 192.168.10.1 1.3.6.1.2.1.2.2.1.11.1
```

Muestra el OID de la solicitud y el valor de la respuesta. Di: «El OID identifica una variable. El administrador pregunta y el agente del dispositivo responde». Los contadores cambian con el tráfico simulado.

## 6:00–7:00 · Provocar y corregir un fallo

En Navegación web, activa el fallo **Servicio HTTP apagado**. Ejecuta `ping 192.168.20.20` para demostrar que existe conectividad y después abre `http://web.aula.test/`: la aplicación no obtiene el servicio. Desactiva el fallo y repite la solicitud para mostrar la recuperación. Como alternativa, activa **Certificado HTTPS inválido** y solicita `https://web.aula.test/` para demostrar el rechazo de la identidad del servidor.

Como variante, apaga el servicio DNS y consulta un nombre nuevo para evitar la caché. Compara el timeout con la respuesta `NXDOMAIN` de un nombre inexistente cuando DNS sí está disponible. Ambos fallos tienen causas distintas.

Cierra con la página, el correo y el archivo visibles: «En los tres casos viajan datos, pero cada protocolo define un diálogo diferente y una forma de interpretar el resultado».

## Respuestas breves para preguntas de clase

| Pregunta | Respuesta |
|---|---|
| ¿El navegador es la capa 7? | Es una aplicación que utiliza protocolos de esa capa, por ejemplo HTTP y DNS. |
| ¿DNS es necesario al usar una IP? | En este modelo, una dirección IPv4 literal evita la resolución del nombre. |
| ¿404 significa que la red está caída? | No. Significa que el servidor HTTP respondió que no encontró ese recurso. |
| ¿HTTPS oculta todo? | Protege el contenido de aplicación en tránsito; siguen siendo observables metadatos de red. |
| ¿SFTP es FTP con TLS? | No. SFTP opera sobre SSH. FTP protegido con TLS es FTPS y no se simula aquí. |
| ¿SMTP lee el buzón? | SMTP entrega correo; para consultar el buzón se utilizan IMAP o POP3. |
| ¿Estos comandos afectan mi computadora? | Operan únicamente sobre los equipos y archivos de la simulación. |

Las referencias técnicas y los límites del modelo están en [README.md](README.md).
