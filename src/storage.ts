import type {
  LabSnapshot,
  LabConfig,
  RuntimeData,
  MailMessage,
  PersistedFault,
} from "./types";
export const STORAGE_KEY = "capa7.laboratorio.v1";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const texts = (x: unknown) =>
  object(x) && Object.values(x).every((v) => typeof v === "string");
const mails = (x: unknown) =>
  object(x) &&
  Object.values(x).every(
    (v) =>
      Array.isArray(v) &&
      v.every(
        (m: MailMessage) =>
          object(m) &&
          ["id", "from", "to", "subject", "body"].every(
            (k) =>
              typeof (m as unknown as Record<string, unknown>)[k] === "string",
          ) &&
          typeof m.read === "boolean",
      ),
  );
const protocols = [
  "DNS",
  "HTTP",
  "HTTPS",
  "SMTP",
  "IMAP",
  "POP3",
  "FTP",
  "SFTP",
  "SSH",
  "TELNET",
  "SNMP",
  "ICMP",
];
export function parseSnapshot(text: string): LabSnapshot {
  if (text.length > 5_000_000)
    throw Error("El laboratorio supera el límite de 5 MB.");
  const s: unknown = JSON.parse(text);
  if (
    !object(s) ||
    s.schemaVersion !== 1 ||
    !object(s.lab) ||
    s.lab.schemaVersion !== 1 ||
    typeof s.lab.name !== "string" ||
    !Array.isArray(s.lab.devices) ||
    !Array.isArray(s.lab.links)
  )
    throw Error(
      "Archivo incompatible. Importa un laboratorio JSON de Capa 7, versión 1.",
    );
  const lab = s.lab as Record<string, unknown> & {
    devices: unknown[];
    links: unknown[];
  };
  if (lab.devices.length > 100 || lab.links.length > 300)
    throw Error("El laboratorio admite hasta 100 equipos y 300 enlaces.");
  const ids = new Set<string>();
  for (const d of lab.devices) {
    if (
      !object(d) ||
      typeof d.id !== "string" ||
      ids.has(d.id) ||
      !["client", "server", "switch", "router", "dns"].includes(
        String(d.kind),
      ) ||
      typeof d.name !== "string" ||
      typeof d.online !== "boolean" ||
      !object(d.position) ||
      ![d.position.x, d.position.y].every(Number.isFinite) ||
      !Array.isArray(d.interfaces) ||
      !d.interfaces.every(
        (i) =>
          object(i) &&
          typeof i.id === "string" &&
          typeof i.ip === "string" &&
          Number.isInteger(i.prefix) &&
          Number(i.prefix) >= 1 &&
          Number(i.prefix) <= 32,
      ) ||
      typeof d.gateway !== "string" ||
      typeof d.dns !== "string" ||
      !Array.isArray(d.services) ||
      !d.services.every(
        (v) =>
          object(v) &&
          protocols.includes(String(v.protocol)) &&
          typeof v.enabled === "boolean" &&
          Number.isInteger(v.port) &&
          Number(v.port) >= 0 &&
          Number(v.port) <= 65535,
      ) ||
      !texts(d.files) ||
      !texts(d.resources) ||
      !texts(d.accounts) ||
      !mails(d.mailboxes) ||
      typeof d.certificateValid !== "boolean" ||
      !object(d.records) ||
      !Object.values(d.records).every(
        (v) =>
          object(v) &&
          typeof v.ip === "string" &&
          Number.isFinite(v.ttl) &&
          Number(v.ttl) > 0,
      )
    )
      throw Error("Un dispositivo del archivo contiene datos inválidos.");
    ids.add(d.id);
  }
  const linkIds = new Set<string>();
  for (const l of lab.links) {
    if (
      !object(l) ||
      typeof l.id !== "string" ||
      linkIds.has(l.id) ||
      !ids.has(String(l.source)) ||
      !ids.has(String(l.target)) ||
      l.source === l.target ||
      typeof l.sourceInterface !== "string" ||
      typeof l.targetInterface !== "string" ||
      typeof l.online !== "boolean"
    )
      throw Error("Una conexión del archivo es inválida.");
    linkIds.add(l.id);
  }
  if (
    !object(s.runtime) ||
    !object(s.runtime.devices) ||
    !object(s.runtime.cache) ||
    !object(s.runtime.sessions)
  )
    throw Error("El estado del laboratorio no es válido.");
  for (const id of ids) {
    const d = s.runtime.devices[id];
    if (
      !object(d) ||
      !texts(d.files) ||
      !mails(d.mailboxes) ||
      !Number.isFinite(d.packets) ||
      Number(d.packets) < 0 ||
      !Number.isFinite(d.bytes) ||
      Number(d.bytes) < 0 ||
      (d.resources !== undefined && !texts(d.resources))
    )
      throw Error("Faltan datos de aplicación para un equipo.");
  }
  for (const cache of Object.values(s.runtime.cache)) {
    if (
      !object(cache) ||
      !Object.values(cache).every(
        (v) =>
          object(v) && typeof v.ip === "string" && Number.isFinite(v.expiresAt),
      )
    )
      throw Error("La caché DNS no es válida.");
  }
  if (s.faults !== undefined) {
    if (!Array.isArray(s.faults) || s.faults.length > 300)
      throw Error("El registro de fallos no es válido.");
    for (const f of s.faults) {
      if (
        !object(f) ||
        !object(f.action) ||
        f.action.active !== true ||
        typeof f.action.targetId !== "string" ||
        !["link", "service", "dns", "credentials", "certificate"].includes(
          String(f.action.kind),
        )
      )
        throw Error("Un fallo guardado no es válido.");
      const a = f.action,
        o = f.original;
      const targetExists =
        a.kind === "link"
          ? linkIds.has(String(a.targetId))
          : ids.has(String(a.targetId));
      if (!targetExists)
        throw Error("El fallo hace referencia a un elemento inexistente.");
      if (a.kind === "link" || a.kind === "certificate") {
        if (typeof o !== "boolean")
          throw Error("Estado original de fallo inválido.");
      } else if (a.kind === "service") {
        if (
          !protocols.includes(String(a.protocol)) ||
          !Array.isArray(o) ||
          !o.every(
            (v) =>
              object(v) &&
              protocols.includes(String(v.protocol)) &&
              typeof v.enabled === "boolean" &&
              Number.isInteger(v.port) &&
              Number(v.port) > 0 &&
              Number(v.port) <= 65535,
          )
        )
          throw Error("Respaldo de servicio inválido.");
      } else if (a.kind === "credentials") {
        if (!texts(o)) throw Error("Respaldo de credenciales inválido.");
      } else if (
        !object(o) ||
        !Object.values(o).every(
          (v) =>
            object(v) &&
            typeof v.ip === "string" &&
            Number.isFinite(v.ttl) &&
            Number(v.ttl) > 0,
        )
      )
        throw Error("Respaldo DNS inválido.");
    }
  }
  // Las sesiones y cachés son efímeras: una importación comienza detenida, con un nuevo reloj.
  return {
    schemaVersion: 1,
    lab: lab as unknown as LabConfig,
    runtime: {
      ...(s.runtime as unknown as RuntimeData),
      cache: {},
      sessions: {},
    },
    ...(s.faults ? { faults: s.faults as PersistedFault[] } : {}),
  };
}
export function loadSnapshot(): LabSnapshot | undefined {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? parseSnapshot(s) : undefined;
  } catch {
    return undefined;
  }
}
