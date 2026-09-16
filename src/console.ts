import type { LabConfig, ProtocolAction, RuntimeData, Session } from "./types";

export interface ParsedCommand {
  action?: ProtocolAction;
  output?: string;
  clear?: boolean;
}

export const COMMAND_NAMES = [
  "help",
  "clear",
  "ipconfig",
  "ping",
  "nslookup",
  "curl",
  "smtp",
  "imap",
  "pop3",
  "ftp",
  "sftp",
  "ssh",
  "telnet",
  "snmpget",
  "ls",
  "get",
  "put",
  "cat",
  "hostname",
  "whoami",
  "exit",
];
export const COMMAND_EXAMPLES = [
  "nslookup web.aula.test",
  "curl http://web.aula.test/",
  "curl https://web.aula.test/api/cursos",
  'curl -X POST -d "Hola desde la capa 7" http://web.aula.test/api/mensajes',
  'smtp alumno@aula.test "Prueba de correo" "Hola desde la consola"',
  "imap correo.aula.test list",
  "ftp archivos.aula.test",
  "get bienvenida.txt",
  "sftp archivos.aula.test",
  "ssh servidor.aula.test",
  "snmpget 192.168.10.1 1.3.6.1.2.1.1.5.0",
];

const HELP = `CONSOLA DEL LABORATORIO · todos los comandos operan sobre la red simulada

help / clear                 Ayuda / limpiar la consola
ipconfig                     IP, máscara, puerta de enlace y DNS del equipo
ping HOST                    Comprobar conectividad (ICMP)
nslookup NOMBRE              Consultar un nombre DNS
curl URL                     Solicitud web GET (http:// o https://)
curl -X POST -d "CUERPO" URL  Enviar datos al servidor
smtp PARA "ASUNTO" "CUERPO"   Entregar un correo por SMTP
imap HOST [list|read ID]      Consultar o leer el buzón de alumno
pop3 HOST [list|read ID]      Listar o descargar un correo
ftp HOST / sftp HOST         Abrir una sesión de archivos
ssh HOST / telnet HOST       Abrir una sesión de terminal
snmpget HOST OID             Consultar un dato de un dispositivo

En una sesión de archivos: ls, get ARCHIVO, put ARCHIVO ["CONTENIDO"], exit.
En una sesión de terminal: hostname, whoami, ls, cat ARCHIVO, exit.
Para autenticación: HOST -u USUARIO -p CONTRASEÑA, o USUARIO@HOST.
Cuenta de demostración: alumno / redes123. No se ejecutan órdenes del sistema operativo.`;

function tokenize(text: string): string[] | undefined {
  const tokens: string[] = [];
  let current = "",
    quote = "",
    started = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (
      character === "\\" &&
      index + 1 < text.length &&
      (text[index + 1] === quote ||
        text[index + 1] === "\\" ||
        (!quote && /\s/.test(text[index + 1])))
    ) {
      current += text[++index];
      started = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) tokens.push(current);
  return tokens;
}

function authenticatedArgs(args: string[]): {
  positional: string[];
  username: string;
  password: string;
  error?: string;
} {
  const result = {
    positional: [] as string[],
    username: "alumno",
    password: "redes123",
    error: undefined as string | undefined,
  };
  for (let index = 0; index < args.length; index++) {
    const item = args[index];
    if (item === "-u" || item === "-p") {
      const value = args[++index];
      if (value === undefined || value.startsWith("-"))
        return {
          ...result,
          error: `Falta el valor de ${item}. Ejemplo: -u alumno -p redes123`,
        };
      if (item === "-u") result.username = value;
      else result.password = value;
    } else if (item.startsWith("-"))
      return {
        ...result,
        error: `Opción desconocida: ${item}. Usa -u USUARIO y -p CONTRASEÑA.`,
      };
    else result.positional.push(item);
  }
  if (result.positional[0]?.includes("@")) {
    const at = result.positional[0].lastIndexOf("@");
    result.username = result.positional[0].slice(0, at);
    result.positional[0] = result.positional[0].slice(at + 1);
  }
  return result;
}

function sessionTarget(session: Session, lab: LabConfig): string {
  return (
    lab.devices.find((device) => device.id === session.targetId)?.interfaces[0]
      ?.ip ?? session.targetId
  );
}

export function parseCommand(
  command: string,
  lab: LabConfig,
  runtime: RuntimeData,
  sourceId: string,
): ParsedCommand {
  const tokens = tokenize(command.trim());
  if (!tokens)
    return {
      output:
        "Falta cerrar una comilla. Encierra cada texto con espacios entre comillas.",
    };
  if (!tokens.length) return {};
  const [rawName, ...args] = tokens;
  const name = rawName.toLowerCase();
  const source = lab.devices.find((device) => device.id === sourceId);
  const action = (value: Omit<ProtocolAction, "sourceId">): ParsedCommand => ({
    action: { ...value, sourceId },
  });
  const usage = (syntax: string): ParsedCommand => ({
    output: `Uso: ${syntax}`,
  });

  if (name === "help" || name === "?") return { output: HELP };
  if (name === "clear" || name === "cls") return { clear: true };
  if (!source)
    return {
      output: "Selecciona un equipo de origen válido en el laboratorio.",
    };
  if (name === "ipconfig") {
    const interfaces = source.interfaces
      .map((net) => `${net.id}: ${net.ip}/${net.prefix}`)
      .join("\n");
    return {
      output: `${source.name}\n${interfaces || "Sin interfaz IP"}\nPuerta de enlace: ${source.gateway || "(ninguna)"}\nDNS: ${source.dns || "(sin configurar)"}`,
    };
  }
  if (name === "ping" || name === "nslookup") {
    if (args.length !== 1)
      return usage(`${name} ${name === "ping" ? "HOST" : "NOMBRE"}`);
    return action({
      protocol: name === "ping" ? "ICMP" : "DNS",
      target: args[0],
    });
  }
  if (name === "curl") {
    let method = "GET",
      explicitMethod = false,
      body: string | undefined,
      address: string | undefined;
    for (let index = 0; index < args.length; index++) {
      const item = args[index];
      if (item === "-X" || item === "--request") {
        method = (args[++index] ?? "").toUpperCase();
        explicitMethod = true;
        if (method !== "GET" && method !== "POST")
          return {
            output:
              'curl admite GET y POST. Uso: curl [-X POST] [-d "CUERPO"] URL',
          };
      } else if (item === "-d" || item === "--data") {
        body = args[++index];
        if (body === undefined) return usage('curl -X POST -d "CUERPO" URL');
      } else if (item.startsWith("-"))
        return {
          output: `Opción curl no disponible: ${item}. Uso: curl [-X POST] [-d "CUERPO"] URL`,
        };
      else if (address !== undefined)
        return usage('curl [-X POST] [-d "CUERPO"] URL');
      else address = item;
    }
    if (!explicitMethod && body !== undefined) method = "POST";
    if (!address) return usage('curl [-X POST] [-d "CUERPO"] URL');
    try {
      const url = new URL(
        address.includes("://") ? address : `http://${address}`,
      );
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      )
        return {
          output:
            "Usa una dirección http:// o https:// del laboratorio, sin credenciales en la URL.",
        };
      if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))
        return {
          output:
            "Esta práctica usa HTTP en el puerto 80 y HTTPS en el puerto 443.",
        };
      return action({
        protocol: url.protocol === "https:" ? "HTTPS" : "HTTP",
        target: url.hostname,
        path: url.pathname + url.search,
        method,
        ...(body !== undefined ? { body } : {}),
      });
    } catch {
      return {
        output:
          "La dirección no es válida. Ejemplo: curl http://web.aula.test/",
      };
    }
  }
  if (name === "smtp") {
    if (args.length !== 3) return usage('smtp DESTINATARIO "ASUNTO" "CUERPO"');
    return action({
      protocol: "SMTP",
      target: "correo.aula.test",
      username: "alumno",
      password: "redes123",
      from: "alumno@aula.test",
      to: args[0],
      subject: args[1],
      body: args[2],
    });
  }
  if (["ftp", "sftp", "ssh", "telnet", "imap", "pop3"].includes(name)) {
    const parsed = authenticatedArgs(args);
    if (parsed.error) return { output: parsed.error };
    const [target, method = "list", filename] = parsed.positional;
    if (!target)
      return usage(
        `${name} HOST [-u USUARIO] [-p CONTRASEÑA]${name === "imap" || name === "pop3" ? " [list|read ID]" : ""}`,
      );
    const auth = {
      target,
      username: parsed.username,
      password: parsed.password,
    };
    if (name === "imap" || name === "pop3") {
      if (
        !["list", "read"].includes(method) ||
        (method === "read" && !filename) ||
        parsed.positional.length > (method === "read" ? 3 : 2)
      )
        return usage(
          `${name} HOST [list|read ID] [-u USUARIO] [-p CONTRASEÑA]`,
        );
      return action({
        protocol: name === "imap" ? "IMAP" : "POP3",
        ...auth,
        method,
        ...(filename ? { filename } : {}),
        to: `${parsed.username}@aula.test`,
      });
    }
    if (parsed.positional.length !== 1)
      return usage(`${name} HOST [-u USUARIO] [-p CONTRASEÑA]`);
    return name === "ftp" || name === "sftp"
      ? action({
          protocol: name === "ftp" ? "FTP" : "SFTP",
          ...auth,
          method: "open",
        })
      : action({
          protocol: name === "ssh" ? "SSH" : "TELNET",
          ...auth,
          command: "hostname",
        });
  }
  if (name === "snmpget") {
    if (args.length !== 2) return usage("snmpget HOST OID");
    return action({ protocol: "SNMP", target: args[0], oid: args[1] });
  }
  if (
    ["ls", "get", "put", "cat", "hostname", "whoami", "exit"].includes(name)
  ) {
    const session = runtime.sessions[sourceId];
    if (!session)
      return {
        output:
          "No hay una sesión abierta. Usa ftp HOST, sftp HOST, ssh HOST o telnet HOST.",
      };
    const target = sessionTarget(session, lab);
    const remote = session.protocol === "SSH" || session.protocol === "TELNET";
    const common = {
      protocol: session.protocol,
      target,
      username: session.username,
    };
    if (name === "exit")
      return args.length
        ? usage("exit")
        : action({
            ...common,
            ...(remote ? { command: "exit" } : { method: "exit" }),
          });
    if (name === "ls")
      return args.length
        ? usage("ls")
        : action({
            ...common,
            ...(remote ? { command: "ls" } : { method: "list" }),
          });
    if (name === "hostname" || name === "whoami") {
      if (!remote)
        return {
          output: `${name} necesita una sesión SSH o Telnet. En esta sesión usa ls, get, put o exit.`,
        };
      return args.length ? usage(name) : action({ ...common, command: name });
    }
    if (name === "cat") {
      if (!remote)
        return {
          output:
            "cat necesita una sesión SSH o Telnet. Usa get ARCHIVO para descargarlo en esta sesión.",
        };
      return args.length === 1
        ? action({ ...common, command: `cat ${args[0]}` })
        : usage("cat ARCHIVO");
    }
    if (remote)
      return {
        output: `${name} necesita una sesión FTP o SFTP. Usa exit y abre una sesión de archivos.`,
      };
    if (name === "get")
      return args.length === 1
        ? action({ ...common, method: "get", filename: args[0] })
        : usage("get ARCHIVO");
    if (args.length < 1 || args.length > 2)
      return usage('put ARCHIVO ["CONTENIDO"]');
    const sourceFiles = runtime.devices[sourceId]?.files ?? {};
    const content =
      args[1] ??
      (Object.prototype.hasOwnProperty.call(sourceFiles, args[0])
        ? sourceFiles[args[0]]
        : undefined);
    if (content === undefined)
      return {
        output: `El archivo ${args[0]} no existe en este cliente. Usa put ${args[0]} "CONTENIDO" para crearlo y subirlo.`,
      };
    return action({ ...common, method: "put", filename: args[0], content });
  }
  return {
    output: `Comando no disponible: ${rawName}. Escribe help para ver las herramientas del laboratorio.`,
  };
}
