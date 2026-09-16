import { describe, expect, it } from "vitest";
import { SimulationEngine } from "./engine";
import { createLab } from "./scenarios";
import type { AppProtocol, LabConfig, ProtocolAction } from "./types";

const action = (
  protocol: AppProtocol,
  changes: Partial<ProtocolAction> = {},
): ProtocolAction => ({
  protocol,
  sourceId: "pc1",
  target: protocol === "DNS" ? "web.aula.test" : "192.168.20.30",
  username: "alumno",
  password: "redes123",
  ...changes,
});
function execute(engine: SimulationEngine, request: ProtocolAction) {
  const traceId = engine.enqueue(request);
  engine.runAll();
  const result = engine
    .getSnapshot()
    .results.find((item) => item.traceId === traceId);
  expect(result, `La transacción ${traceId} debe finalizar`).toBeDefined();
  return result!;
}
function device(lab: LabConfig, id: string) {
  return lab.devices.find((item) => item.id === id)!;
}
const web = (
  protocol: "HTTP" | "HTTPS" = "HTTP",
  changes: Partial<ProtocolAction> = {},
) =>
  action(protocol, {
    target: "web.aula.test",
    method: "GET",
    path: "/",
    ...changes,
  });

describe("Red IPv4 y conectividad", () => {
  it("atraviesa las dos LAN y registra todos los saltos", () => {
    const engine = new SimulationEngine(createLab());
    const result = execute(engine, web());
    expect(result.ok).toBe(true);
    const request = engine
      .getSnapshot()
      .events.find(
        (event) => event.protocol === "HTTP" && event.sourceId === "pc1",
      );
    expect(request?.route).toEqual(["pc1", "sw1", "router", "sw2", "web"]);
  });
  it("permite comunicación en la misma LAN sin puerta de enlace", () => {
    const lab = createLab();
    device(lab, "pc1").gateway = "";
    expect(
      execute(
        new SimulationEngine(lab),
        action("ICMP", { target: "192.168.10.11" }),
      ).ok,
    ).toBe(true);
  });
  it("rechaza una puerta de enlace incorrecta, enlaces caídos y equipos apagados", () => {
    const badGateway = createLab();
    device(badGateway, "pc1").gateway = "192.168.10.254";
    const brokenLink = createLab();
    brokenLink.links.find((link) => link.source === "router")!.online = false;
    const offline = createLab();
    device(offline, "srv").online = false;
    for (const lab of [badGateway, brokenLink, offline]) {
      expect(execute(new SimulationEngine(lab), action("ICMP")).ok).toBe(false);
    }
  });
  it("detecta IP duplicadas en la topología", () => {
    const lab = createLab();
    device(lab, "pc2").interfaces[0].ip = "192.168.10.10";
    const result = execute(new SimulationEngine(lab), action("ICMP"));
    expect(result.ok).toBe(false);
    expect(`${result.title} ${result.output}`).toMatch(/duplic|conflic/i);
  });
  it("respeta el servidor DNS configurado en el cliente", () => {
    const lab = createLab();
    device(lab, "pc1").dns = "192.168.20.99";
    const engine = new SimulationEngine(lab);
    expect(execute(engine, web()).ok).toBe(false);
    expect(execute(engine, web("HTTP", { target: "192.168.20.20" })).ok).toBe(
      true,
    );
  });
  it("no inventa rutas si la interfaz de salida del router está en otra subred", () => {
    const lab = createLab();
    device(lab, "router").interfaces[1].ip = "192.168.30.1";
    expect(execute(new SimulationEngine(lab), action("ICMP")).ok).toBe(false);
  });
});

describe("DNS y caché con TTL", () => {
  it("resuelve, almacena caché y repite la consulta sin recorrer la red", () => {
    const engine = new SimulationEngine(createLab());
    expect(execute(engine, action("DNS")).ok).toBe(true);
    expect(engine.getSnapshot().runtime.cache.pc1["web.aula.test"].ip).toBe(
      "192.168.20.20",
    );
    const second = execute(engine, action("DNS"));
    expect(second.output).toMatch(/192\.168\.20\.20/);
    expect(
      engine
        .getSnapshot()
        .events.filter((event) => event.traceId === second.traceId)
        .some((event) => /cach/i.test(`${event.title} ${event.explanation}`)),
    ).toBe(true);
  });
  it("caduca la caché según el reloj simulado y vuelve a consultar al servidor", () => {
    const lab = createLab();
    device(lab, "dns").records["web.aula.test"].ttl = 2;
    const engine = new SimulationEngine(lab);
    execute(engine, action("DNS"));
    const expiry =
      engine.getSnapshot().runtime.cache.pc1["web.aula.test"].expiresAt;
    while (engine.getSnapshot().time <= expiry)
      execute(engine, action("ICMP", { target: "192.168.10.11" }));
    const result = execute(engine, action("DNS"));
    expect(result.ok).toBe(true);
    expect(
      engine
        .getSnapshot()
        .events.filter((event) => event.traceId === result.traceId)
        .some((event) => event.route.includes("dns")),
    ).toBe(true);
  });
  it("distingue NXDOMAIN de un servidor que no responde", () => {
    const engine = new SimulationEngine(createLab());
    const absent = execute(
      engine,
      action("DNS", { target: "no-existe.aula.test" }),
    );
    expect(absent.ok).toBe(false);
    expect(absent.output).toMatch(/NXDOMAIN/i);
    engine.fault({
      kind: "service",
      targetId: "dns",
      protocol: "DNS",
      active: true,
    });
    const unavailable = execute(
      engine,
      action("DNS", { target: "sin-cache.aula.test" }),
    );
    expect(unavailable.ok).toBe(false);
    expect(`${unavailable.title} ${unavailable.output}`).toMatch(
      /timeout|tiempo|no responde/i,
    );
    expect(unavailable.output).not.toMatch(/NXDOMAIN/i);
  });
});

describe("HTTP y HTTPS", () => {
  it("entrega un recurso y devuelve 404 para una ruta inexistente", () => {
    const engine = new SimulationEngine(createLab());
    const success = execute(engine, web());
    expect(success.ok).toBe(true);
    expect(success.output).toMatch(/200/);
    expect(success.output).toMatch(/capa 7/i);
    const missing = execute(engine, web("HTTP", { path: "/no-existe" }));
    expect(missing.output).toMatch(/404/);
  });
  it("POST mantiene el recurso para una solicitud posterior", () => {
    const engine = new SimulationEngine(createLab());
    const body = '{"mensaje":"Hola desde el cliente"}';
    expect(
      execute(
        engine,
        web("HTTP", { method: "POST", path: "/api/mensajes", body }),
      ).ok,
    ).toBe(true);
    expect(
      execute(engine, web("HTTP", { path: "/api/mensajes" })).output,
    ).toContain("Hola desde el cliente");
  });
  it("HTTPS crea eventos TLS y protege datos; HTTP permite observar el contenido", () => {
    const engine = new SimulationEngine(createLab());
    const plain = execute(engine, web());
    const secure = execute(engine, web("HTTPS"));
    expect(secure.ok).toBe(true);
    const events = engine.getSnapshot().events;
    expect(
      events.some(
        (event) => event.traceId === secure.traceId && event.protocol === "TLS",
      ),
    ).toBe(true);
    expect(
      events
        .filter(
          (event) =>
            event.traceId === secure.traceId &&
            event.protocol === "HTTPS" &&
            event.route.length > 1,
        )
        .every((event) => event.encrypted),
    ).toBe(true);
    expect(
      events
        .filter(
          (event) =>
            event.traceId === plain.traceId && event.protocol === "HTTP",
        )
        .every((event) => !event.encrypted),
    ).toBe(true);
  });
  it("detiene HTTPS ante un certificado rechazado y permite reparar el fallo", () => {
    const engine = new SimulationEngine(createLab());
    engine.fault({ kind: "certificate", targetId: "web", active: true });
    const rejected = execute(engine, web("HTTPS"));
    expect(rejected.ok).toBe(false);
    expect(`${rejected.title} ${rejected.output}`).toMatch(/certific/i);
    expect(execute(engine, web()).ok).toBe(true);
    engine.fault({ kind: "certificate", targetId: "web", active: false });
    expect(execute(engine, web("HTTPS")).ok).toBe(true);
  });
  it("un servicio apagado falla aunque el destino responda a ping", () => {
    const engine = new SimulationEngine(createLab());
    engine.fault({
      kind: "service",
      targetId: "web",
      protocol: "HTTP",
      active: true,
    });
    expect(
      execute(engine, action("ICMP", { target: "192.168.20.20" })).ok,
    ).toBe(true);
    expect(execute(engine, web()).ok).toBe(false);
    engine.fault({
      kind: "service",
      targetId: "web",
      protocol: "HTTP",
      active: false,
    });
    expect(execute(engine, web()).ok).toBe(true);
  });
});

describe("Correo con estado compartido", () => {
  it("entrega SMTP solo al finalizar y permite consultar el mismo buzón", () => {
    const engine = new SimulationEngine(createLab());
    const initialCount =
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"]
        .length;
    engine.enqueue(
      action("SMTP", {
        from: "docente@aula.test",
        to: "alumno@aula.test",
        subject: "Prueba",
        body: "Contenido real de la demostración",
      }),
    );
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"],
    ).toHaveLength(initialCount);
    engine.step();
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"],
    ).toHaveLength(initialCount);
    engine.runAll();
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"],
    ).toHaveLength(initialCount + 1);
    const list = execute(
      engine,
      action("IMAP", { method: "list", to: "alumno@aula.test" }),
    );
    expect(list.output).toMatch(/Prueba/);
  });
  it("IMAP marca leído; POP3 recupera sin borrar ni marcar leído", () => {
    const engine = new SimulationEngine(createLab());
    const mailbox = () =>
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"];
    expect(
      execute(
        engine,
        action("POP3", {
          method: "read",
          filename: "welcome",
          to: "alumno@aula.test",
        }),
      ).ok,
    ).toBe(true);
    expect(mailbox()).toHaveLength(1);
    expect(mailbox()[0].read).toBe(false);
    expect(
      execute(
        engine,
        action("IMAP", {
          method: "read",
          filename: "welcome",
          to: "alumno@aula.test",
        }),
      ).ok,
    ).toBe(true);
    expect(mailbox()[0].read).toBe(true);
  });
  it("credenciales inválidas no entregan mensajes ni abren buzones", () => {
    const engine = new SimulationEngine(createLab());
    for (const protocol of ["SMTP", "IMAP", "POP3"] as const) {
      expect(
        execute(
          engine,
          action(protocol, {
            password: "incorrecta",
            from: "docente@aula.test",
            to: "alumno@aula.test",
            subject: "Nunca entregado",
            body: "Prueba",
          }),
        ).ok,
      ).toBe(false);
    }
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"],
    ).toHaveLength(1);
  });
});

describe("Archivos y acceso remoto", () => {
  it.each(["FTP", "SFTP"] as const)(
    "%s descarga y sube contenido real, solo al finalizar",
    (protocol) => {
      const engine = new SimulationEngine(createLab());
      engine.enqueue(
        action(protocol, { method: "get", filename: "bienvenida.txt" }),
      );
      expect(
        engine.getSnapshot().runtime.devices.pc1.files["bienvenida.txt"],
      ).toBeUndefined();
      engine.step();
      expect(
        engine.getSnapshot().runtime.devices.pc1.files["bienvenida.txt"],
      ).toBeUndefined();
      engine.runAll();
      expect(
        engine.getSnapshot().runtime.devices.pc1.files["bienvenida.txt"],
      ).toBe(engine.getSnapshot().runtime.devices.srv.files["bienvenida.txt"]);
      const original =
        engine.getSnapshot().runtime.devices.pc1.files["notas.txt"];
      expect(
        execute(
          engine,
          action(protocol, {
            method: "put",
            filename: "notas.txt",
            content: original,
          }),
        ).ok,
      ).toBe(true);
      expect(engine.getSnapshot().runtime.devices.srv.files["notas.txt"]).toBe(
        original,
      );
      expect(
        execute(
          engine,
          action(protocol, { method: "get", filename: "ausente.txt" }),
        ).ok,
      ).toBe(false);
    },
  );
  it("FTP separa control y datos; SFTP utiliza el canal SSH", () => {
    const engine = new SimulationEngine(createLab());
    const ftp = execute(
      engine,
      action("FTP", { method: "get", filename: "redes.txt" }),
    );
    const ftpEvents = engine
      .getSnapshot()
      .events.filter((event) => event.traceId === ftp.traceId);
    expect(
      ftpEvents.some(
        (event) => event.targetPort === 21 || event.sourcePort === 21,
      ),
    ).toBe(true);
    const data = ftpEvents.find(
      (event) =>
        event.protocol === "FTP" &&
        event.payload ===
          engine.getSnapshot().runtime.devices.srv.files["redes.txt"],
    );
    expect(data).toBeDefined();
    expect(data?.targetPort).not.toBe(21);
    expect(data?.sourcePort).not.toBe(21);
    expect(data?.encrypted).toBe(false);
    const sftp = execute(
      engine,
      action("SFTP", { method: "get", filename: "redes.txt" }),
    );
    const secureEvents = engine
      .getSnapshot()
      .events.filter(
        (event) => event.traceId === sftp.traceId && event.protocol === "SFTP",
      );
    expect(secureEvents.length).toBeGreaterThan(0);
    expect(
      secureEvents.every(
        (event) =>
          event.encrypted &&
          (event.targetPort === 22 || event.sourcePort === 22),
      ),
    ).toBe(true);
  });
  it.each(["SSH", "TELNET"] as const)(
    "%s autentica, ejecuta y finaliza una sesión",
    (protocol) => {
      const engine = new SimulationEngine(createLab());
      expect(
        execute(
          engine,
          action(protocol, { password: "mal", command: "hostname" }),
        ).ok,
      ).toBe(false);
      expect(engine.getSnapshot().runtime.sessions.pc1).toBeUndefined();
      expect(
        execute(engine, action(protocol, { command: "hostname" })).output,
      ).toMatch(/Servidor de Aplicaciones/);
      expect(engine.getSnapshot().runtime.sessions.pc1.targetId).toBe("srv");
      expect(
        execute(engine, action(protocol, { command: "whoami" })).output,
      ).toMatch(/alumno/);
      expect(
        execute(engine, action(protocol, { command: "ls" })).output,
      ).toMatch(/redes\.txt/);
      expect(
        execute(engine, action(protocol, { command: "cat redes.txt" })).output,
      ).toContain("DNS resuelve nombres.");
      expect(execute(engine, action(protocol, { command: "exit" })).ok).toBe(
        true,
      );
      expect(engine.getSnapshot().runtime.sessions.pc1).toBeUndefined();
    },
  );
  it.each(["SSH", "FTP"] as const)(
    "%s no reutiliza una sesión para aceptar una contraseña explícita incorrecta",
    (protocol) => {
      const engine = new SimulationEngine(createLab());
      expect(
        execute(
          engine,
          action(protocol, { command: "hostname", method: "open" }),
        ).ok,
      ).toBe(true);
      expect(engine.getSnapshot().runtime.sessions.pc1).toBeDefined();
      expect(
        execute(
          engine,
          action(protocol, {
            password: "incorrecta",
            command: "hostname",
            method: "open",
          }),
        ).ok,
      ).toBe(false);
      expect(engine.getSnapshot().runtime.sessions.pc1).toBeUndefined();
    },
  );
});

describe("SNMP y reloj determinista", () => {
  it("consulta nombre, tiempo activo, contadores que cambian y OID inexistente", () => {
    const engine = new SimulationEngine(createLab());
    const query = (oid: string) =>
      execute(engine, action("SNMP", { target: "192.168.10.1", oid }));
    expect(query("1.3.6.1.2.1.1.5.0").output).toMatch(/Router/);
    expect(query("1.3.6.1.2.1.1.3.0").ok).toBe(true);
    const before = query("1.3.6.1.2.1.2.2.1.11.1");
    execute(engine, action("ICMP"));
    const after = query("1.3.6.1.2.1.2.2.1.11.1");
    expect(before.ok).toBe(true);
    expect(after.output).not.toBe(before.output);
    expect(query("1.3.6.1.99.999").output).toMatch(/noSuchObject/i);
  });
  it("paso a paso y reproducción completa producen el mismo estado y eventos", () => {
    const a = new SimulationEngine(createLab());
    const b = new SimulationEngine(createLab());
    const requests = [
      web(),
      action("FTP", { method: "get", filename: "redes.txt" }),
      action("DNS"),
    ];
    requests.forEach((request) => {
      a.enqueue(request);
      b.enqueue(request);
    });
    a.runAll();
    let guard = 0;
    while (b.getSnapshot().pending && guard++ < 300) b.step();
    expect(guard).toBeLessThan(300);
    expect(b.getSnapshot().events).toEqual(a.getSnapshot().events);
    expect(b.getSnapshot().runtime).toEqual(a.getSnapshot().runtime);
    expect(b.getSnapshot().results).toEqual(a.getSnapshot().results);
  });
  it("no avanza el reloj ni modifica el estado sin step o runAll", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue(web());
    const snapshot = JSON.stringify(engine.getSnapshot());
    expect(JSON.stringify(engine.getSnapshot())).toBe(snapshot);
    expect(engine.getSnapshot().time).toBe(0);
    expect(engine.getSnapshot().results).toHaveLength(0);
  });
  it("mover un equipo conserva la cola; cambiar configuración la cancela", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue(web());
    const moved = structuredClone(engine.getSnapshot().lab);
    device(moved, "pc1").position.x += 50;
    engine.editLab(moved, false);
    expect(engine.getSnapshot().pending).toBeGreaterThan(0);
    const changed = structuredClone(engine.getSnapshot().lab);
    device(changed, "pc1").gateway = "192.168.10.254";
    engine.editLab(changed, true);
    expect(engine.getSnapshot().pending).toBe(0);
    expect(engine.getSnapshot().results.at(-1)?.ok).toBe(false);
  });
  it("un fallo durante una transferencia impide completarla sin copiar archivos", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue(
      action("SFTP", { method: "get", filename: "bienvenida.txt" }),
    );
    engine.step();
    engine.fault({ kind: "link", targetId: "link-3", active: true });
    engine.runAll();
    expect(engine.getSnapshot().pending).toBe(0);
    expect(engine.getSnapshot().results.at(-1)?.ok).toBe(false);
    expect(
      engine.getSnapshot().runtime.devices.pc1.files["bienvenida.txt"],
    ).toBeUndefined();
  });
  it("restaura el escenario completo y exporta estado transferible", () => {
    const initial = createLab();
    const engine = new SimulationEngine(initial);
    execute(engine, action("SFTP", { method: "get", filename: "redes.txt" }));
    execute(engine, action("IMAP", { method: "read", filename: "welcome" }));
    const saved = engine.exportSnapshot();
    expect(saved.schemaVersion).toBe(1);
    const restored = new SimulationEngine(saved.lab, saved.runtime);
    expect(restored.getSnapshot().runtime.devices).toEqual(
      engine.getSnapshot().runtime.devices,
    );
    expect(restored.getSnapshot().runtime.sessions).toEqual(
      engine.getSnapshot().runtime.sessions,
    );
    engine.reset();
    expect(engine.getSnapshot().lab).toEqual(initial);
    expect(
      engine.getSnapshot().runtime.devices.pc1.files["redes.txt"],
    ).toBeUndefined();
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"][0]
        .read,
    ).toBe(false);
    expect(engine.getSnapshot().time).toBe(0);
    expect(engine.getSnapshot().events).toHaveLength(0);
  });
  it("la exportación conserva el TTL restante sin rejuvenecer la caché", () => {
    const engine = new SimulationEngine(createLab());
    execute(engine, action("DNS"));
    execute(engine, action("ICMP"));
    const before = engine.getSnapshot();
    const remaining =
      before.runtime.cache.pc1["web.aula.test"].expiresAt - before.time;
    const saved = engine.exportSnapshot();
    const restored = new SimulationEngine(saved.lab, saved.runtime);
    const after = restored.getSnapshot();
    expect(
      after.runtime.cache.pc1["web.aula.test"].expiresAt - after.time,
    ).toBe(remaining);
  });
});
