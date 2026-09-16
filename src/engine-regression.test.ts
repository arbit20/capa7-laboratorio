import { describe, expect, it } from "vitest";
import { SimulationEngine } from "./engine";
import { createLab } from "./scenarios";
import type { FaultAction, LabConfig, ProtocolAction } from "./types";

const find = (lab: LabConfig, id: string) =>
  lab.devices.find((device) => device.id === id)!;
const run = (engine: SimulationEngine, action: ProtocolAction) => {
  const id = engine.enqueue(action);
  engine.runAll();
  return engine.getSnapshot().results.find((result) => result.traceId === id)!;
};

describe("Direcciones de los extremos en el inspector", () => {
  it("SNMP conserva la IP de la segunda interfaz del router y la invierte en la respuesta", () => {
    const engine = new SimulationEngine(createLab());
    expect(
      run(engine, {
        protocol: "SNMP",
        sourceId: "srv",
        target: "192.168.20.1",
        oid: "sysName",
      }).ok,
    ).toBe(true);
    const [request, response] = engine.getSnapshot().events;
    expect([request.sourceAddress, request.targetAddress]).toEqual([
      "192.168.20.30",
      "192.168.20.1",
    ]);
    expect([response.sourceAddress, response.targetAddress]).toEqual([
      "192.168.20.1",
      "192.168.20.30",
    ]);
  });

  it("DNS usa el resolvedor configurado y HTTP usa el servidor resuelto desde la interfaz de salida", () => {
    const engine = new SimulationEngine(createLab());
    expect(
      run(engine, {
        protocol: "HTTP",
        sourceId: "router",
        target: "web.aula.test",
        path: "/",
      }).ok,
    ).toBe(true);
    const events = engine.getSnapshot().events;
    const query = events.find(
      (event) => event.protocol === "DNS" && event.sourceId === "router",
    )!;
    const dnsResponse = events.find(
      (event) => event.protocol === "DNS" && event.sourceId === "dns",
    )!;
    const request = events.find(
      (event) => event.protocol === "HTTP" && event.sourceId === "router",
    )!;
    const response = events.find(
      (event) => event.protocol === "HTTP" && event.sourceId === "web",
    )!;
    expect([query.sourceAddress, query.targetAddress]).toEqual([
      "192.168.20.1",
      "192.168.20.10",
    ]);
    expect([dnsResponse.sourceAddress, dnsResponse.targetAddress]).toEqual([
      "192.168.20.10",
      "192.168.20.1",
    ]);
    expect([request.sourceAddress, request.targetAddress]).toEqual([
      "192.168.20.1",
      "192.168.20.20",
    ]);
    expect([response.sourceAddress, response.targetAddress]).toEqual([
      "192.168.20.20",
      "192.168.20.1",
    ]);
  });
});
const web: ProtocolAction = {
  protocol: "HTTP",
  sourceId: "pc1",
  target: "192.168.20.20",
  method: "GET",
  path: "/",
};
const mail: ProtocolAction = {
  protocol: "SMTP",
  sourceId: "pc1",
  target: "192.168.20.30",
  username: "alumno",
  password: "redes123",
  from: "docente@aula.test",
  to: "alumno@aula.test",
  subject: "Persistencia",
  body: "Mensaje de prueba",
};

describe("Regresiones de encaminamiento y fallos durante un flujo", () => {
  it("alcanza la IP de otra interfaz del mismo router sin inventar un bucle", () => {
    const engine = new SimulationEngine(createLab());
    const result = run(engine, {
      protocol: "ICMP",
      sourceId: "pc1",
      target: "192.168.20.1",
    });
    expect(result.ok).toBe(true);
    const request = engine
      .getSnapshot()
      .events.find((event) => event.title.includes("Request"))!;
    expect(request.route).toEqual(["pc1", "sw1", "router"]);
    expect(new Set(request.route).size).toBe(request.route.length);
  });

  it("rechaza una conexión física asignada a una interfaz inexistente", () => {
    const lab = createLab();
    lab.links.find((link) => link.id === "link-3")!.sourceInterface = "eth9";
    const engine = new SimulationEngine(lab);
    expect(run(engine, web).ok).toBe(false);
    expect(
      engine.getSnapshot().events.some((event) => event.title.includes("200")),
    ).toBe(false);
  });

  it("conserva los pasos completados y detecta el servicio apagado en el siguiente paso", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue(web);
    engine.step();
    const completed = engine.getSnapshot().events;
    engine.fault({
      kind: "service",
      targetId: "web",
      protocol: "HTTP",
      active: true,
    });
    expect(engine.getSnapshot().pending).toBe(1);
    expect(engine.getSnapshot().results).toHaveLength(0);
    expect(engine.getSnapshot().events).toEqual(completed);
    expect(engine.step()?.status).toBe("error");
    expect(engine.getSnapshot().pending).toBe(0);
    expect(engine.getSnapshot().events[0]).toEqual(completed[0]);
    expect(engine.getSnapshot().results[0].ok).toBe(false);
  });

  it("repara un fallo antes del siguiente paso sin cancelar una operación sana", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue(web);
    engine.step();
    engine.fault({
      kind: "service",
      targetId: "web",
      protocol: "HTTP",
      active: true,
    });
    engine.fault({
      kind: "service",
      targetId: "web",
      protocol: "HTTP",
      active: false,
    });
    engine.runAll();
    expect(engine.getSnapshot().results.at(-1)?.ok).toBe(true);
  });

  it("restaura un fallo no ligado a protocolos después de cambiar de escenario y editar", () => {
    const engine = new SimulationEngine(createLab());
    engine.fault({
      kind: "link",
      targetId: "link-3",
      protocol: "HTTP",
      active: true,
    });
    const edited = structuredClone(engine.getSnapshot().lab);
    find(edited, "web").name = "Servidor renombrado";
    engine.editLab(edited);
    engine.fault({
      kind: "link",
      targetId: "link-3",
      protocol: "SMTP",
      active: false,
    });
    expect(
      engine.getSnapshot().lab.links.find((link) => link.id === "link-3")
        ?.online,
    ).toBe(true);
    expect(run(engine, web).ok).toBe(true);
  });

  it("el certificado rechazado evita la petición HTTP, mientras HTTP plano sigue disponible", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue({ ...web, protocol: "HTTPS" });
    engine.step();
    engine.fault({ kind: "certificate", targetId: "web", active: true });
    engine.runAll();
    expect(engine.getSnapshot().results.at(-1)?.ok).toBe(false);
    expect(
      engine.getSnapshot().events.some((event) => event.protocol === "HTTPS"),
    ).toBe(false);
    expect(run(engine, web).ok).toBe(true);
  });
});

describe("Regresiones DNS y configuración de datos", () => {
  it("busca nombres DNS sin distinguir mayúsculas en registros configurados", () => {
    const lab = createLab();
    find(lab, "dns").records = {
      "WEB.AULA.TEST.": { ip: "192.168.20.20", ttl: 60 },
    };
    expect(
      run(new SimulationEngine(lab), { ...web, target: "web.aula.test" }).ok,
    ).toBe(true);
  });

  it("el fallo DNS cambia la IP, vacía caché para la demostración y restaura la resolución", () => {
    const engine = new SimulationEngine(createLab());
    run(engine, { protocol: "DNS", sourceId: "pc1", target: "web.aula.test" });
    expect(Object.keys(engine.getSnapshot().runtime.cache.pc1)).toHaveLength(1);
    engine.fault({
      kind: "dns",
      targetId: "dns",
      protocol: "HTTP",
      active: true,
    });
    expect(Object.keys(engine.getSnapshot().runtime.cache.pc1)).toHaveLength(0);
    const response = run(engine, {
      protocol: "DNS",
      sourceId: "pc1",
      target: "web.aula.test",
    });
    expect(response.ok).toBe(true);
    expect(response.output).toContain("192.168.20.250");
    const failed = run(engine, { ...web, target: "web.aula.test" });
    expect(failed.ok).toBe(false);
    expect(failed.output).not.toContain("NXDOMAIN");
    expect(run(engine, web).ok).toBe(true);
    engine.fault({
      kind: "dns",
      targetId: "dns",
      protocol: "SMTP",
      active: false,
    });
    expect(run(engine, { ...web, target: "web.aula.test" }).ok).toBe(true);
  });

  it("editar un registro normalmente respeta una respuesta todavía en caché", () => {
    const engine = new SimulationEngine(createLab());
    run(engine, { protocol: "DNS", sourceId: "pc1", target: "web.aula.test" });
    const changed = structuredClone(engine.getSnapshot().lab);
    find(changed, "dns").records["web.aula.test"].ip = "192.168.20.250";
    engine.editLab(changed);
    const cached = run(engine, {
      protocol: "DNS",
      sourceId: "pc1",
      target: "web.aula.test",
    });
    expect(cached.ok).toBe(true);
    expect(cached.output).toContain("192.168.20.20");
    expect(cached.output).toContain("caché");
  });

  it("editar recursos HTTP modifica el siguiente GET y conserva recursos creados por POST", () => {
    const engine = new SimulationEngine(createLab());
    run(engine, {
      ...web,
      method: "POST",
      path: "/api/mensajes",
      body: "Guardado en tiempo de ejecución",
    });
    const changed = structuredClone(engine.getSnapshot().lab);
    find(changed, "web").resources["/"] = "<h1>Página editada</h1>";
    delete find(changed, "web").resources["/api/cursos"];
    engine.editLab(changed);
    expect(run(engine, web).output).toContain("Página editada");
    expect(run(engine, { ...web, path: "/api/cursos" }).output).toContain(
      "404",
    );
    expect(run(engine, { ...web, path: "/api/mensajes" }).output).toContain(
      "Guardado en tiempo de ejecución",
    );
  });

  it("reconcilia archivos y buzones editados sin perder entregas tras un cambio ajeno", () => {
    const engine = new SimulationEngine(createLab());
    run(engine, mail);
    let edited = structuredClone(engine.getSnapshot().lab);
    find(edited, "srv").name = "Otro nombre";
    engine.editLab(edited);
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"],
    ).toHaveLength(2);
    edited = structuredClone(engine.getSnapshot().lab);
    find(edited, "srv").files["redes.txt"] = "Texto actualizado";
    find(edited, "srv").mailboxes["compañero@aula.test"] = [
      {
        id: "edited",
        from: "docente@aula.test",
        to: "compañero@aula.test",
        subject: "Configurado",
        body: "Prueba",
        read: false,
      },
    ];
    engine.editLab(edited);
    expect(engine.getSnapshot().runtime.devices.srv.files["redes.txt"]).toBe(
      "Texto actualizado",
    );
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["compañero@aula.test"],
    ).toHaveLength(1);
    expect(
      engine.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"],
    ).toHaveLength(2);
  });

  it("un nombre heredado de Object no se convierte en un archivo ni corrompe el estado", () => {
    const engine = new SimulationEngine(createLab());
    const action: ProtocolAction = {
      protocol: "FTP",
      sourceId: "pc1",
      target: "192.168.20.30",
      username: "alumno",
      password: "redes123",
      method: "get",
    };
    for (const filename of ["toString", "constructor", "__proto__"])
      expect(run(engine, { ...action, filename }).ok).toBe(false);
    expect(run(engine, { ...action, filename: "redes.txt" }).ok).toBe(true);
    expect(() => engine.exportSnapshot()).not.toThrow();
    expect(
      run(engine, {
        ...action,
        method: "put",
        filename: "__proto__",
        content: "Archivo literal de prueba",
      }).ok,
    ).toBe(true);
    expect(run(engine, { ...action, filename: "__proto__" }).ok).toBe(true);
    expect(
      Object.getPrototypeOf(engine.getSnapshot().runtime.devices.pc1.files),
    ).toBe(Object.prototype);
    expect(engine.getSnapshot().runtime.devices.pc1.files.__proto__).toBe(
      "Archivo literal de prueba",
    );
  });
});

describe("Regresiones de importar y reiniciar", () => {
  it("no repite identificadores de mensajes ni de recursos HTTP tras importar", () => {
    const original = new SimulationEngine(createLab());
    run(original, mail);
    run(original, {
      ...web,
      method: "POST",
      path: "/api/mensajes",
      body: "Primer recurso",
    });
    const snapshot = original.exportSnapshot();
    const imported = new SimulationEngine(snapshot.lab, snapshot.runtime);
    run(imported, mail);
    run(imported, {
      ...web,
      method: "POST",
      path: "/api/mensajes",
      body: "Segundo recurso",
    });
    const state = imported.getSnapshot().runtime.devices;
    const ids = state.srv.mailboxes["alumno@aula.test"].map(
      (message) => message.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    const resources = Object.entries(state.web.resources!).filter(([path]) =>
      path.startsWith("/api/mensajes/"),
    );
    expect(resources).toHaveLength(2);
    expect(
      resources.some(([, content]) => content.includes("Primer recurso")),
    ).toBe(true);
    expect(
      resources.some(([, content]) => content.includes("Segundo recurso")),
    ).toBe(true);
  });

  it("reset sin argumento vuelve al estado con el que se abrió el laboratorio importado", () => {
    const original = new SimulationEngine(createLab());
    run(original, mail);
    const snapshot = original.exportSnapshot();
    const imported = new SimulationEngine(snapshot.lab, snapshot.runtime);
    const initial = structuredClone(imported.getSnapshot().runtime);
    run(imported, mail);
    imported.reset();
    expect(imported.getSnapshot().runtime).toEqual(initial);
    expect(imported.getSnapshot().time).toBe(0);
    expect(imported.getSnapshot().pending).toBe(0);
    imported.reset(createLab());
    expect(
      imported.getSnapshot().runtime.devices.srv.mailboxes["alumno@aula.test"],
    ).toHaveLength(1);
  });

  it("conserva los valores originales de todos los fallos activos al exportar e importar", () => {
    const lab = createLab(),
      engine = new SimulationEngine(lab);
    const actions: FaultAction[] = [
      { kind: "link", targetId: "link-3", active: true },
      { kind: "service", targetId: "web", protocol: "HTTP", active: true },
      { kind: "dns", targetId: "dns", active: true },
      { kind: "credentials", targetId: "srv", active: true },
      { kind: "certificate", targetId: "web", active: true },
    ];
    actions.forEach((action) => engine.fault(action));
    const saved = JSON.parse(JSON.stringify(engine.exportSnapshot()));
    expect(saved.faults).toHaveLength(actions.length);
    const imported = new SimulationEngine(
      saved.lab,
      saved.runtime,
      saved.faults,
    );
    expect(imported.getSnapshot().lab).toEqual(engine.getSnapshot().lab);
    actions.forEach((action) => imported.fault({ ...action, active: false }));
    expect(imported.getSnapshot().lab).toEqual(lab);
    expect(imported.exportSnapshot().faults).toHaveLength(0);
    expect(run(imported, web).ok).toBe(true);
  });

  it("reset repara fallos importados y retira respaldos de dispositivos eliminados", () => {
    const engine = new SimulationEngine(createLab());
    engine.fault({ kind: "certificate", targetId: "web", active: true });
    const saved = engine.exportSnapshot(),
      imported = new SimulationEngine(saved.lab, saved.runtime, saved.faults);
    imported.reset();
    expect(find(imported.getSnapshot().lab, "web").certificateValid).toBe(true);
    expect(imported.exportSnapshot().faults).toHaveLength(0);
    const lab = structuredClone(engine.getSnapshot().lab);
    lab.devices = lab.devices.filter((device) => device.id !== "web");
    lab.links = lab.links.filter(
      (link) => link.source !== "web" && link.target !== "web",
    );
    engine.editLab(lab);
    expect(engine.exportSnapshot().faults).toHaveLength(0);
  });
});
