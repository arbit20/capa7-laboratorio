import type {
  AppProtocol,
  Device,
  DeviceKind,
  LabConfig,
  ProtocolAction,
} from "./types";
export const PORTS: Record<AppProtocol, number> = {
  DNS: 53,
  HTTP: 80,
  HTTPS: 443,
  SMTP: 587,
  IMAP: 993,
  POP3: 995,
  FTP: 21,
  SFTP: 22,
  SSH: 22,
  TELNET: 23,
  SNMP: 161,
  ICMP: 0,
};
export function makeDevice(
  kind: DeviceKind,
  id: string,
  name: string,
  ip: string,
  x: number,
  y: number,
): Device {
  return {
    id,
    name,
    kind,
    position: { x, y },
    online: true,
    interfaces: kind === "switch" ? [] : [{ id: "eth0", ip, prefix: 24 }],
    gateway: ip.startsWith("192.168.10.") ? "192.168.10.1" : "192.168.20.1",
    dns: "192.168.20.10",
    services: [],
    records: {},
    resources: {},
    files: {},
    accounts: { alumno: "redes123" },
    mailboxes: {},
    certificateValid: true,
  };
}
export function createLab(): LabConfig {
  const pc = makeDevice(
    "client",
    "pc1",
    "PC · Estudiante",
    "192.168.10.10",
    0,
    65,
  );
  pc.files = {
    "notas.txt": "La capa 7 conecta las aplicaciones con los servicios de red.",
    "tarea.txt": "Práctica de Sistemas de Comunicaciones · UNIFRANZ",
  };
  const pc2 = makeDevice(
    "client",
    "pc2",
    "PC · Compañero",
    "192.168.10.11",
    0,
    235,
  );
  const sw1 = makeDevice("switch", "sw1", "Switch · Aula", "", 200, 150);
  const router = makeDevice(
    "router",
    "router",
    "Router · Campus",
    "192.168.10.1",
    400,
    150,
  );
  router.interfaces.push({ id: "eth1", ip: "192.168.20.1", prefix: 24 });
  router.gateway = "";
  router.services = [{ protocol: "SNMP", port: 161, enabled: true }];
  const sw2 = makeDevice("switch", "sw2", "Switch · Servicios", "", 600, 150);
  const dns = makeDevice("dns", "dns", "Servidor DNS", "192.168.20.10", 820, 0);
  dns.services = [{ protocol: "DNS", port: 53, enabled: true }];
  dns.records = {
    "web.aula.test": { ip: "192.168.20.20", ttl: 60 },
    "correo.aula.test": { ip: "192.168.20.30", ttl: 60 },
    "archivos.aula.test": { ip: "192.168.20.30", ttl: 60 },
    "servidor.aula.test": { ip: "192.168.20.30", ttl: 60 },
  };
  const web = makeDevice(
    "server",
    "web",
    "Servidor Web",
    "192.168.20.20",
    820,
    150,
  );
  web.services = (["HTTP", "HTTPS"] as AppProtocol[]).map((protocol) => ({
    protocol,
    port: PORTS[protocol],
    enabled: true,
  }));
  web.resources = {
    "/": "<h1>¡Hola, capa 7!</h1><p>Tu solicitud atravesó la red y este servidor respondió.</p><p>Bienvenido al campus virtual de UNIFRANZ.</p>",
    "/api/cursos": JSON.stringify(
      {
        materia: "Sistemas de Comunicaciones",
        tema: "Capa de aplicación",
        protocolos: ["DNS", "HTTP", "SMTP"],
      },
      null,
      2,
    ),
  };
  const srv = makeDevice(
    "server",
    "srv",
    "Servidor de Aplicaciones",
    "192.168.20.30",
    820,
    300,
  );
  srv.services = (
    [
      "SMTP",
      "IMAP",
      "POP3",
      "FTP",
      "SFTP",
      "SSH",
      "TELNET",
      "SNMP",
    ] as AppProtocol[]
  ).map((protocol) => ({ protocol, port: PORTS[protocol], enabled: true }));
  srv.files = {
    "bienvenida.txt":
      "Bienvenido al servidor de aplicaciones. Este archivo viajó por la red simulada.",
    "redes.txt":
      "DNS resuelve nombres. HTTP entrega recursos. SMTP transporta correo.",
  };
  srv.mailboxes = {
    "alumno@aula.test": [
      {
        id: "welcome",
        from: "docente@aula.test",
        to: "alumno@aula.test",
        subject: "Bienvenido al laboratorio",
        body: "Explora cómo se comunican las aplicaciones y observa sus datos en cada paso.",
        read: false,
      },
    ],
    "compañero@aula.test": [],
  };
  const pairs = [
    ["pc1", "sw1"],
    ["pc2", "sw1"],
    ["sw1", "router"],
    ["router", "sw2"],
    ["sw2", "dns"],
    ["sw2", "web"],
    ["sw2", "srv"],
  ];
  return {
    schemaVersion: 1,
    name: "Campus conectado",
    devices: [pc, pc2, sw1, router, sw2, dns, web, srv],
    links: pairs.map(([source, target], i) => ({
      id: `link-${i}`,
      source,
      target,
      sourceInterface: source === "router" ? "eth1" : "eth0",
      targetInterface: "eth0",
      online: true,
    })),
  };
}
export type ScenarioId = "web" | "dns" | "mail" | "files" | "remote" | "snmp";
export const SCENARIOS: {
  id: ScenarioId;
  number: string;
  title: string;
  subtitle: string;
  protocols: string;
  description: string;
  duration: string;
  action: ProtocolAction;
}[] = [
  {
    id: "web",
    number: "01",
    title: "Navegación web",
    subtitle: "De un nombre a una página",
    protocols: "DNS · HTTP · HTTPS",
    description:
      "Escribe una dirección. Sigue la consulta DNS, la conexión y la respuesta del servidor hasta que la página aparezca en tu equipo.",
    duration: "3 min",
    action: {
      protocol: "HTTP",
      sourceId: "pc1",
      target: "web.aula.test",
      path: "/",
      method: "GET",
    },
  },
  {
    id: "dns",
    number: "02",
    title: "Resolución DNS",
    subtitle: "La agenda de Internet",
    protocols: "DNS",
    description:
      "Descubre cómo un nombre se convierte en una dirección IP. Repite la consulta para ver la caché y su tiempo de vida.",
    duration: "Explorar",
    action: { protocol: "DNS", sourceId: "pc1", target: "web.aula.test" },
  },
  {
    id: "mail",
    number: "03",
    title: "Correo electrónico",
    subtitle: "Enviar, recibir y sincronizar",
    protocols: "SMTP · IMAP · POP3",
    description:
      "Envía un correo y abre el mismo buzón con IMAP o POP3. Observa que entregar, descargar y leer son acciones diferentes.",
    duration: "1 min",
    action: {
      protocol: "SMTP",
      sourceId: "pc1",
      target: "correo.aula.test",
      username: "alumno",
      password: "redes123",
      from: "docente@aula.test",
      to: "alumno@aula.test",
      subject: "Mi primer mensaje",
      body: "¡Hola! Este correo acaba de recorrer la red.",
    },
  },
  {
    id: "files",
    number: "04",
    title: "Transferencia de archivos",
    subtitle: "Los datos llegan a su destino",
    protocols: "FTP · SFTP",
    description:
      "Descarga un archivo o sube tus notas. Compara las dos conexiones de FTP con el canal protegido de SFTP.",
    duration: "45 s",
    action: {
      protocol: "FTP",
      sourceId: "pc1",
      target: "archivos.aula.test",
      username: "alumno",
      password: "redes123",
      method: "get",
      filename: "bienvenida.txt",
    },
  },
  {
    id: "remote",
    number: "05",
    title: "Acceso remoto",
    subtitle: "Una terminal en otro equipo",
    protocols: "SSH · TELNET",
    description:
      "Inicia sesión y consulta el nombre del servidor. Compara lo que se puede observar en tránsito usando SSH y Telnet.",
    duration: "45 s",
    action: {
      protocol: "SSH",
      sourceId: "pc1",
      target: "servidor.aula.test",
      username: "alumno",
      password: "redes123",
      command: "hostname",
    },
  },
  {
    id: "snmp",
    number: "06",
    title: "Monitoreo de red",
    subtitle: "Preguntar al dispositivo",
    protocols: "SNMP",
    description:
      "El administrador consulta un OID. El agente del router responde con su nombre, tiempo activo o contadores de tráfico.",
    duration: "30 s",
    action: {
      protocol: "SNMP",
      sourceId: "pc1",
      target: "192.168.10.1",
      oid: "1.3.6.1.2.1.1.5.0",
    },
  },
];
