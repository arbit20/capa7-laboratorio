import type {
  ActionResult,
  AppProtocol,
  Device,
  DeviceRuntime,
  FaultAction,
  LabConfig,
  LabSnapshot,
  MailMessage,
  PersistedFault,
  Protocol,
  ProtocolAction,
  RuntimeData,
  Session,
  SimulationEvent,
} from "./types";
import {
  deviceByAddress,
  ipv4,
  networkRoute,
  routeSourceAddress,
} from "./engine-network";
import { PORTS } from "./scenarios";

export interface EngineSnapshot {
  lab: LabConfig;
  runtime: RuntimeData;
  events: SimulationEvent[];
  results: ActionResult[];
  time: number;
  pending: number;
  revision: number;
}

interface Finish {
  ok: boolean;
  title: string;
  output: string;
  data?: unknown;
}
interface PlannedEvent {
  protocol: Protocol;
  sourceId: string;
  targetId: string;
  sourcePort: number;
  targetPort: number;
  sourceAddress?: string;
  targetAddress?: string;
  title: string;
  explanation: string;
  payload: string;
  encrypted: boolean;
  status: SimulationEvent["status"];
  layer: number;
  clientId: string;
  serverId: string;
  service?: AppProtocol;
  local?: boolean;
  certificate?: boolean;
  auth?: { username: string; password: string };
  session?: Session["protocol"];
  apply?: () => void;
  finish?: Finish;
  destinationIp?: string;
}
interface Task {
  id: string;
  number: number;
  action: ProtocolAction;
  generator?: Generator<PlannedEvent, void, unknown>;
  targetId?: string;
  targetIp?: string;
  addresses?: Record<string, { client: string; server: string }>;
}
interface PacketOptions {
  response?: boolean;
  encrypted?: boolean;
  explanation?: string;
  status?: SimulationEvent["status"];
  service?: AppProtocol;
  port?: number;
  auth?: PlannedEvent["auth"];
  certificate?: boolean;
  session?: Session["protocol"];
  apply?: () => void;
  finish?: Finish;
}

const copy = <T>(value: T): T => structuredClone(value);
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const mailboxFor = (username: string) =>
  username.includes("@") ? username : `${username}@aula.test`;
const readableJson = (value: unknown) => JSON.stringify(value, null, 2);
const resourceName = (value: string) =>
  value.replace(/^\.\//, "").replace(/^\//, "");
const messageText = (message: MailMessage) =>
  `From: ${message.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\n\r\n${message.body}`;
const ownValue = <T>(map: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
const faultKey = (action: FaultAction) =>
  `${action.kind}:${action.targetId}:${action.kind === "service" ? (action.protocol ?? "") : ""}`;

/** A deterministic, browser-only simulator. No command is ever sent to an OS or a network. */
export class SimulationEngine {
  private lab: LabConfig;
  private baseline: LabConfig;
  private baselineRuntime: RuntimeData;
  private baselineFaults: PersistedFault[] = [];
  private runtime: RuntimeData;
  private events: SimulationEvent[] = [];
  private results: ActionResult[] = [];
  private time = 0;
  private revision = 0;
  private sequence = 0;
  private eventSequence = 0;
  private queue: Task[] = [];
  private listeners = new Set<() => void>();
  private snapshot!: EngineSnapshot;
  private originals = new Map<string, unknown>();
  private activeFaults = new Map<string, FaultAction>();

  constructor(
    lab: LabConfig,
    runtime?: RuntimeData,
    faults: PersistedFault[] = [],
  ) {
    this.lab = copy(lab);
    this.baseline = copy(lab);
    this.runtime = this.initialize(runtime);
    this.baselineRuntime = copy(this.runtime);
    this.sequence = this.sequenceSeed();
    this.baselineFaults = copy(faults.filter((fault) => fault.action.active));
    for (const fault of this.baselineFaults) {
      const key = faultKey(fault.action);
      this.originals.set(key, copy(fault.original));
      this.activeFaults.set(key, copy(fault.action));
    }
    this.refresh(false);
  }

  private sequenceSeed(): number {
    let maximum = 0;
    const remember = (text: string) => {
      for (const match of text.matchAll(/(?:mail-|trace-)(\d+)/g)) {
        const value = Number(match[1]);
        if (
          Number.isSafeInteger(value) &&
          value < Number.MAX_SAFE_INTEGER - 1000
        )
          maximum = Math.max(maximum, value);
      }
    };
    for (const device of Object.values(this.runtime.devices)) {
      for (const mailbox of Object.values(device.mailboxes))
        for (const message of mailbox) remember(message.id);
      for (const [path, content] of Object.entries(device.resources ?? {})) {
        remember(path);
        remember(content);
      }
    }
    return maximum;
  }

  private initialize(existing?: RuntimeData): RuntimeData {
    const data: RuntimeData = existing
      ? copy(existing)
      : { devices: {}, cache: {}, sessions: {} };
    data.devices ??= {};
    data.cache ??= {};
    data.sessions ??= {};
    for (const device of this.lab.devices) {
      const current = ownValue(data.devices, device.id);
      data.devices[device.id] = current
        ? { ...current, resources: current.resources ?? copy(device.resources) }
        : {
            files: copy(device.files),
            resources: copy(device.resources),
            mailboxes: copy(device.mailboxes),
            packets: 0,
            bytes: 0,
          };
      data.cache[device.id] ??= {};
    }
    for (const id of Object.keys(data.devices))
      if (!this.lab.devices.some((d) => d.id === id)) {
        delete data.devices[id];
        delete data.cache[id];
        delete data.sessions[id];
      }
    for (const [id, session] of Object.entries(data.sessions))
      if (!this.lab.devices.some((d) => d.id === session.targetId))
        delete data.sessions[id];
    return data;
  }

  getSnapshot = (): EngineSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private refresh(notify = true): void {
    this.revision++;
    this.snapshot = {
      lab: copy(this.lab),
      runtime: copy(this.runtime),
      events: copy(this.events),
      results: copy(this.results),
      time: this.time,
      pending: this.queue.length,
      revision: this.revision,
    };
    if (notify) for (const listener of this.listeners) listener();
  }

  enqueue(action: ProtocolAction): string {
    const normalized = copy(action);
    if (
      (action.protocol === "HTTP" || action.protocol === "HTTPS") &&
      /^https?:\/\//i.test(action.target)
    ) {
      try {
        const url = new URL(action.target);
        normalized.target = url.hostname;
        normalized.path = action.path ?? `${url.pathname}${url.search}`;
      } catch {
        /* validation happens on execution */
      }
    }
    const number = ++this.sequence;
    const id = `trace-${number}`;
    this.queue.push({ id, number, action: normalized });
    this.refresh();
    return id;
  }

  step(): SimulationEvent | undefined {
    const task = this.queue[0];
    if (!task) return undefined;
    this.time++;
    let emitted: SimulationEvent;
    let attempted: PlannedEvent | undefined;
    try {
      task.generator ??= this.workflow(task);
      const next = task.generator.next();
      if (next.done)
        throw new Error("La operación terminó sin una respuesta final.");
      const plan = next.value;
      attempted = plan;
      const route = this.validate(plan);
      plan.apply?.();
      emitted = {
        id: `event-${++this.eventSequence}`,
        traceId: task.id,
        time: this.time,
        protocol: plan.protocol,
        sourceId: plan.sourceId,
        targetId: plan.targetId,
        sourcePort: plan.sourcePort,
        targetPort: plan.targetPort,
        sourceAddress: plan.sourceAddress,
        targetAddress: plan.targetAddress,
        route,
        title: plan.title,
        explanation: plan.explanation,
        payload: plan.payload,
        encrypted: plan.encrypted,
        status: plan.status,
        layer: plan.layer,
        bytes: byteLength(plan.payload),
      };
      if (!plan.local)
        for (const id of new Set(route)) {
          const device = this.runtime.devices[id];
          if (device) {
            device.packets++;
            device.bytes += emitted.bytes;
          }
        }
      if (plan.finish) {
        this.finish(task, plan.finish);
        this.queue.shift();
      }
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      const protocol = attempted?.protocol ?? task.action.protocol;
      let route = [task.action.sourceId];
      if (attempted)
        try {
          route = networkRoute(
            this.lab,
            attempted.sourceId,
            attempted.targetId,
            attempted.destinationIp,
          );
        } catch {
          /* No invented route for a disconnected network. */
        }
      if (attempted?.auth) delete this.runtime.sessions[task.action.sourceId];
      emitted = {
        id: `event-${++this.eventSequence}`,
        traceId: task.id,
        time: this.time,
        protocol,
        sourceId: attempted?.sourceId ?? task.action.sourceId,
        targetId: attempted?.targetId ?? task.targetId ?? task.action.sourceId,
        sourcePort: attempted?.sourcePort ?? 0,
        targetPort: attempted?.targetPort ?? PORTS[task.action.protocol] ?? 0,
        sourceAddress: attempted?.sourceAddress,
        targetAddress: attempted?.targetAddress,
        route,
        title: "La operación se detuvo",
        explanation: output,
        payload: output,
        encrypted: attempted?.encrypted ?? false,
        status: "error",
        layer: attempted?.layer ?? (task.action.protocol === "ICMP" ? 3 : 7),
        bytes: byteLength(output),
      };
      this.finish(task, { ok: false, title: "Operación fallida", output });
      this.queue.shift();
    }
    this.events.push(emitted);
    if (this.events.length > 2000)
      this.events.splice(0, this.events.length - 2000);
    this.refresh();
    return emitted;
  }

  runAll(max = 2000): void {
    for (let i = 0; i < max && this.queue.length; i++) this.step();
  }

  reset(lab?: LabConfig): void {
    if (lab) {
      this.baseline = copy(lab);
      this.lab = copy(lab);
      this.baselineRuntime = this.initialize();
      this.baselineFaults = [];
    }
    this.lab = copy(this.baseline);
    this.runtime = copy(this.baselineRuntime);
    for (const fault of this.baselineFaults)
      this.restoreOriginal(this.lab, fault.action, fault.original);
    if (this.baselineFaults.length) {
      this.runtime.sessions = {};
      for (const id of Object.keys(this.runtime.cache))
        this.runtime.cache[id] = {};
    }
    this.queue = [];
    this.events = [];
    this.results = [];
    this.time = 0;
    this.sequence = this.sequenceSeed();
    this.eventSequence = 0;
    this.originals.clear();
    this.activeFaults.clear();
    this.refresh();
  }

  private cancelPending(reason: string): void {
    for (const task of this.queue)
      this.finish(task, {
        ok: false,
        title: "Operación cancelada",
        output: reason,
      });
    this.queue = [];
  }

  editLab(lab: LabConfig, structural = true): void {
    if (structural)
      this.cancelPending(
        "La topología o configuración cambió; vuelve a ejecutar la operación.",
      );
    // Editing configuration changes only the configured values that actually changed.
    // Runtime downloads, delivered mail and POST resources survive unrelated edits.
    for (const device of lab.devices) {
      const previous = this.lab.devices.find((d) => d.id === device.id),
        runtime = this.runtime.devices[device.id];
      if (!previous || !runtime) continue;
      for (const field of ["resources", "files", "mailboxes"] as const) {
        const before = previous[field],
          after = device[field];
        const destination = (runtime[field] ??= {}) as Record<string, unknown>;
        for (const key of new Set([
          ...Object.keys(before),
          ...Object.keys(after),
        ])) {
          if (JSON.stringify(before[key]) === JSON.stringify(after[key]))
            continue;
          if (Object.prototype.hasOwnProperty.call(after, key))
            destination[key] = copy(after[key]);
          else delete destination[key];
        }
      }
    }
    this.lab = copy(lab);
    this.runtime = this.initialize(this.runtime);
    for (const [key, action] of this.activeFaults) {
      const exists =
        action.kind === "link"
          ? lab.links.some((link) => link.id === action.targetId)
          : lab.devices.some((device) => device.id === action.targetId);
      if (!exists) {
        this.activeFaults.delete(key);
        this.originals.delete(key);
      }
    }
    if (structural) this.runtime.sessions = {};
    this.refresh();
  }

  fault(action: FaultAction): void {
    const key = faultKey(action);
    const device = this.lab.devices.find((d) => d.id === action.targetId);
    const link = this.lab.links.find((l) => l.id === action.targetId);
    const services = device?.services.filter(
      (s) => !action.protocol || s.protocol === action.protocol,
    );
    if (action.kind === "link" && !link) return;
    if (action.kind !== "link" && !device) return;
    if (action.active && this.originals.has(key)) return;
    if (!action.active && !this.originals.has(key)) return;
    if (action.active) {
      if (action.kind === "link") {
        this.originals.set(key, link!.online);
        link!.online = false;
      }
      if (action.kind === "service") {
        this.originals.set(key, copy(services));
        services?.forEach((s) => {
          s.enabled = false;
        });
      }
      if (action.kind === "dns") {
        this.originals.set(key, copy(device!.records));
        device!.records = Object.fromEntries(
          Object.entries(device!.records).map(([name, record]) => [
            name,
            { ...record, ip: "192.168.20.250" },
          ]),
        );
      }
      if (action.kind === "credentials") {
        this.originals.set(key, copy(device!.accounts));
        device!.accounts = Object.fromEntries(
          Object.keys(device!.accounts).map((user) => [
            user,
            "__credencial_revocada__",
          ]),
        );
      }
      if (action.kind === "certificate") {
        this.originals.set(key, device!.certificateValid);
        device!.certificateValid = false;
      }
      this.activeFaults.set(key, copy(action));
    } else {
      const original = this.originals.get(key);
      this.restoreOriginal(this.lab, action, original);
      this.originals.delete(key);
      this.activeFaults.delete(key);
    }
    if (action.kind === "dns")
      for (const id of Object.keys(this.runtime.cache))
        this.runtime.cache[id] = {};
    for (const [id, session] of Object.entries(this.runtime.sessions))
      if (action.kind === "link" || session.targetId === action.targetId)
        delete this.runtime.sessions[id];
    this.refresh();
  }

  private restoreOriginal(
    lab: LabConfig,
    action: FaultAction,
    original: unknown,
  ): void {
    if (action.kind === "link") {
      const link = lab.links.find((item) => item.id === action.targetId);
      if (link) link.online = original as boolean;
      return;
    }
    const device = lab.devices.find((item) => item.id === action.targetId);
    if (!device) return;
    if (action.kind === "service")
      for (const saved of original as Device["services"]) {
        const service = device.services.find(
          (item) => item.protocol === saved.protocol,
        );
        if (service) service.enabled = saved.enabled;
      }
    if (action.kind === "dns")
      device.records = copy(original as Device["records"]);
    if (action.kind === "credentials")
      device.accounts = copy(original as Device["accounts"]);
    if (action.kind === "certificate")
      device.certificateValid = original as boolean;
  }

  exportSnapshot(): LabSnapshot {
    const runtime = copy(this.runtime);
    // Imported simulations start at t=0. Persist remaining TTL, not the old clock epoch.
    for (const cache of Object.values(runtime.cache))
      for (const [name, entry] of Object.entries(cache)) {
        const remaining = entry.expiresAt - this.time;
        if (remaining <= 0) delete cache[name];
        else entry.expiresAt = remaining;
      }
    const faults: PersistedFault[] = Array.from(
      this.activeFaults,
      ([key, action]) => ({ action, original: this.originals.get(key) }),
    );
    return copy({ schemaVersion: 1, lab: this.lab, runtime, faults });
  }

  private finish(task: Task, finish: Finish): void {
    this.results.push({
      traceId: task.id,
      protocol: task.action.protocol,
      sourceId: task.action.sourceId,
      targetId: task.targetId,
      ...copy(finish),
    });
    if (this.results.length > 500)
      this.results.splice(0, this.results.length - 500);
  }
  private device(id: string): Device {
    const device = this.lab.devices.find((d) => d.id === id);
    if (!device) throw new Error(`No existe el equipo ${id}.`);
    return device;
  }
  private state(id: string): DeviceRuntime {
    const data = this.runtime.devices[id];
    if (!data) throw new Error("Estado del dispositivo inexistente.");
    return data;
  }
  private servicePort(device: Device, protocol: AppProtocol): number {
    return (
      device.services.find((s) => s.protocol === protocol)?.port ??
      PORTS[protocol]
    );
  }

  private validate(plan: PlannedEvent): string[] {
    const client = this.device(plan.clientId),
      server = this.device(plan.serverId);
    if (!client.online) throw new Error("El equipo de origen está apagado.");
    if (plan.local) return [plan.sourceId];
    const route = networkRoute(
      this.lab,
      plan.sourceId,
      plan.targetId,
      plan.destinationIp,
    );
    if (plan.service && plan.service !== "ICMP") {
      const service = server.services.find((s) => s.protocol === plan.service);
      if (!service?.enabled)
        throw new Error(
          `${plan.service === "DNS" ? "DNS timeout: no responde el resolvedor." : "Conexión rechazada:"} servicio ${plan.service} apagado o no disponible en ${server.name}.`,
        );
      if (
        !Number.isInteger(service.port) ||
        service.port < 1 ||
        service.port > 65535
      )
        throw new Error("El puerto del servicio no es válido.");
    }
    if (plan.certificate && !server.certificateValid)
      throw new Error(
        "TLS: certificado rechazado. No se envió la solicitud ni las credenciales de aplicación.",
      );
    if (
      plan.auth &&
      ownValue(server.accounts, plan.auth.username) !== plan.auth.password
    ) {
      const codes: Partial<Record<AppProtocol, string>> = {
        SMTP: "535 5.7.8",
        IMAP: "A001 NO",
        POP3: "-ERR",
        FTP: "530",
        SFTP: "SSH_MSG_USERAUTH_FAILURE",
        SSH: "SSH_MSG_USERAUTH_FAILURE",
        TELNET: "Login incorrect",
      };
      throw new Error(
        `${codes[plan.service ?? "SSH"] ?? ""} Autenticación rechazada: usuario o contraseña incorrectos.`,
      );
    }
    if (plan.session) {
      const session = this.runtime.sessions[plan.clientId];
      if (
        !session ||
        session.targetId !== server.id ||
        session.protocol !== plan.session ||
        !Object.prototype.hasOwnProperty.call(server.accounts, session.username)
      )
        throw new Error(
          "La sesión no está autenticada o dejó de ser válida. Inicia sesión de nuevo.",
        );
    }
    return route;
  }

  private packet(
    task: Task,
    server: Device,
    protocol: Protocol,
    title: string,
    payload: string,
    options: PacketOptions = {},
  ): PlannedEvent {
    const app = options.service ?? task.action.protocol;
    const port = options.port ?? this.servicePort(server, app);
    const ephemeral = 49152 + (task.number % 1000);
    const addressKey = `${server.id}:${app}`;
    task.addresses ??= {};
    let addresses = task.addresses[addressKey];
    if (!addresses) {
      const client = this.device(task.action.sourceId);
      const configuredDns = app === "DNS" ? client.dns : undefined;
      const serverAddress =
        configuredDns &&
        server.interfaces.some((iface) => iface.ip === configuredDns)
          ? configuredDns
          : app === "DNS"
            ? server.interfaces[0]?.ip
            : (task.targetIp ?? server.interfaces[0]?.ip);
      let clientAddress = client.interfaces[0]?.ip ?? "";
      try {
        clientAddress =
          routeSourceAddress(
            this.lab,
            networkRoute(this.lab, client.id, server.id, serverAddress),
          ) ?? clientAddress;
      } catch {
        /* Validation below reports unavailable routes; these are only endpoint labels. */
      }
      addresses = { client: clientAddress, server: serverAddress ?? "" };
      task.addresses[addressKey] = addresses;
    }
    return {
      protocol,
      sourceId: options.response ? server.id : task.action.sourceId,
      targetId: options.response ? task.action.sourceId : server.id,
      sourcePort: protocol === "ICMP" ? 0 : options.response ? port : ephemeral,
      targetPort: protocol === "ICMP" ? 0 : options.response ? ephemeral : port,
      sourceAddress: options.response ? addresses.server : addresses.client,
      targetAddress: options.response ? addresses.client : addresses.server,
      title,
      payload,
      explanation:
        options.explanation ??
        "Intercambio simulado entre los extremos; los equipos intermedios transportan los datos.",
      encrypted: options.encrypted ?? false,
      status: options.status ?? "ok",
      layer:
        protocol === "ICMP"
          ? 3
          : protocol === "TCP"
            ? 4
            : protocol === "TLS"
              ? 6
              : 7,
      clientId: task.action.sourceId,
      serverId: server.id,
      service: app,
      auth: options.auth,
      certificate: options.certificate,
      session: options.session,
      apply: options.apply,
      finish: options.finish,
      destinationIp: options.response ? addresses.client : addresses.server,
    };
  }

  private local(
    task: Task,
    title: string,
    payload: string,
    finish?: Finish,
  ): PlannedEvent {
    return {
      protocol: "DNS",
      sourceId: task.action.sourceId,
      targetId: task.action.sourceId,
      sourcePort: 0,
      targetPort: 0,
      title,
      payload,
      explanation: "Operación local: no se genera tráfico en los enlaces.",
      encrypted: false,
      status: "info",
      layer: 7,
      clientId: task.action.sourceId,
      serverId: task.action.sourceId,
      local: true,
      finish,
    };
  }

  private *resolve(
    task: Task,
    name: string,
    final = false,
  ): Generator<PlannedEvent, string, unknown> {
    const source = this.device(task.action.sourceId);
    if (!source.online) throw new Error("El origen está apagado.");
    const normalized = name.trim().toLowerCase().replace(/\.$/, "");
    if (!normalized)
      throw new Error("Escribe un nombre o una dirección de destino.");
    const cached = ownValue(this.runtime.cache[source.id] ?? {}, normalized);
    if (cached && cached.expiresAt > this.time) {
      const ttl = Math.max(0, cached.expiresAt - this.time),
        data = { ip: cached.ip, ttl, cached: true };
      yield this.local(
        task,
        "DNS · respuesta desde caché",
        `${normalized} → ${cached.ip}\nTTL restante: ${ttl} s`,
        final
          ? {
              ok: true,
              title: "Nombre resuelto desde caché",
              output: `${normalized} → ${cached.ip} (caché, ${ttl} s)`,
              data,
            }
          : undefined,
      );
      return cached.ip;
    }
    const resolver = deviceByAddress(this.lab, source.dns);
    if (!resolver)
      throw new Error(
        "DNS timeout: la dirección del resolvedor configurado no corresponde a un equipo del laboratorio.",
      );
    yield this.packet(
      task,
      resolver,
      "DNS",
      "DNS · consulta A",
      `ID: ${task.number}\nQNAME: ${normalized}\nQTYPE: A\nRD: 1`,
      {
        service: "DNS",
        explanation:
          "El cliente pregunta al resolvedor DNS configurado. DNS utiliza aquí UDP/53; también admite TCP/53.",
      },
    );
    const records = this.device(resolver.id).records;
    const record =
      ownValue(records, normalized) ??
      Object.entries(records).find(
        ([key]) => key.toLowerCase().replace(/\.$/, "") === normalized,
      )?.[1];
    if (!record) {
      yield this.packet(
        task,
        resolver,
        "DNS",
        "DNS · NXDOMAIN",
        `ID: ${task.number}\nRCODE: 3 (NXDOMAIN)\nEl nombre ${normalized} no existe.`,
        {
          service: "DNS",
          response: true,
          status: "error",
          finish: {
            ok: false,
            title: "Nombre inexistente",
            output: `DNS NXDOMAIN: ${normalized} no existe. No se inició la conexión al servicio.`,
          },
        },
      );
      return "";
    }
    if (ipv4(record.ip) === undefined)
      throw new Error("DNS: el registro contiene una dirección IPv4 inválida.");
    const ttl = Math.max(0, Number.isFinite(record.ttl) ? record.ttl : 0),
      ip = record.ip;
    yield this.packet(
      task,
      resolver,
      "DNS",
      "DNS · respuesta A",
      `ID: ${task.number}\nRCODE: 0 (NOERROR)\n${normalized}  ${ttl}  IN  A  ${ip}`,
      {
        service: "DNS",
        response: true,
        explanation:
          "La respuesta se guarda en la caché del cliente hasta que venza su TTL.",
        apply: () => {
          this.runtime.cache[source.id] ??= {};
          this.runtime.cache[source.id][normalized] = {
            ip,
            expiresAt: this.time + ttl,
          };
        },
        finish: final
          ? {
              ok: true,
              title: "Nombre resuelto",
              output: `${normalized} → ${ip} · TTL ${ttl} s`,
              data: { ip, ttl, cached: false },
            }
          : undefined,
      },
    );
    return ip;
  }

  private *connect(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    yield this.packet(
      task,
      server,
      "TCP",
      "TCP · SYN",
      "SYN · solicitud de conexión",
      {
        explanation:
          "Transporte (capa 4): la aplicación necesita una conexión TCP antes de intercambiar mensajes.",
      },
    );
    yield this.packet(
      task,
      server,
      "TCP",
      "TCP · SYN, ACK",
      "SYN, ACK · el servidor acepta la conexión",
      { response: true },
    );
    yield this.packet(
      task,
      server,
      "TCP",
      "TCP · ACK",
      "ACK · conexión establecida",
    );
  }

  private *tls(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    yield this.packet(
      task,
      server,
      "TLS",
      "TLS 1.3 · ClientHello",
      "ClientHello\nsupported_versions: TLS 1.3\nkey_share: intercambio simulado",
      {
        explanation:
          "Se negocia un canal protegido. TLS se representa de forma conceptual; el simulador no realiza criptografía real.",
      },
    );
    yield this.packet(
      task,
      server,
      "TLS",
      "TLS 1.3 · ServerHello",
      "ServerHello\nTLS 1.3 · parámetros acordados",
      { response: true },
    );
    yield this.packet(
      task,
      server,
      "TLS",
      "TLS · certificado y servidor verificados",
      "EncryptedExtensions · Certificate · CertificateVerify · Finished\nEl cliente valida la identidad del servidor.",
      {
        response: true,
        encrypted: true,
        certificate: true,
        explanation:
          "En TLS 1.3 estos mensajes viajan cifrados después de ServerHello. El contenido se muestra desde el extremo receptor.",
      },
    );
    yield this.packet(
      task,
      server,
      "TLS",
      "TLS · canal protegido",
      "Finished · listo para datos de aplicación",
      { encrypted: true, certificate: true },
    );
  }

  private *workflow(task: Task): Generator<PlannedEvent, void, unknown> {
    const action = task.action;
    this.device(action.sourceId);
    if (action.protocol === "DNS") {
      yield* this.resolve(task, action.target, true);
      return;
    }
    let target = deviceByAddress(this.lab, action.target);
    if (!target) {
      if (ipv4(action.target) !== undefined)
        throw new Error(
          `No existe un equipo con la IP ${action.target} en este laboratorio.`,
        );
      const ip = yield* this.resolve(task, action.target);
      if (!ip) return;
      task.targetIp = ip;
      target = deviceByAddress(this.lab, ip);
      if (!target)
        throw new Error(
          `DNS resolvió ${ip}, pero esa IP no pertenece a un equipo del laboratorio.`,
        );
    } else
      task.targetIp =
        target.interfaces.find((i) => i.ip === action.target)?.ip ??
        target.interfaces[0]?.ip;
    task.targetId = target.id;
    if (action.protocol === "ICMP") {
      yield* this.ping(task, target);
      return;
    }
    if (action.protocol === "SNMP") {
      yield* this.snmp(task, target);
      return;
    }
    if (["SSH", "TELNET", "FTP", "SFTP"].includes(action.protocol)) {
      yield* this.sessionProtocol(task, target);
      return;
    }
    yield* this.connect(task, target);
    if (
      action.protocol === "HTTPS" ||
      action.protocol === "IMAP" ||
      action.protocol === "POP3"
    )
      yield* this.tls(task, target);
    if (action.protocol === "HTTP" || action.protocol === "HTTPS") {
      yield* this.http(task, target);
      return;
    }
    if (action.protocol === "SMTP") {
      yield* this.smtp(task, target);
      return;
    }
    if (action.protocol === "IMAP" || action.protocol === "POP3") {
      yield* this.mail(task, target);
      return;
    }
    throw new Error("Protocolo no implementado.");
  }

  private *http(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    const action = task.action,
      protocol = action.protocol,
      encrypted = protocol === "HTTPS";
    const method = (action.method ?? "GET").toUpperCase(),
      path = action.path ?? "/",
      body = action.body ?? "";
    const request = `${method} ${path} HTTP/1.1\r\nHost: ${action.target}\r\n${method === "POST" ? `Content-Type: application/json\r\nContent-Length: ${byteLength(body)}\r\n` : ""}\r\n${method === "POST" ? body : ""}`;
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · ${method} ${path}`,
      request,
      {
        encrypted,
        certificate: encrypted,
        explanation:
          "Método, ruta, cabeceras y cuerpo forman el mensaje de aplicación. El servidor interpreta este contenido.",
      },
    );
    const resources = this.state(server.id).resources ?? {};
    let status = 200,
      responseBody = "",
      apply: (() => void) | undefined;
    if (method === "POST" && path === "/api/mensajes") {
      status = 201;
      let content: unknown = body;
      try {
        content = JSON.parse(body);
      } catch {
        /* text bodies are accepted in this demo */
      }
      responseBody = readableJson({
        id: task.id,
        mensaje: content,
        estado: "creado",
      });
      apply = () => {
        this.state(server.id).resources ??= {};
        this.state(server.id).resources![path] = responseBody;
        this.state(server.id).resources![`${path}/${task.id}`] = responseBody;
      };
    } else if (method !== "GET") {
      status = 405;
      responseBody = "Método no permitido en este recurso.";
    } else if (Object.prototype.hasOwnProperty.call(resources, path))
      responseBody = resources[path];
    else {
      status = 404;
      responseBody = "Recurso no encontrado.";
    }
    const reason: Record<number, string> = {
      200: "OK",
      201: "Created",
      404: "Not Found",
      405: "Method Not Allowed",
    };
    const headers = {
      "Content-Type": path.startsWith("/api/")
        ? "application/json; charset=utf-8"
        : "text/html; charset=utf-8",
      "Content-Length": String(byteLength(responseBody)),
    };
    const payload = `HTTP/1.1 ${status} ${reason[status]}\r\n${Object.entries(
      headers,
    )
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n")}\r\n\r\n${responseBody}`;
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · ${status} ${reason[status]}`,
      payload,
      {
        response: true,
        encrypted,
        certificate: encrypted,
        status: status >= 400 ? "error" : "ok",
        apply,
        finish: {
          ok: status < 400,
          title: `${status} ${reason[status]}`,
          output: payload,
          data: { status, headers, body: responseBody },
        },
        explanation:
          "Una respuesta HTTP 404 demuestra que el servicio respondió; es diferente de una red desconectada.",
      },
    );
  }

  private credentials(task: Task): { username: string; password: string } {
    return {
      username: task.action.username ?? "",
      password: task.action.password ?? "",
    };
  }

  private *smtp(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    const a = task.action,
      auth = this.credentials(task);
    const encryptedPort = this.servicePort(server, "SMTP") === 465;
    if (encryptedPort) yield* this.tls(task, server);
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · servicio listo",
      "220 correo.aula.test ESMTP listo",
      { response: true, encrypted: encryptedPort },
    );
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · EHLO",
      `EHLO ${this.device(a.sourceId).name}`,
      { encrypted: encryptedPort },
    );
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · capacidades",
      `250-correo.aula.test\n${encryptedPort ? "" : "250-STARTTLS\n"}250 AUTH PLAIN`,
      { response: true, encrypted: encryptedPort },
    );
    if (!encryptedPort) {
      yield this.packet(task, server, "SMTP", "SMTP · STARTTLS", "STARTTLS");
      yield this.packet(
        task,
        server,
        "SMTP",
        "SMTP · iniciar TLS",
        "220 Preparado para iniciar TLS",
        { response: true },
      );
      yield* this.tls(task, server);
      yield this.packet(
        task,
        server,
        "SMTP",
        "SMTP · EHLO tras TLS",
        "EHLO cliente.aula.test",
        { encrypted: true },
      );
      yield this.packet(
        task,
        server,
        "SMTP",
        "SMTP · capacidades protegidas",
        "250 AUTH PLAIN",
        { response: true, encrypted: true },
      );
    }
    const plain = Array.from(
      new TextEncoder().encode(`\0${auth.username}\0${auth.password}`),
      (byte) => String.fromCharCode(byte),
    ).join("");
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · autenticación",
      `AUTH PLAIN ${btoa(plain)}`,
      {
        encrypted: true,
        certificate: true,
        explanation:
          "AUTH PLAIN codifica la credencial en Base64 (no la cifra); se transmite dentro del canal TLS previamente establecido.",
      },
    );
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · usuario autenticado",
      "235 2.7.0 Autenticación correcta",
      { response: true, encrypted: true, auth, certificate: true },
    );
    const from = a.from ?? mailboxFor(auth.username),
      to = a.to ?? mailboxFor(auth.username);
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · remitente",
      `MAIL FROM:<${from}>`,
      { encrypted: true },
    );
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · remitente aceptado",
      "250 2.1.0 Remitente aceptado",
      { response: true, encrypted: true },
    );
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · destinatario",
      `RCPT TO:<${to}>`,
      { encrypted: true },
    );
    if (
      !Object.prototype.hasOwnProperty.call(this.state(server.id).mailboxes, to)
    ) {
      yield this.packet(
        task,
        server,
        "SMTP",
        "SMTP · destinatario inexistente",
        "550 5.1.1 No existe ese buzón",
        {
          response: true,
          encrypted: true,
          status: "error",
          finish: {
            ok: false,
            title: "Destinatario rechazado",
            output: `550: no existe el buzón ${to}; el mensaje no se entregó.`,
          },
        },
      );
      return;
    }
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · destinatario aceptado",
      "250 2.1.5 Destinatario aceptado",
      { response: true, encrypted: true },
    );
    yield this.packet(task, server, "SMTP", "SMTP · DATA", "DATA", {
      encrypted: true,
    });
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · enviar contenido",
      "354 Terminar con <CRLF>.<CRLF>",
      { response: true, encrypted: true },
    );
    const message: MailMessage = {
      id: `mail-${task.number}`,
      from,
      to,
      subject: a.subject ?? "Mensaje del laboratorio",
      body: a.body ?? "",
      read: false,
    };
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · mensaje",
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${message.subject}\r\n\r\n${message.body.replace(/(^|\n)\./g, "$1..")}\r\n.`,
      { encrypted: true },
    );
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · mensaje aceptado",
      "250 2.0.0 Mensaje aceptado para entrega local",
      {
        response: true,
        encrypted: true,
        auth,
        apply: () => {
          this.state(server.id).mailboxes[to].push(copy(message));
        },
        explanation:
          "El servidor asumió responsabilidad por el mensaje. Este escenario entrega al buzón local; la aceptación no significa que el destinatario lo haya leído.",
      },
    );
    yield this.packet(task, server, "SMTP", "SMTP · QUIT", "QUIT", {
      encrypted: true,
    });
    yield this.packet(
      task,
      server,
      "SMTP",
      "SMTP · sesión cerrada",
      "221 2.0.0 Adiós",
      {
        response: true,
        encrypted: true,
        finish: {
          ok: true,
          title: "Correo entregado al buzón",
          output: `250 Aceptado → ${to}\nAsunto: ${message.subject}\nEstado: no leído. SMTP no confirma la lectura.`,
          data: { message },
        },
      },
    );
  }

  private *mail(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    const a = task.action,
      protocol = a.protocol as "IMAP" | "POP3",
      auth = this.credentials(task),
      imap = protocol === "IMAP";
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · saludo`,
      imap ? "* OK IMAP4rev2 listo" : "+OK POP3 listo",
      { response: true, encrypted: true },
    );
    if (imap)
      yield this.packet(
        task,
        server,
        protocol,
        "IMAP · LOGIN",
        `A001 LOGIN ${auth.username} ${auth.password}`,
        { encrypted: true },
      );
    else {
      yield this.packet(
        task,
        server,
        protocol,
        "POP3 · USER",
        `USER ${auth.username}`,
        { encrypted: true },
      );
      yield this.packet(
        task,
        server,
        protocol,
        "POP3 · usuario recibido",
        "+OK Indique contraseña",
        { response: true, encrypted: true },
      );
      yield this.packet(
        task,
        server,
        protocol,
        "POP3 · PASS",
        `PASS ${auth.password}`,
        { encrypted: true },
      );
    }
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · autenticación correcta`,
      imap
        ? "A001 OK LOGIN completado"
        : "+OK Buzón abierto; estado TRANSACTION",
      { response: true, encrypted: true, auth },
    );
    const address = mailboxFor(auth.username),
      mailbox = this.state(server.id).mailboxes[address];
    if (!mailbox) throw new Error(`No existe un buzón para ${address}.`);
    if (imap) {
      yield this.packet(
        task,
        server,
        protocol,
        "IMAP · SELECT",
        "A002 SELECT INBOX",
        { encrypted: true },
      );
      yield this.packet(
        task,
        server,
        protocol,
        "IMAP · buzón seleccionado",
        `* ${mailbox.length} EXISTS\nA002 OK [READ-WRITE] SELECT completado`,
        { response: true, encrypted: true },
      );
    }
    const method = (a.method ?? "list").toLowerCase();
    if (method === "list") {
      yield this.packet(
        task,
        server,
        protocol,
        `${protocol} · listar mensajes`,
        imap
          ? mailbox.length
            ? "A003 FETCH 1:* (FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT)])"
            : "A003 SEARCH ALL"
          : "LIST",
        { encrypted: true },
      );
      const messages = copy(this.state(server.id).mailboxes[address]);
      const payload = imap
        ? messages.length
          ? `${messages
              .map((m, i) => {
                const headers = `From: ${m.from}\r\nTo: ${m.to}\r\nSubject: ${m.subject}\r\n\r\n`;
                return `* ${i + 1} FETCH (FLAGS (${m.read ? "\\Seen" : ""}) BODY[HEADER.FIELDS (FROM TO SUBJECT)] {${byteLength(headers)}}\r\n${headers})`;
              })
              .join("\r\n")}\r\nA003 OK FETCH completado`
          : "* SEARCH\r\nA003 OK SEARCH completado"
        : `+OK ${messages.length} mensajes\r\n${messages.map((m, i) => `${i + 1} ${byteLength(messageText(m))}`).join("\r\n")}\r\n.`;
      yield this.packet(
        task,
        server,
        protocol,
        `${protocol} · contenido del buzón`,
        payload,
        {
          response: true,
          encrypted: true,
          finish: {
            ok: true,
            title: `${messages.length} mensajes`,
            output:
              messages
                .map(
                  (m, i) =>
                    `${i + 1}. ${m.subject} — ${m.from}${m.read ? " · leído" : " · no leído"}`,
                )
                .join("\n") || "Buzón vacío.",
            data: { messages },
          },
        },
      );
      return;
    }
    if (method !== "read") throw new Error(`${protocol}: usa list o read.`);
    const selected =
      mailbox.find((m) => m.id === a.filename) ??
      (!a.filename || /^\d+$/.test(a.filename)
        ? mailbox[Number(a.filename ?? 1) - 1]
        : undefined);
    if (!selected)
      throw new Error(`${protocol}: no existe el mensaje solicitado.`);
    const index = mailbox.findIndex((m) => m.id === selected.id) + 1;
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · leer mensaje`,
      imap ? `A003 FETCH ${index} BODY[]` : `RETR ${index}`,
      { encrypted: true },
    );
    const message = copy(selected);
    if (imap) message.read = true;
    const text = messageText(message);
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · mensaje recuperado`,
      imap
        ? `* ${index} FETCH (BODY[] {${byteLength(text)}}\n${text})\nA003 OK FETCH completado`
        : `+OK ${byteLength(text)} octetos\n${text}\n.`,
      {
        response: true,
        encrypted: true,
        apply: () => {
          if (imap) {
            const original = this.state(server.id).mailboxes[address].find(
              (m) => m.id === message.id,
            );
            if (original) original.read = true;
          }
        },
        finish: {
          ok: true,
          title: imap
            ? "Mensaje leído y sincronizado"
            : "Mensaje descargado; original conservado",
          output: `${text}\n\n${imap ? "IMAP: bandera de leído guardada en el servidor." : "POP3: RETR no elimina el mensaje ni sincroniza la bandera de leído."}`,
          data: { message },
        },
      },
    );
  }

  private *authenticateSession(
    task: Task,
    server: Device,
    protocol: Session["protocol"],
  ): Generator<PlannedEvent, Session, unknown> {
    const existing = this.runtime.sessions[task.action.sourceId];
    if (
      existing?.protocol === protocol &&
      existing.targetId === server.id &&
      (!task.action.username || task.action.username === existing.username) &&
      (task.action.password === undefined ||
        task.action.password === ownValue(server.accounts, existing.username))
    )
      return existing;
    const auth = this.credentials(task),
      secure = protocol === "SSH" || protocol === "SFTP";
    yield* this.connect(task, server);
    if (secure) {
      yield this.packet(
        task,
        server,
        "SSH",
        "SSH · intercambio de versión",
        "SSH-2.0-Capa7Lab",
        {
          service: protocol,
          explanation: "SFTP utiliza el transporte SSH; no es FTP con TLS.",
        },
      );
      yield this.packet(
        task,
        server,
        "SSH",
        "SSH · clave del servidor y negociación",
        "SSH_MSG_KEXINIT · intercambio de claves · clave del host verificada",
        { service: protocol, response: true },
      );
      yield this.packet(
        task,
        server,
        "SSH",
        "SSH · canal cifrado",
        "SSH_MSG_NEWKEYS",
        { service: protocol, encrypted: true },
      );
      yield this.packet(
        task,
        server,
        "SSH",
        "SSH · autenticación del usuario",
        `SSH_MSG_USERAUTH_REQUEST\nUsuario: ${auth.username}\nCredencial: ${auth.password}`,
        { service: protocol, encrypted: true },
      );
    } else if (protocol === "FTP") {
      yield this.packet(
        task,
        server,
        "FTP",
        "FTP · servicio listo",
        "220 Servicio FTP listo",
        { response: true },
      );
      yield this.packet(
        task,
        server,
        "FTP",
        "FTP · USER",
        `USER ${auth.username}`,
      );
      yield this.packet(
        task,
        server,
        "FTP",
        "FTP · solicitar contraseña",
        "331 Nombre de usuario aceptado; falta contraseña",
        { response: true },
      );
      yield this.packet(
        task,
        server,
        "FTP",
        "FTP · PASS",
        `PASS ${auth.password}`,
        {
          explanation:
            "FTP clásico transmite credenciales en texto claro. Solo se usan datos ficticios de laboratorio.",
        },
      );
    } else {
      yield this.packet(
        task,
        server,
        "TELNET",
        "Telnet · terminal virtual",
        "IAC DO ECHO · terminal virtual de red",
        { response: true },
      );
      yield this.packet(
        task,
        server,
        "TELNET",
        "Telnet · inicio de sesión",
        `login: ${auth.username}\npassword: ${auth.password}`,
        {
          explanation:
            "Este perfil de Telnet clásico transmite los datos sin cifrado.",
        },
      );
    }
    const session: Session = {
      protocol,
      sourceId: task.action.sourceId,
      targetId: server.id,
      username: auth.username,
    };
    yield this.packet(
      task,
      server,
      secure ? "SSH" : protocol,
      `${protocol} · sesión autenticada`,
      secure
        ? "SSH_MSG_USERAUTH_SUCCESS"
        : protocol === "FTP"
          ? "230 Usuario conectado"
          : "Login correcto",
      {
        service: protocol,
        response: true,
        encrypted: secure,
        auth,
        apply: () => {
          this.runtime.sessions[task.action.sourceId] = copy(session);
        },
      },
    );
    if (protocol === "SFTP")
      yield this.packet(
        task,
        server,
        "SFTP",
        "SFTP · subsistema de archivos",
        "SSH channel: subsystem sftp\nSSH_FXP_INIT → SSH_FXP_VERSION",
        { encrypted: true, session: protocol },
      );
    return session;
  }

  private *sessionProtocol(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    const protocol = task.action.protocol as Session["protocol"];
    const command = (task.action.command ?? "hostname").trim();
    const method = (task.action.method ?? "open").toLowerCase();
    if (method === "exit" || command === "exit") {
      const current = this.runtime.sessions[task.action.sourceId];
      if (
        !current ||
        current.targetId !== server.id ||
        current.protocol !== protocol
      )
        throw new Error(
          `No existe una sesión ${protocol} activa con este servidor.`,
        );
      yield this.packet(
        task,
        server,
        protocol,
        `${protocol} · cerrar sesión`,
        protocol === "FTP" ? "QUIT" : "Cerrar canal de sesión",
        {
          encrypted: protocol === "SFTP" || protocol === "SSH",
          session: protocol,
        },
      );
      yield this.packet(
        task,
        server,
        protocol,
        `${protocol} · sesión cerrada`,
        protocol === "FTP" ? "221 Adiós" : "Canal cerrado",
        {
          response: true,
          encrypted: protocol === "SFTP" || protocol === "SSH",
          session: protocol,
          apply: () => {
            delete this.runtime.sessions[task.action.sourceId];
          },
          finish: {
            ok: true,
            title: "Sesión cerrada",
            output: `Conexión ${protocol} cerrada.`,
          },
        },
      );
      return;
    }
    const session = yield* this.authenticateSession(task, server, protocol);
    if (protocol === "FTP" || protocol === "SFTP") {
      yield* this.files(task, server, protocol, method);
      return;
    }
    const encrypted = protocol === "SSH";
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · ejecutar comando`,
      command,
      {
        encrypted,
        session: protocol,
        explanation:
          "La consola interpreta un conjunto limitado de comandos dentro del servidor ficticio. No ejecuta un shell real.",
      },
    );
    let output = "",
      ok = true;
    if (command === "hostname") output = server.name;
    else if (command === "whoami") output = session.username;
    else if (command === "ls")
      output = Object.keys(this.state(server.id).files).join("\n");
    else if (command.startsWith("cat ")) {
      const filename = resourceName(command.slice(4).trim());
      if (
        Object.prototype.hasOwnProperty.call(
          this.state(server.id).files,
          filename,
        )
      )
        output = this.state(server.id).files[filename];
      else {
        ok = false;
        output = `cat: ${filename}: archivo inexistente`;
      }
    } else {
      ok = false;
      output =
        "Comando no admitido. Usa hostname, whoami, ls, cat ARCHIVO o exit.";
    }
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · salida de terminal`,
      output,
      {
        response: true,
        encrypted,
        session: protocol,
        status: ok ? "ok" : "error",
        finish: {
          ok,
          title: ok ? "Comando completado" : "Comando rechazado",
          output,
          data: { output },
        },
      },
    );
  }

  private *files(
    task: Task,
    server: Device,
    protocol: "FTP" | "SFTP",
    method: string,
  ): Generator<PlannedEvent, void, unknown> {
    const a = task.action,
      encrypted = protocol === "SFTP";
    if (method === "open") {
      yield this.packet(
        task,
        server,
        protocol,
        `${protocol} · listo para transferir`,
        protocol === "FTP" ? 'PWD → 257 "/"' : "SSH_FXP_REALPATH → /",
        {
          response: true,
          encrypted,
          session: protocol,
          finish: {
            ok: true,
            title: "Sesión de archivos abierta",
            output: `Conectado mediante ${protocol}. Comandos: ls, get ARCHIVO, put ARCHIVO, exit.`,
            data: { files: Object.keys(this.state(server.id).files) },
          },
        },
      );
      return;
    }
    if (!["list", "get", "put"].includes(method))
      throw new Error(`${protocol}: usa open, list, get, put o exit.`);
    const filename = resourceName(a.filename ?? "bienvenida.txt");
    if (!filename || filename.includes("..") || filename.includes("\\"))
      throw new Error("Usa un nombre de archivo del directorio simulado.");
    const localFiles = this.state(a.sourceId).files,
      remoteFiles = this.state(server.id).files;
    const content =
      method === "put"
        ? (a.content ?? ownValue(localFiles, filename))
        : ownValue(remoteFiles, filename);
    if (method !== "list" && content === undefined) {
      yield this.packet(
        task,
        server,
        protocol,
        `${protocol} · archivo inexistente`,
        protocol === "FTP"
          ? `550 Archivo no disponible: ${filename}`
          : `SSH_FX_NO_SUCH_FILE: ${filename}`,
        {
          response: true,
          encrypted,
          session: protocol,
          status: "error",
          finish: {
            ok: false,
            title: "Archivo inexistente",
            output: `${method === "put" ? "El cliente" : "El servidor"} no tiene el archivo ${filename}.`,
          },
        },
      );
      return;
    }
    const list = Object.keys(remoteFiles);
    const transferred =
      method === "list"
        ? list
            .map((name) => `${byteLength(remoteFiles[name])} ${name}`)
            .join("\n")
        : content!;
    const dataPort = 50000 + (task.number % 1000);
    if (protocol === "FTP") {
      yield this.packet(task, server, "FTP", "FTP · modo pasivo", "PASV", {
        session: protocol,
      });
      const ip = server.interfaces[0].ip.split(".").join(",");
      yield this.packet(
        task,
        server,
        "FTP",
        "FTP · puerto de datos",
        `227 Entering Passive Mode (${ip},${Math.floor(dataPort / 256)},${dataPort % 256})`,
        {
          response: true,
          session: protocol,
          explanation: `El canal de control permanece en TCP/21. El servidor anuncia un segundo puerto (${dataPort}) para los datos.`,
        },
      );
      yield this.packet(
        task,
        server,
        "TCP",
        "FTP · segunda conexión TCP",
        `SYN → SYN/ACK → ACK · conexión de datos ${dataPort} (resumida)`,
        {
          port: dataPort,
          session: protocol,
          explanation:
            "El cliente abre otra conexión TCP al puerto de datos anunciado; en modo pasivo ese puerto no es siempre 20.",
        },
      );
      yield this.packet(
        task,
        server,
        "FTP",
        `FTP · ${method === "get" ? "RETR" : method === "put" ? "STOR" : "LIST"}`,
        method === "list"
          ? "LIST"
          : `${method === "get" ? "RETR" : "STOR"} ${filename}`,
        { session: protocol },
      );
      yield this.packet(
        task,
        server,
        "FTP",
        "FTP · comienza transferencia",
        "150 Canal de datos preparado",
        { response: true, session: protocol },
      );
    } else
      yield this.packet(
        task,
        server,
        "SFTP",
        `SFTP · ${method === "list" ? "listar" : method === "get" ? "leer" : "escribir"}`,
        method === "list"
          ? "SSH_FXP_OPENDIR · SSH_FXP_READDIR"
          : `SSH_FXP_OPEN ${filename}\n${method === "get" ? "SSH_FXP_READ" : "SSH_FXP_WRITE"}`,
        {
          encrypted: true,
          session: protocol,
          explanation:
            "SFTP usa mensajes propios dentro de SSH, sin conexión FTP de control ni segundo canal TCP de datos.",
        },
      );
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · datos ${method === "list" ? "del directorio" : filename}`,
      transferred,
      {
        response: method !== "put",
        encrypted,
        port: protocol === "FTP" ? dataPort : undefined,
        session: protocol,
        explanation: encrypted
          ? "Contenido dentro del canal SSH cifrado; visible en los extremos."
          : "Contenido transferido por el canal FTP de datos en texto claro.",
      },
    );
    yield this.packet(
      task,
      server,
      protocol,
      `${protocol} · transferencia completada`,
      protocol === "FTP"
        ? "226 Transferencia completada y conexión de datos cerrada"
        : "SSH_FXP_STATUS: SSH_FX_OK · archivo cerrado",
      {
        response: true,
        encrypted,
        session: protocol,
        apply: () => {
          if (method === "get")
            this.state(a.sourceId).files = {
              ...this.state(a.sourceId).files,
              [filename]: content!,
            };
          if (method === "put")
            this.state(server.id).files = {
              ...this.state(server.id).files,
              [filename]: content!,
            };
        },
        finish: {
          ok: true,
          title:
            method === "list"
              ? "Directorio remoto"
              : method === "get"
                ? "Archivo descargado"
                : "Archivo subido",
          output:
            method === "list"
              ? list.join("\n") || "Directorio vacío."
              : `${filename} · ${byteLength(content!)} bytes\n${method === "get" ? "Guardado en el cliente." : "Guardado en el servidor."}\n\n${content}`,
          data: method === "list" ? { files: list } : { filename, content },
        },
      },
    );
  }

  private *snmp(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    const oid = (task.action.oid ?? "1.3.6.1.2.1.1.5.0").replace(/^\./, "");
    yield this.packet(
      task,
      server,
      "SNMP",
      "SNMPv2c · GetRequest",
      `version: 2c\ncommunity: public (demostración)\nrequest-id: ${task.number}\nOID: ${oid}`,
      {
        explanation:
          "El administrador consulta al agente por UDP/161. SNMPv2c no cifra esta comunidad de ejemplo.",
      },
    );
    const aliases: Record<string, string> = {
      sysName: "1.3.6.1.2.1.1.5.0",
      "sysName.0": "1.3.6.1.2.1.1.5.0",
      sysUpTime: "1.3.6.1.2.1.1.3.0",
      "sysUpTime.0": "1.3.6.1.2.1.1.3.0",
      ifInUcastPkts: "1.3.6.1.2.1.2.2.1.11.1",
      "ifInUcastPkts.1": "1.3.6.1.2.1.2.2.1.11.1",
      ifInOctets: "1.3.6.1.2.1.2.2.1.10.1",
      "ifInOctets.1": "1.3.6.1.2.1.2.2.1.10.1",
    };
    const key = aliases[oid] ?? oid;
    let value: string | number,
      type = "";
    if (key === "1.3.6.1.2.1.1.5.0") {
      value = server.name;
      type = "OCTET STRING";
    } else if (key === "1.3.6.1.2.1.1.3.0") {
      value = this.time * 100;
      type = "TimeTicks (centésimas de segundo)";
    } else if (key === "1.3.6.1.2.1.2.2.1.11.1") {
      value = this.state(server.id).packets;
      type = "Counter32 (contador didáctico agregado)";
    } else if (key === "1.3.6.1.2.1.2.2.1.10.1") {
      value = this.state(server.id).bytes;
      type = "Counter32 (octetos didácticos agregados)";
    } else {
      yield this.packet(
        task,
        server,
        "SNMP",
        "SNMP · OID no disponible",
        `Response · request-id: ${task.number}\n${oid}: noSuchObject`,
        {
          response: true,
          status: "error",
          finish: {
            ok: false,
            title: "OID no disponible",
            output: `noSuchObject: ${oid}. Disponibles: sysName.0, sysUpTime.0 e ifInUcastPkts.1.`,
          },
        },
      );
      return;
    }
    yield this.packet(
      task,
      server,
      "SNMP",
      "SNMP · Response",
      `request-id: ${task.number}\nOID: ${key}\n${type}: ${value}`,
      {
        response: true,
        explanation:
          "La respuesta regresa al puerto de origen del administrador. UDP/162 se reserva para notificaciones, no para esta respuesta.",
        finish: {
          ok: true,
          title: "Objeto consultado",
          output: `${key}\n${type}: ${value}`,
          data: { oid: key, value },
        },
      },
    );
  }

  private *ping(
    task: Task,
    server: Device,
  ): Generator<PlannedEvent, void, unknown> {
    yield this.packet(
      task,
      server,
      "ICMP",
      "ICMP · Echo Request",
      `type: 8 · code: 0\nidentifier: ${task.number}\nsequence: 1`,
      {
        port: 0,
        explanation:
          "ICMP pertenece a la capa de red (3), no a la capa de aplicación. Comprueba conectividad IP.",
      },
    );
    yield this.packet(
      task,
      server,
      "ICMP",
      "ICMP · Echo Reply",
      `type: 0 · code: 0\nidentifier: ${task.number}\nsequence: 1`,
      {
        response: true,
        port: 0,
        finish: {
          ok: true,
          title: "Destino alcanzable por IP",
          output: `Respuesta de ${task.targetIp ?? server.interfaces[0]?.ip}: secuencia=1\nICMP (capa 3). Esto no confirma que HTTP u otro servicio estén disponibles.`,
          data: { reachable: true },
        },
      },
    );
  }
}
