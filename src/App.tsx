import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  Globe,
  MagnifyingGlass,
  EnvelopeSimple,
  FolderOpen,
  TerminalWindow,
  ChartBar,
  Play,
  Pause,
  SkipForward,
  ArrowCounterClockwise,
  Export,
  UploadSimple,
  Presentation,
  CaretRight,
  CaretLeft,
  X,
  Bug,
  Plus,
  CheckCircle,
  Terminal,
  ListBullets,
  Stack,
  SlidersHorizontal,
  Info,
  SidebarSimple,
  CaretDown,
  Circle,
  ArrowRight,
  BookOpen,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Connection } from "@xyflow/react";
import { SimulationEngine } from "./engine";
import { createLab, makeDevice, SCENARIOS, type ScenarioId } from "./scenarios";
import type {
  AppProtocol,
  Device,
  DeviceKind,
  FaultAction,
  ProtocolAction,
  LabSnapshot,
} from "./types";
import { PROTOCOL_COLORS } from "./types";
import { loadSnapshot, parseSnapshot, STORAGE_KEY } from "./storage";
import Topology, { DeviceArt } from "./components/Topology";
import DeviceEditor from "./components/DeviceEditor";
import Inspector, { OsiPanel } from "./components/Inspector";
import ToolsPanel from "./components/ToolsPanel";
import { parseCommand, COMMAND_NAMES, COMMAND_EXAMPLES } from "./console";

const scenarioIcons = {
  web: Globe,
  dns: MagnifyingGlass,
  mail: EnvelopeSimple,
  files: FolderOpen,
  remote: TerminalWindow,
  snmp: ChartBar,
};
const guideSteps = [
  {
    scenario: "web",
    title: "Un nombre, una dirección",
    text: "Ejecuta el flujo. DNS descubre la IP y HTTP solicita la página. Abre un mensaje para ver su solicitud y su respuesta.",
    duration: "1:30",
  },
  {
    scenario: "web",
    title: "¿Qué protege HTTPS?",
    text: "En Herramientas, cambia a HTTPS. Abre un mensaje HTTP protegido y compara «En el equipo» con «En tránsito».",
    duration: "1:30",
  },
  {
    scenario: "mail",
    title: "Del emisor al buzón",
    text: "Envía el mensaje y consulta la bandeja con IMAP o POP3. El correo debe existir en el servidor antes de poder leerlo.",
    duration: "1:00",
  },
  {
    scenario: "files",
    title: "Un archivo también es información",
    text: "Descarga bienvenida.txt con FTP. Repite con SFTP y observa las conexiones y el contenido protegido.",
    duration: "0:45",
  },
  {
    scenario: "remote",
    title: "Controlar otro equipo",
    text: "Ejecuta hostname con SSH. Compara con Telnet: mismo resultado, distinta protección de los datos.",
    duration: "0:45",
  },
  {
    scenario: "snmp",
    title: "Preguntar a la red",
    text: "Consulta el nombre del router y su contador de paquetes. Relaciona el OID con el dato devuelto.",
    duration: "0:30",
  },
  {
    scenario: "web",
    title: "Detectar y corregir un fallo",
    text: "En «Fallos», apaga HTTP. La red sigue conectada, pero la página falla. Reactiva el servicio y repite la petición.",
    duration: "1:00",
  },
] as const;
const welcome = [
  "Laboratorio Capa 7 · Terminal simulada",
  "Equipo activo: PC · Estudiante (192.168.10.10)",
  "Escribe help para ver los comandos o selecciona un ejemplo.",
];

export default function App() {
  const restoredSnapshot = useRef<LabSnapshot | undefined>(undefined);
  const engineRef = useRef<SimulationEngine | null>(null);
  if (!engineRef.current) {
    const saved = loadSnapshot();
    restoredSnapshot.current = saved;
    engineRef.current = new SimulationEngine(
      saved?.lab || createLab(),
      saved?.runtime,
      saved?.faults,
    );
  }
  const engine = engineRef.current;
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [scenario, setScenario] = useState<ScenarioId>("web");
  const current = SCENARIOS.find((s) => s.id === scenario)!;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [tab, setTab] = useState<"tools" | "inspect" | "config" | "osi">(
    "tools",
  );
  const [sourceId, setSourceId] = useState("pc1");
  const [consoleTab, setConsoleTab] = useState<"console" | "events" | "guide">(
    "console",
  );
  const [consoleLines, setConsoleLines] = useState(welcome);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [bottomHeight, setBottomHeight] = useState(170);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [presentation, setPresentation] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [panelOpen, setPanelOpen] = useState(window.innerWidth > 800);
  const [faultOpen, setFaultOpen] = useState(false);
  const [faults, setFaults] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [saved, setSaved] = useState(true);
  const [about, setAbout] = useState(false);
  const faultTargets = useRef<
    Partial<Record<FaultAction["kind"], FaultAction>>
  >(
    Object.fromEntries(
      (restoredSnapshot.current?.faults || []).map((f) => [
        f.action.kind,
        f.action,
      ]),
    ),
  );
  const importInput = useRef<HTMLInputElement>(null);
  const consoleEnd = useRef<HTMLDivElement>(null);
  const lastResult = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const event =
    state.events.find((e) => e.id === selectedEvent) || state.events.at(-1);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3800);
  }, []);
  useEffect(() => {
    if (!playing) return;
    if (!state.pending) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => engine.step(), 1800 / speed);
    return () => clearTimeout(timer);
  }, [engine, playing, speed, state.time, state.pending, state.revision]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(engine.exportSnapshot()),
        );
        setSaved(true);
      } catch {
        setSaved(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [engine, state.lab, state.runtime]);
  useEffect(() => {
    if (state.results.length < lastResult.current) lastResult.current = 0;
    const results = state.results.slice(lastResult.current);
    if (results.length)
      setConsoleLines((lines) =>
        [
          ...lines,
          ...results.map(
            (r) =>
              `${r.ok ? "✓" : "✗"} ${r.protocol} · ${r.title}\n${r.output}`,
          ),
        ].slice(-150),
      );
    lastResult.current = state.results.length;
  }, [state.results]);
  useEffect(() => {
    consoleEnd.current?.scrollIntoView({ block: "nearest" });
  }, [consoleLines]);
  useEffect(() => {
    if (restoredSnapshot.current?.faults)
      setFaults(
        Object.fromEntries(
          restoredSnapshot.current.faults.map((f) => [f.action.kind, true]),
        ),
      );
  }, []);
  useEffect(() => {
    if (!state.lab.devices.some((d) => d.id === sourceId)) {
      setSourceId(
        state.lab.devices.find((d) => d.kind === "client")?.id ||
          state.lab.devices[0]?.id ||
          "",
      );
    }
  }, [state.lab.devices, sourceId]);
  const onAction = useCallback(
    (a: ProtocolAction) => {
      try {
        if (!a.sourceId) {
          notify("Agrega o selecciona un equipo de origen.");
          return;
        }
        engine.enqueue(a);
        setSelectedEvent(null);
        if (!engine.getSnapshot().events.length || !playing) engine.step();
        setPlaying(true);
      } catch (e) {
        notify(e instanceof Error ? e.message : "No se pudo iniciar el flujo.");
      }
    },
    [engine, playing, notify],
  );
  const start = () => onAction({ ...current.action, sourceId });
  const selectScenario = (id: ScenarioId) => {
    setScenario(id);
    setTab("tools");
    setPanelOpen(true);
    setSelectedEvent(null);
  };
  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedLink(null);
    setTab("config");
    setPanelOpen(true);
  }, []);
  const onInspect = useCallback((id: string) => {
    setSelectedEvent(id);
    setTab("inspect");
    setPanelOpen(true);
  }, []);
  const onMove = useCallback(
    (id: string, position: { x: number; y: number }) => {
      const lab = structuredClone(engine.getSnapshot().lab);
      const d = lab.devices.find((x) => x.id === id);
      if (d) {
        d.position = position;
        engine.editLab(lab, false);
      }
    },
    [engine],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const lab = structuredClone(engine.getSnapshot().lab);
      if (
        c.source === c.target ||
        lab.links.some(
          (l) =>
            (l.source === c.source && l.target === c.target) ||
            (l.source === c.target && l.target === c.source),
        )
      ) {
        notify("Conecta dos equipos distintos que aún no tengan un enlace.");
        return;
      }
      lab.links.push({
        id: `link-${crypto.randomUUID()}`,
        source: c.source,
        target: c.target,
        sourceInterface:
          lab.devices.find((d) => d.id === c.source)?.kind === "router"
            ? "eth1"
            : "eth0",
        targetInterface: "eth0",
        online: true,
      });
      engine.editLab(lab);
      setPlaying(false);
      notify(
        "Conexión agregada. Puedes configurar sus interfaces al seleccionarla.",
      );
    },
    [engine, notify],
  );
  const deleteIds = useCallback(
    (ids: string[]) => {
      const lab = structuredClone(engine.getSnapshot().lab);
      lab.devices = lab.devices.filter((d) => !ids.includes(d.id));
      lab.links = lab.links.filter(
        (l) =>
          !ids.includes(l.id) &&
          !ids.includes(l.source) &&
          !ids.includes(l.target),
      );
      engine.editLab(lab);
      setPlaying(false);
      setSelectedId(null);
      setSelectedLink(null);
      notify("Elemento eliminado del laboratorio.");
    },
    [engine, notify],
  );
  const saveDevice = (device: Device) => {
    const lab = structuredClone(state.lab);
    lab.devices = lab.devices.map((d) => (d.id === device.id ? device : d));
    engine.editLab(lab);
    setPlaying(false);
    notify("Configuración aplicada.");
  };
  const addDevice = (kind: DeviceKind) => {
    if (state.lab.devices.length >= 100) {
      notify("Máximo: 100 equipos por laboratorio.");
      return;
    }
    const n = state.lab.devices.length + 1;
    const d = makeDevice(
      kind,
      `${kind}-${crypto.randomUUID().slice(0, 8)}`,
      `${{ client: "PC", switch: "Switch", router: "Router", server: "Servidor", dns: "DNS" }[kind]} ${n}`,
      `192.168.${kind === "client" ? 10 : 20}.${50 + n}`,
      200 + (n % 3) * 170,
      -140 * Math.floor(Math.max(0, n - 9) / 3),
    );
    const defaults = createLab();
    if (kind === "router") {
      d.interfaces[0].ip = `192.168.10.${50 + n}`;
      d.interfaces.push({ id: "eth1", ip: `192.168.20.${50 + n}`, prefix: 24 });
      d.gateway = "";
      d.services = structuredClone(
        defaults.devices.find((x) => x.id === "router")!.services,
      );
    }
    if (kind === "server") {
      d.services = [
        ...defaults.devices.find((x) => x.id === "web")!.services,
        ...defaults.devices.find((x) => x.id === "srv")!.services,
      ];
      d.files = { ...defaults.devices.find((x) => x.id === "srv")!.files };
      d.resources = {
        ...defaults.devices.find((x) => x.id === "web")!.resources,
      };
    }
    if (kind === "dns") {
      d.services = [{ protocol: "DNS", port: 53, enabled: true }];
      d.records = structuredClone(
        defaults.devices.find((x) => x.id === "dns")!.records,
      );
    }
    const lab = structuredClone(state.lab);
    lab.devices.push(d);
    engine.editLab(lab);
    onSelect(d.id);
    setPlaying(false);
    notify(
      `${d.name} agregado. Conecta los puntos de los equipos para crear un enlace.`,
    );
  };
  const reset = () => {
    engine.reset(createLab());
    setPlaying(false);
    setSelectedEvent(null);
    setSelectedId(null);
    setSelectedLink(null);
    setFaults({});
    faultTargets.current = {};
    setConsoleLines(welcome);
    lastResult.current = 0;
    setSourceId("pc1");
    notify("Escenario inicial restaurado.");
  };
  const exportLab = () => {
    const blob = new Blob([JSON.stringify(engine.exportSnapshot(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "laboratorio-capa7.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Laboratorio exportado.");
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    try {
      const data = parseSnapshot(await file.text());
      engine.reset(data.lab);
      engineRef.current = new SimulationEngine(
        data.lab,
        data.runtime,
        data.faults,
      );
      setPlaying(false);
      setSelectedEvent(null);
      setSelectedId(null);
      setFaults(
        Object.fromEntries(
          (data.faults || []).map((f) => [f.action.kind, true]),
        ),
      );
      faultTargets.current = Object.fromEntries(
        (data.faults || []).map((f) => [f.action.kind, f.action]),
      );
      lastResult.current = 0;
      setConsoleLines([
        "Laboratorio importado. Usa help para consultar los comandos.",
      ]);
      notify("Laboratorio importado y detenido.");
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "No se pudo importar el archivo.",
      );
    }
    if (importInput.current) importInput.current.value = "";
  };
  const toggleFault = (kind: FaultAction["kind"]) => {
    const active = !faults[kind];
    const protocol: AppProtocol =
      scenario === "dns"
        ? "DNS"
        : scenario === "mail"
          ? "SMTP"
          : scenario === "files"
            ? "FTP"
            : scenario === "remote"
              ? "SSH"
              : scenario === "snmp"
                ? "SNMP"
                : "HTTP";
    const targetId =
      kind === "link"
        ? "link-3"
        : kind === "dns"
          ? "dns"
          : kind === "credentials"
            ? "srv"
            : kind === "certificate"
              ? "web"
              : protocol === "DNS"
                ? "dns"
                : protocol === "HTTP"
                  ? "web"
                  : protocol === "SNMP"
                    ? "router"
                    : "srv";
    const action: FaultAction = active
      ? { kind, targetId, active, ...(kind === "service" ? { protocol } : {}) }
      : {
          ...(faultTargets.current[kind] || { kind, targetId }),
          active: false,
        };
    if (
      action.kind === "link"
        ? !state.lab.links.some((l) => l.id === action.targetId)
        : !state.lab.devices.some((d) => d.id === action.targetId)
    ) {
      notify(
        "Este fallo corresponde al campus inicial. Restaura el escenario o configura el equipo directamente.",
      );
      return;
    }
    try {
      engine.fault(action);
      faultTargets.current[kind] = action;
      setFaults({ ...faults, [kind]: active });
      notify(
        kind === "dns"
          ? active
            ? "Registro DNS alterado; caché vaciada para observar el cambio."
            : "Registro DNS restaurado y caché vaciada."
          : active
            ? "Fallo activado. Observa dónde se detiene el flujo."
            : "Fallo corregido. Repite la operación.",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo aplicar el fallo.");
    }
  };
  const submitCommand = () => {
    const input = command.trim();
    if (!input) return;
    setHistory((h) => [...h, input]);
    setHistoryIndex(-1);
    setCommand("");
    setConsoleLines((lines) => [
      ...lines,
      `${state.lab.devices.find((d) => d.id === sourceId)?.name || "equipo"} > ${input}`,
    ]);
    const result = parseCommand(input, state.lab, state.runtime, sourceId);
    if (result.clear) setConsoleLines([]);
    if (result.output) setConsoleLines((lines) => [...lines, result.output!]);
    if (result.action) onAction(result.action);
  };
  const commandKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submitCommand();
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const i =
        historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(i);
      setCommand(history[i] || "");
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = historyIndex + 1;
      setHistoryIndex(i);
      setCommand(history[i] || "");
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const matches = COMMAND_NAMES.filter((x) => x.startsWith(command));
      if (matches.length === 1) setCommand(matches[0] + " ");
      else if (matches.length)
        setConsoleLines((lines) => [...lines, matches.join("   ")]);
    }
  };
  const switchGuide = (i: number) => {
    const value = Math.max(0, Math.min(guideSteps.length - 1, i));
    setGuideStep(value);
    selectScenario(guideSteps[value].scenario);
  };
  const present = () => {
    setPresentation((v) => !v);
    setGuideOpen(!presentation);
    if (!presentation) {
      setGuideStep(0);
      setConsoleTab("guide");
      setBottomOpen(true);
      selectScenario("web");
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      setConsoleTab("console");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  };
  const resizeBottom = (e: React.PointerEvent) => {
    const y = e.clientY;
    const h = bottomHeight;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setBottomHeight(
        Math.max(110, Math.min(window.innerHeight * 0.55, h + y - ev.clientY)),
      );
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  const guideCard = (
    <div className="guide-card">
      <div className="guide-meta">
        <span>
          <BookOpen size={14} /> GUÍA · {guideStep + 1}/{guideSteps.length}
        </span>
        <span>
          {guideSteps[guideStep].duration} min{" "}
          <button
            className="icon-button"
            onClick={() => {
              setGuideOpen(false);
              setConsoleTab("console");
            }}
            aria-label="Cerrar guía"
          >
            <X size={15} />
          </button>
        </span>
      </div>
      <h3>{guideSteps[guideStep].title}</h3>
      <p>{guideSteps[guideStep].text}</p>
      <div className="guide-controls">
        <div className="guide-dots">
          {guideSteps.map((_, i) => (
            <button
              key={i}
              className={i === guideStep ? "active" : ""}
              onClick={() => switchGuide(i)}
              aria-label={`Paso de guía ${i + 1}`}
            />
          ))}
        </div>
        <button
          className="icon-button"
          disabled={guideStep === 0}
          onClick={() => switchGuide(guideStep - 1)}
          aria-label="Paso anterior"
        >
          <CaretLeft size={17} />
        </button>
        <button
          className="text-button"
          disabled={guideStep === guideSteps.length - 1}
          onClick={() => switchGuide(guideStep + 1)}
        >
          Siguiente
          <CaretRight size={16} />
        </button>
      </div>
    </div>
  );
  const ScenarioIcon = scenarioIcons[scenario];
  return (
    <div
      className={`app ${presentation ? "presentation-mode" : ""} ${!panelOpen ? "panel-hidden" : ""}`}
      style={
        {
          "--bottom-height": `${bottomOpen ? bottomHeight : 40}px`,
        } as CSSProperties
      }
    >
      <header className="app-header">
        <a
          href="#"
          className="brand"
          onClick={(e) => e.preventDefault()}
          aria-label="Capa 7, laboratorio de redes"
        >
          <span className="brand-symbol">
            <Stack size={23} weight="fill" />
          </span>
          <span>
            <strong>
              capa<span>7</span>
            </strong>
            <small>LABORATORIO DE REDES</small>
          </span>
        </a>
        <div className="header-divider" />
        <div className="institution">
          <b>UNIFRANZ</b>
          <span>Sistemas de Comunicaciones</span>
        </div>
        <div className="header-spacer" />
        <span className="local-badge">
          <i />
          Entorno local
        </span>
        <button
          className="icon-button hide-small"
          onClick={() => setAbout(true)}
          aria-label="Acerca del simulador"
        >
          <Info size={20} />
        </button>
        <button className="secondary-button present-button" onClick={present}>
          <Presentation size={18} />
          {presentation ? "Salir de presentación" : "Presentar"}
        </button>
      </header>
      <aside className="sidebar">
        <div className="sidebar-label">
          EXPERIMENTOS <span>06</span>
        </div>
        <nav aria-label="Escenarios">
          {SCENARIOS.map((s) => {
            const Icon = scenarioIcons[s.id];
            return (
              <button
                key={s.id}
                className={`scenario-nav ${scenario === s.id ? "active" : ""}`}
                onClick={() => selectScenario(s.id)}
                aria-current={scenario === s.id ? "page" : undefined}
              >
                <span className="scenario-icon">
                  <Icon
                    size={22}
                    weight={scenario === s.id ? "duotone" : "regular"}
                  />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.protocols}</small>
                </span>
                <CaretRight size={13} />
              </button>
            );
          })}
        </nav>
        <div className="device-palette">
          <div className="sidebar-label">
            CONSTRUYE TU RED <Plus size={13} />
          </div>
          <div className="palette-grid">
            {(
              ["client", "switch", "router", "server", "dns"] as DeviceKind[]
            ).map((kind) => (
              <button
                key={kind}
                onClick={() => addDevice(kind)}
                aria-label={`Agregar ${kind === "client" ? "PC" : kind === "dns" ? "DNS" : kind === "server" ? "servidor" : kind}`}
                title="Agregar y configurar"
              >
                <DeviceArt kind={kind} small />
                <span>
                  {
                    {
                      client: "PC",
                      switch: "Switch",
                      router: "Router",
                      server: "Servidor",
                      dns: "DNS",
                    }[kind]
                  }
                </span>
              </button>
            ))}
          </div>
          <p>Agrega equipos y une sus puntos de conexión.</p>
        </div>
        <div className="sidebar-bottom">
          <button
            className="guide-link"
            onClick={() => {
              setGuideOpen(!guideOpen);
              setGuideStep(0);
              setConsoleTab(guideOpen ? "console" : "guide");
              setBottomOpen(true);
              selectScenario("web");
            }}
          >
            <BookOpen size={20} />
            <span>
              Guía de exposición<small>Un recorrido de 7 minutos</small>
            </span>
            <ArrowRight size={17} />
          </button>
          <span className="sidebar-footnote">APRENDE. CONECTA. EXPLORA.</span>
        </div>
      </aside>
      <main className="workspace">
        <div className="workspace-topbar">
          <div className="breadcrumb">
            Laboratorio <CaretRight size={12} />
            <strong>{state.lab.name}</strong>
          </div>
          <div className="workspace-actions">
            <span
              className="saved-indicator"
              title={
                saved
                  ? "Guardado automático local"
                  : "No se pudo guardar; exporta el laboratorio"
              }
            >
              {saved ? <CheckCircle size={14} /> : <WarningCircle size={14} />}
              <span>{saved ? "Guardado" : "Sin guardar"}</span>
            </span>
            <button
              className="icon-button"
              onClick={exportLab}
              aria-label="Exportar laboratorio"
              title="Exportar JSON"
            >
              <Export size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => importInput.current?.click()}
              aria-label="Importar laboratorio"
              title="Importar JSON"
            >
              <UploadSimple size={18} />
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => void loadFile(e.target.files?.[0])}
            />
            <button
              className="icon-button"
              onClick={() => setPanelOpen(!panelOpen)}
              aria-label={panelOpen ? "Ocultar panel" : "Mostrar panel"}
            >
              <SidebarSimple size={19} />
            </button>
          </div>
        </div>
        <div className="scenario-heading">
          <div className="scenario-intro">
            <div className="eyebrow">
              <span className="tiny-index">{current.number}</span> CAPA DE
              APLICACIÓN <span className="eyebrow-dot">·</span>{" "}
              {current.protocols}
            </div>
            <h1>{current.title}</h1>
            <p>
              {current.subtitle}.{" "}
              <span>{current.description.split(". ")[0]}.</span>
            </p>
          </div>
          <button
            className="primary-button launch-button"
            onClick={start}
            data-testid="start-flow"
          >
            <Play size={18} weight="fill" />
            Iniciar flujo
          </button>
        </div>
        <div className="simulation-toolbar">
          <div className="playback">
            <button
              className={`play-button ${playing ? "playing" : ""}`}
              onClick={() => {
                if (playing) setPlaying(false);
                else if (state.pending) setPlaying(true);
                else start();
              }}
              aria-label={
                playing ? "Pausar simulación" : "Reproducir simulación"
              }
            >
              {playing ? (
                <Pause size={17} weight="fill" />
              ) : (
                <Play size={17} weight="fill" />
              )}
            </button>
            <button
              className="icon-button"
              onClick={() => {
                setPlaying(false);
                if (!state.pending)
                  engine.enqueue({ ...current.action, sourceId });
                engine.step();
                setSelectedEvent(null);
              }}
              aria-label="Avanzar un evento"
              title="Avanzar un evento"
            >
              <SkipForward size={18} />
            </button>
            <button
              className="icon-button"
              onClick={reset}
              aria-label="Restaurar escenario"
              title="Restaurar el campus inicial"
            >
              <ArrowCounterClockwise size={18} />
            </button>
            <span className="toolbar-separator" />
            <label className="speed-select">
              <select
                aria-label="Velocidad de simulación"
                value={speed}
                onChange={(e) => setSpeed(+e.target.value)}
              >
                <option value={0.5}>0,5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>
            <span className={`simulation-state ${playing ? "running" : ""}`}>
              <i />
              {playing
                ? "Simulando"
                : state.pending
                  ? "En pausa"
                  : "Listo para explorar"}
            </span>
          </div>
          <div className="fault-control">
            <span className="logical-time">{state.time.toFixed(1)} s</span>
            <button
              className={`secondary-button fault-button ${Object.values(faults).some(Boolean) ? "has-fault" : ""}`}
              onClick={() => setFaultOpen(!faultOpen)}
            >
              <Bug size={17} />
              Fallos
              <CaretDown size={12} />
            </button>
            {faultOpen && (
              <div className="fault-menu">
                <div className="menu-heading">
                  PROVOCA Y OBSERVA
                  <button
                    className="icon-button"
                    onClick={() => setFaultOpen(false)}
                    aria-label="Cerrar fallos"
                  >
                    <X size={15} />
                  </button>
                </div>
                {(
                  [
                    {
                      kind: "link",
                      label: "Enlace del campus caído",
                      note: "Interrumpe el acceso a los servicios",
                    },
                    {
                      kind: "service",
                      label: `Servicio ${faults.service ? faultTargets.current.service?.protocol || current.action.protocol : current.action.protocol} apagado`,
                      note: "La red funciona; la aplicación no responde",
                    },
                    {
                      kind: "dns",
                      label: "Registro DNS incorrecto",
                      note: "El nombre lleva a otra dirección",
                    },
                    {
                      kind: "credentials",
                      label: "Credenciales inválidas",
                      note: "El servidor rechaza la autenticación",
                    },
                    {
                      kind: "certificate",
                      label: "Certificado HTTPS inválido",
                      note: "El cliente rechaza la conexión segura",
                    },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.kind}
                    onClick={() => toggleFault(f.kind)}
                    className={faults[f.kind] ? "active" : ""}
                  >
                    <span>
                      <strong>{f.label}</strong>
                      <small>{f.note}</small>
                    </span>
                    <span
                      className={`switch-visual ${faults[f.kind] ? "on" : ""}`}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="canvas-container">
          <Topology
            lab={state.lab}
            event={event}
            playing={playing}
            speed={speed}
            selectedId={selectedId}
            onSelect={onSelect}
            onInspect={onInspect}
            onMove={onMove}
            onConnect={onConnect}
            onDelete={deleteIds}
            onLinkSelect={(id) => {
              setSelectedLink(id);
              setSelectedId(null);
              setTab("config");
              setPanelOpen(true);
            }}
          />
        </div>
        <section
          className={`bottom-panel ${!bottomOpen ? "collapsed" : ""}`}
          aria-label="Consola y eventos"
        >
          <div
            className="panel-resizer"
            onPointerDown={resizeBottom}
            role="separator"
            aria-label="Cambiar altura de la consola"
            aria-orientation="horizontal"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp")
                setBottomHeight((h) => Math.min(380, h + 20));
              if (e.key === "ArrowDown")
                setBottomHeight((h) => Math.max(110, h - 20));
            }}
          />
          <div className="bottom-tabs">
            <button
              className={consoleTab === "console" ? "active" : ""}
              onClick={() => {
                setConsoleTab("console");
                setBottomOpen(true);
              }}
            >
              <Terminal size={16} />
              Consola
            </button>
            <button
              className={consoleTab === "events" ? "active" : ""}
              onClick={() => {
                setConsoleTab("events");
                setBottomOpen(true);
              }}
            >
              <ListBullets size={16} />
              Línea temporal{" "}
              <span className="count-badge">{state.events.length}</span>
            </button>
            {guideOpen && (
              <button
                className={consoleTab === "guide" ? "active" : ""}
                onClick={() => {
                  setConsoleTab("guide");
                  setBottomOpen(true);
                }}
              >
                <BookOpen size={16} />
                Guía
              </button>
            )}
            <span className="bottom-spacer" />
            <span className="pending-label">
              {state.pending
                ? `${state.pending} operación(es) pendiente(s)`
                : "Motor en reposo"}
            </span>
            <button
              className="icon-button"
              onClick={() => setBottomOpen(!bottomOpen)}
              aria-label={bottomOpen ? "Plegar consola" : "Expandir consola"}
            >
              <CaretDown className={!bottomOpen ? "rotate" : ""} size={16} />
            </button>
          </div>
          {bottomOpen &&
            (consoleTab === "guide" ? (
              guideCard
            ) : consoleTab === "console" ? (
              <div className="terminal-body">
                <div className="terminal-output" data-testid="terminal-output">
                  {consoleLines.map((line, i) => (
                    <pre
                      key={i}
                      className={
                        line.startsWith("✗")
                          ? "terminal-error"
                          : line.startsWith("✓")
                            ? "terminal-success"
                            : ""
                      }
                    >
                      {line}
                    </pre>
                  ))}
                  <div ref={consoleEnd} />
                </div>
                <div className="terminal-command">
                  <span>
                    {state.lab.devices
                      .find((d) => d.id === sourceId)
                      ?.name.split(" · ")[0] || "PC"}
                    <b>›</b>
                  </span>
                  <input
                    aria-label="Comando de consola"
                    placeholder="nslookup web.aula.test"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={commandKey}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button onClick={submitCommand} aria-label="Ejecutar comando">
                    <ArrowRight size={18} />
                  </button>
                  <select
                    aria-label="Ejemplos de consola"
                    value=""
                    onChange={(e) => {
                      setCommand(e.target.value);
                    }}
                  >
                    <option value="">Ejemplos</option>
                    {COMMAND_EXAMPLES.map((ex, i) => (
                      <option key={i} value={ex}>
                        {ex}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="event-table-wrap">
                <table className="event-table">
                  <thead>
                    <tr>
                      <th>Tiempo</th>
                      <th>Protocolo</th>
                      <th>Origen → destino</th>
                      <th>Mensaje</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.events.map((ev) => (
                      <tr
                        key={ev.id}
                        className={ev.id === event?.id ? "selected" : ""}
                        onClick={() => onInspect(ev.id)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onInspect(ev.id);
                        }}
                      >
                        <td>{ev.time.toFixed(1)} s</td>
                        <td>
                          <span
                            className="table-protocol"
                            style={{ color: PROTOCOL_COLORS[ev.protocol] }}
                          >
                            <i
                              style={{
                                background: PROTOCOL_COLORS[ev.protocol],
                              }}
                            />
                            {ev.protocol}
                          </span>
                        </td>
                        <td>
                          {state.lab.devices.find((d) => d.id === ev.sourceId)
                            ?.name || "Local"}{" "}
                          →{" "}
                          {state.lab.devices.find((d) => d.id === ev.targetId)
                            ?.name || "Local"}
                        </td>
                        <td>{ev.title}</td>
                        <td
                          className={
                            ev.status === "error"
                              ? "text-error"
                              : "text-success"
                          }
                        >
                          {ev.status === "error" ? "Error" : "OK"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!state.events.length && (
                  <div className="events-empty">
                    Inicia una operación para seguir sus mensajes paso a paso.
                  </div>
                )}
              </div>
            ))}
        </section>
      </main>
      {panelOpen && (
        <aside className="right-panel">
          <div className="right-panel-header">
            <span>
              <ScenarioIcon size={17} />
              {tab === "tools"
                ? "Herramientas"
                : tab === "inspect"
                  ? "Inspector de datos"
                  : tab === "config"
                    ? "Configuración"
                    : "Modelo OSI"}
            </span>
            <button
              className="icon-button"
              onClick={() => setPanelOpen(false)}
              aria-label="Cerrar panel"
            >
              <X size={17} />
            </button>
          </div>
          <div className="inspector-tabs" role="tablist">
            {(
              [
                { id: "tools", label: "Aplicación", Icon: Globe },
                { id: "inspect", label: "Datos", Icon: MagnifyingGlass },
                { id: "config", label: "Equipo", Icon: SlidersHorizontal },
                { id: "osi", label: "OSI", Icon: Stack },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => setTab(t.id)}
              >
                <t.Icon size={16} />
                {t.label}
              </button>
            ))}
          </div>
          <div className="right-panel-scroll">
            {tab === "tools" ? (
              <>
                <div className="source-select">
                  <label htmlFor="source-device">EQUIPO DE ORIGEN</label>
                  <select
                    id="source-device"
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                  >
                    {state.lab.devices
                      .filter((d) => d.kind !== "switch")
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>
                <ToolsPanel
                  scenario={scenario}
                  lab={state.lab}
                  runtime={state.runtime}
                  results={state.results}
                  events={state.events}
                  sourceId={sourceId}
                  pending={state.pending}
                  onAction={onAction}
                />
              </>
            ) : tab === "inspect" ? (
              <Inspector event={event} lab={state.lab} />
            ) : tab === "config" ? (
              <DeviceEditor
                device={state.lab.devices.find((d) => d.id === selectedId)}
                lab={state.lab}
                link={state.lab.links.find((l) => l.id === selectedLink)}
                onSave={saveDevice}
                onDelete={(id) => deleteIds([id])}
                onLinkSave={(l) => {
                  const lab = structuredClone(state.lab);
                  lab.links = lab.links.map((x) => (x.id === l.id ? l : x));
                  engine.editLab(lab);
                  setPlaying(false);
                }}
              />
            ) : (
              <OsiPanel event={event} />
            )}
          </div>
          <div className="panel-footnote">
            <Circle size={8} weight="fill" />
            SIMULACIÓN DIDÁCTICA · SIN TRÁFICO REAL
          </div>
        </aside>
      )}
      <footer className="statusbar">
        <span>
          <i /> {state.lab.devices.length} equipos{" "}
          <span className="status-divider">/</span>{" "}
          {state.lab.links.filter((l) => l.online).length} enlaces activos
        </span>
        <span className="status-center">
          Capa 7 · Los servicios detrás de cada aplicación
        </span>
        <button onClick={() => setAbout(true)}>
          Acerca del laboratorio <Info size={12} />
        </button>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={19} />
          {toast}
          <button onClick={() => setToast("")} aria-label="Cerrar aviso">
            <X size={14} />
          </button>
        </div>
      )}
      {about && (
        <div className="modal-backdrop" onClick={() => setAbout(false)}>
          <div
            className="about-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Acerca del laboratorio"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setAbout(false)}
              aria-label="Cerrar información"
            >
              <X size={20} />
            </button>
            <div className="brand-symbol">
              <Stack size={30} weight="fill" />
            </div>
            <p className="eyebrow">UNIFRANZ · SISTEMAS DE COMUNICACIONES</p>
            <h2>
              Lo que ocurre detrás
              <br />
              de una aplicación.
            </h2>
            <p>
              Un laboratorio para observar los protocolos de la capa 7: sus
              mensajes, sus datos y el camino que recorren.
            </p>
            <div className="about-facts">
              <span>
                <CheckCircle />
                Funciona sin Internet
              </span>
              <span>
                <CheckCircle />
                Datos y cuentas ficticios
              </span>
              <span>
                <CheckCircle />
                Estado compartido entre herramientas
              </span>
            </div>
            <p className="muted">
              IPv4 estática y transporte resumido. HTTP/1.1, TLS 1.3 didáctico,
              FTP pasivo, SFTP sobre SSH y SNMPv2c. Ping corresponde a la capa
              de red. No se realizan conexiones reales ni se ejecutan comandos
              de Windows.
            </p>
            <button className="primary-button" onClick={() => setAbout(false)}>
              Volver al laboratorio
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
