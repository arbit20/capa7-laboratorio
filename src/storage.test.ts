import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationEngine } from "./engine";
import { createLab } from "./scenarios";
import { loadSnapshot, parseSnapshot, STORAGE_KEY } from "./storage";

const snapshot = () => new SimulationEngine(createLab()).exportSnapshot();
const serialize = (value: unknown) => JSON.stringify(value);

describe("Importación y almacenamiento del laboratorio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recupera una exportación versión 1 y conserva la topología", () => {
    const original = snapshot();
    const restored = parseSnapshot(serialize(original));
    expect(restored.schemaVersion).toBe(1);
    expect(restored.lab).toEqual(original.lab);
    expect(restored.runtime.devices).toEqual(original.runtime.devices);
  });

  it("conserva archivos transferidos, lectura de correo, recursos POST y contadores", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue({
      protocol: "FTP",
      sourceId: "pc1",
      target: "192.168.20.30",
      username: "alumno",
      password: "redes123",
      method: "get",
      filename: "redes.txt",
    });
    engine.enqueue({
      protocol: "IMAP",
      sourceId: "pc1",
      target: "192.168.20.30",
      username: "alumno",
      password: "redes123",
      method: "read",
      filename: "welcome",
    });
    engine.enqueue({
      protocol: "HTTP",
      sourceId: "pc1",
      target: "192.168.20.20",
      method: "POST",
      path: "/api/mensajes",
      body: '{"texto":"¡Hola, clase!"}',
    });
    engine.runAll();
    expect(engine.getSnapshot().results.every((result) => result.ok)).toBe(
      true,
    );
    const data = parseSnapshot(serialize(engine.exportSnapshot()));
    const imported = new SimulationEngine(data.lab, data.runtime);
    const state = imported.getSnapshot();
    expect(state.runtime.devices).toEqual(engine.getSnapshot().runtime.devices);
    expect(state.runtime.devices.pc1.files["redes.txt"]).toContain(
      "DNS resuelve nombres.",
    );
    expect(
      state.runtime.devices.srv.mailboxes["alumno@aula.test"][0].read,
    ).toBe(true);
    expect(state.runtime.devices.web.resources?.["/api/mensajes"]).toContain(
      "¡Hola, clase!",
    );
    expect(state.runtime.devices.router.packets).toBeGreaterThan(0);
    expect(state.pending).toBe(0);
    expect(state.time).toBe(0);
    expect(state.events).toHaveLength(0);
  });

  it("una importación reinicia caché y sesiones efímeras con el nuevo reloj", () => {
    const engine = new SimulationEngine(createLab());
    engine.enqueue({
      protocol: "DNS",
      sourceId: "pc1",
      target: "web.aula.test",
    });
    engine.enqueue({
      protocol: "SSH",
      sourceId: "pc1",
      target: "192.168.20.30",
      username: "alumno",
      password: "redes123",
      command: "hostname",
    });
    engine.runAll();
    expect(
      engine.getSnapshot().runtime.cache.pc1["web.aula.test"],
    ).toBeDefined();
    expect(engine.getSnapshot().runtime.sessions.pc1).toBeDefined();
    const data = parseSnapshot(serialize(engine.exportSnapshot()));
    expect(data.runtime.cache).toEqual({});
    expect(data.runtime.sessions).toEqual({});
  });

  it("acepta exportaciones antiguas versión 1 sin resources de ejecución", () => {
    const data = snapshot();
    for (const runtime of Object.values(data.runtime.devices))
      delete runtime.resources;
    const restored = parseSnapshot(serialize(data));
    const engine = new SimulationEngine(restored.lab, restored.runtime);
    engine.enqueue({
      protocol: "HTTP",
      sourceId: "pc1",
      target: "192.168.20.20",
      method: "GET",
      path: "/",
    });
    engine.runAll();
    expect(engine.getSnapshot().results.at(-1)?.ok).toBe(true);
  });

  it("conserva fallos activos y sus valores originales para repararlos después de importar", () => {
    const initial = createLab();
    const engine = new SimulationEngine(initial);
    engine.fault({ kind: "certificate", targetId: "web", active: true });
    engine.fault({ kind: "link", targetId: "link-3", active: true });
    const exported = engine.exportSnapshot();
    expect(exported.faults).toHaveLength(2);
    const loaded = parseSnapshot(serialize(exported));
    expect(loaded.faults).toEqual(exported.faults);
    const restored = new SimulationEngine(
      loaded.lab,
      loaded.runtime,
      loaded.faults,
    );
    expect(
      restored.getSnapshot().lab.devices.find((item) => item.id === "web")
        ?.certificateValid,
    ).toBe(false);
    expect(
      restored.getSnapshot().lab.links.find((item) => item.id === "link-3")
        ?.online,
    ).toBe(false);
    restored.fault({ kind: "certificate", targetId: "web", active: false });
    restored.fault({ kind: "link", targetId: "link-3", active: false });
    expect(restored.getSnapshot().lab).toEqual(initial);
    expect(restored.exportSnapshot().faults ?? []).toHaveLength(0);
  });

  it("acepta los archivos versión 1 anteriores a la persistencia de fallos", () => {
    const data = snapshot();
    delete data.faults;
    const restored = parseSnapshot(serialize(data));
    expect(restored.lab).toEqual(data.lab);
    expect(restored.faults ?? []).toEqual([]);
  });

  it("rechaza fallos persistidos con forma, tipo, destino o valor original inválidos", () => {
    const base = snapshot();
    const invalid = [
      "certificado",
      [
        {
          action: { kind: "desconocido", targetId: "web", active: true },
          original: true,
        },
      ],
      [
        {
          action: {
            kind: "certificate",
            targetId: "equipo-ausente",
            active: true,
          },
          original: true,
        },
      ],
      [
        {
          action: { kind: "certificate", targetId: "web", active: true },
          original: "válido",
        },
      ],
      [
        {
          action: { kind: "link", targetId: "link-3", active: true },
          original: null,
        },
      ],
      [
        {
          action: { kind: "credentials", targetId: "srv", active: true },
          original: { alumno: 123 },
        },
      ],
      [
        {
          action: { kind: "dns", targetId: "dns", active: true },
          original: { "web.aula.test": { ip: "192.168.20.20", ttl: "eterno" } },
        },
      ],
      [
        {
          action: {
            kind: "service",
            targetId: "web",
            protocol: "HTTP",
            active: true,
          },
          original: { enabled: true },
        },
      ],
    ];
    for (const faults of invalid)
      expect(() => parseSnapshot(serialize({ ...base, faults }))).toThrow();
  });

  it("rechaza JSON inválido y versiones de esquema desconocidas", () => {
    expect(() => parseSnapshot("esto no es JSON")).toThrow();
    expect(() => parseSnapshot("{}")).toThrow(/incompatible/i);
    expect(() =>
      parseSnapshot(serialize({ ...snapshot(), schemaVersion: 2 })),
    ).toThrow(/incompatible/i);
    const nested = snapshot();
    expect(() =>
      parseSnapshot(
        serialize({ ...nested, lab: { ...nested.lab, schemaVersion: 2 } }),
      ),
    ).toThrow(/incompatible/i);
  });

  it("rechaza identidades duplicadas, protocolos desconocidos y enlaces colgantes", () => {
    const repeated = snapshot();
    repeated.lab.devices[1].id = repeated.lab.devices[0].id;
    expect(() => parseSnapshot(serialize(repeated))).toThrow(/dispositivo/i);
    const service = snapshot();
    const malformedService = serialize(service).replace(
      '"protocol":"DNS"',
      '"protocol":"PROTOCOLO_INEXISTENTE"',
    );
    expect(() => parseSnapshot(malformedService)).toThrow(/dispositivo/i);
    const orphan = snapshot();
    orphan.lab.links[0].target = "equipo-inexistente";
    expect(() => parseSnapshot(serialize(orphan))).toThrow(/conexión/i);
  });

  it("rechaza archivos, correos, cachés y contadores malformados", () => {
    const files = snapshot();
    expect(() =>
      parseSnapshot(
        serialize({
          ...files,
          runtime: {
            ...files.runtime,
            devices: {
              ...files.runtime.devices,
              pc1: { ...files.runtime.devices.pc1, files: { "notas.txt": 25 } },
            },
          },
        }),
      ),
    ).toThrow();
    const mail = snapshot();
    expect(() =>
      parseSnapshot(
        serialize({
          ...mail,
          runtime: {
            ...mail.runtime,
            devices: {
              ...mail.runtime.devices,
              srv: {
                ...mail.runtime.devices.srv,
                mailboxes: { "alumno@aula.test": [{ id: "incorrecto" }] },
              },
            },
          },
        }),
      ),
    ).toThrow();
    const counter = snapshot();
    counter.runtime.devices.pc1.bytes = -1;
    expect(() => parseSnapshot(serialize(counter))).toThrow();
    const cache = snapshot();
    expect(() =>
      parseSnapshot(
        serialize({
          ...cache,
          runtime: {
            ...cache.runtime,
            cache: {
              pc1: {
                "web.aula.test": { ip: "192.168.20.20", expiresAt: "nunca" },
              },
            },
          },
        }),
      ),
    ).toThrow(/caché/i);
  });

  it("rechaza archivos y topologías que superan los límites de importación", () => {
    expect(() => parseSnapshot(" ".repeat(5_000_001))).toThrow(/5 MB/i);
    const manyDevices = snapshot();
    manyDevices.lab.devices = Array.from({ length: 101 }, (_, index) => ({
      ...manyDevices.lab.devices[0],
      id: `pc-${index}`,
    }));
    expect(() => parseSnapshot(serialize(manyDevices))).toThrow(/100 equipos/i);
  });

  it("carga el guardado válido y tolera almacenamiento vacío, corrupto o inaccesible", () => {
    const getItem = vi.fn().mockReturnValue(serialize(snapshot()));
    vi.stubGlobal("localStorage", { getItem });
    expect(loadSnapshot()?.lab.name).toBe("Campus conectado");
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
    getItem.mockReturnValue(null);
    expect(loadSnapshot()).toBeUndefined();
    getItem.mockReturnValue("{incompleto");
    expect(loadSnapshot()).toBeUndefined();
    getItem.mockImplementation(() => {
      throw new Error("Storage bloqueado");
    });
    expect(loadSnapshot()).toBeUndefined();
  });
});
