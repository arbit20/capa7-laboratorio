import { memo, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import type { Device, DeviceKind, LabConfig, SimulationEvent } from "../types";
import { PROTOCOL_COLORS } from "../types";

export function DeviceArt({
  kind,
  small = false,
}: {
  kind: DeviceKind;
  small?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 120 94"
      width={small ? 42 : 104}
      height={small ? 34 : 82}
      aria-hidden="true"
      className={`device-art art-${kind}`}
    >
      <ellipse cx="61" cy="85" rx="41" ry="6" fill="#cddce5" opacity=".45" />
      {kind === "client" ? (
        <>
          <path d="M47 68h26l4 12H43z" fill="#9db3c3" />
          <rect x="18" y="10" width="85" height="59" rx="6" fill="#37566e" />
          <rect x="23" y="15" width="75" height="44" rx="2" fill="#dbf3f8" />
          <path d="M23 46L62 15h36v44H23z" fill="#bce5ee" />
          <rect x="32" y="27" width="32" height="3" rx="1.5" fill="#348dab" />
          <rect x="32" y="34" width="49" height="3" rx="1.5" fill="#7abccc" />
          <rect x="32" y="41" width="40" height="3" rx="1.5" fill="#7abccc" />
          <circle cx="61" cy="64" r="2" fill="#bedae2" />
          <path d="M29 78h65l11 9H17z" fill="#d9e5ed" stroke="#8da9ba" />
          <path d="M31 81h61M28 84h67" stroke="#9db3c3" />
        </>
      ) : kind === "switch" ? (
        <>
          <path d="M10 37l17-14h68l15 14v34H10z" fill="#9db7c9" />
          <path d="M10 37h100v34H10z" fill="#44677e" />
          <path d="M11 37l17-13h66l15 13z" fill="#d5e3eb" />
          {Array.from({ length: 6 }, (_, i) => (
            <g key={i}>
              <rect
                x={19 + i * 14}
                y="47"
                width="10"
                height="11"
                rx="1"
                fill="#243f51"
                stroke="#7595a9"
              />
              <rect
                x={21 + i * 14}
                y="61"
                width="5"
                height="2"
                fill={i < 3 ? "#6fdbaf" : "#b6c8d3"}
              />
            </g>
          ))}
          <path d="M45 30h30" stroke="#7c9bb0" strokeWidth="2" />
        </>
      ) : kind === "router" ? (
        <>
          <ellipse cx="60" cy="39" rx="44" ry="20" fill="#95c8da" />
          <path d="M16 39v23c0 26 88 26 88 0V39" fill="#287d9c" />
          <ellipse
            cx="60"
            cy="39"
            rx="44"
            ry="20"
            fill="#d1edf3"
            stroke="#8abfce"
          />
          <path
            d="M38 33h17v-8m0 8-6-6m20 0v17h11m-11 0 6-6M41 48V37h-9m9 0-6 6m29 8H52v6m0-6 5 5"
            fill="none"
            stroke="#257c9a"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="79" cy="67" r="2" fill="#84e2c1" />
          <circle cx="88" cy="63" r="2" fill="#84e2c1" />
        </>
      ) : (
        <>
          <path d="M39 12l13-7h35v70l-13 9H39z" fill="#8eacbf" />
          <path d="M74 12l13-7v70l-13 9z" fill="#567b94" />
          <rect
            x="28"
            y="12"
            width="48"
            height="72"
            rx="4"
            fill="#e6eef3"
            stroke="#9cb6c7"
          />
          {[24, 42, 60].map((y) => (
            <g key={y}>
              <rect x="34" y={y} width="36" height="13" rx="2" fill="#abc2d2" />
              <rect x="38" y={y + 4} width="18" height="2" fill="#52798f" />
              <circle cx="64" cy={y + 6} r="2" fill="#19886e" />
            </g>
          ))}
          {kind === "dns" && (
            <g>
              <circle
                cx="84"
                cy="29"
                r="18"
                fill="#eff8fb"
                stroke="#3b8da9"
                strokeWidth="2"
              />
              <ellipse
                cx="84"
                cy="29"
                rx="8"
                ry="18"
                fill="none"
                stroke="#3b8da9"
              />
              <path d="M66 29h36M69 21h30M69 37h30" stroke="#3b8da9" />
            </g>
          )}
        </>
      )}
    </svg>
  );
}
type EquipmentData = {
  device: Device;
  active: boolean;
  selectedDevice: boolean;
  onSelect: (id: string) => void;
};
const EquipmentNode = memo(({ data }: NodeProps<Node<EquipmentData>>) => {
  const d = data.device;
  return (
    <div
      className={`equipment-node ${data.selectedDevice ? "selected" : ""} ${data.active ? "is-active" : ""} ${!d.online ? "is-offline" : ""}`}
      data-testid={`device-${d.id}`}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <button
        className="equipment-hit"
        onClick={() => data.onSelect(d.id)}
        aria-label={`Configurar ${d.name}`}
      >
        <DeviceArt kind={d.kind} />
        <span className="device-name">{d.name}</span>
        <span className="device-address">
          <i className={d.online ? "status-led" : "status-led off"} />
          {d.interfaces[0]?.ip || "Conmutación · L2"}
        </span>
      </button>
    </div>
  );
});
type WireData = {
  event?: SimulationEvent;
  index: number;
  segments: number;
  reverse: boolean;
  playing: boolean;
  duration: number;
  onInspect: (id: string) => void;
  online: boolean;
};
const WireEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  }: EdgeProps<Edge<WireData>>) => {
    const [path] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 20,
    });
    const ev = data?.event;
    const color = ev ? PROTOCOL_COLORS[ev.protocol] : "#b9ccd8";
    return (
      <>
        <BaseEdge
          id={id}
          path={path}
          style={{
            stroke: data?.online ? color : "#cd6e71",
            strokeWidth: ev ? 2.5 : 1.8,
            strokeDasharray: data?.online ? undefined : "6 5",
          }}
        />
        {ev && data && (
          <g
            key={ev.id}
            className={`packet-motion ${data.reverse ? "reverse" : ""}`}
            style={{
              offsetPath: `path('${path}')`,
              animationDuration: `${data.duration / data.segments}ms`,
              animationDelay: `${(data.index * data.duration) / data.segments}ms`,
              animationPlayState: data.playing ? "running" : "paused",
            }}
            onClick={(e) => {
              e.stopPropagation();
              data.onInspect(ev.id);
            }}
            role="button"
            aria-label={`Inspeccionar ${ev.protocol}`}
          >
            <rect
              x="-14"
              y="-10"
              width="28"
              height="20"
              rx="5"
              fill={color}
              stroke="white"
              strokeWidth="2"
            />
            <path
              d="M-9-5L0 2l9-7"
              fill="none"
              stroke="white"
              strokeWidth="1.5"
            />
          </g>
        )}
      </>
    );
  },
);
const nodeTypes = { equipment: EquipmentNode };
const edgeTypes = { wire: WireEdge };
export default function Topology({
  lab,
  event,
  playing,
  speed,
  selectedId,
  onSelect,
  onInspect,
  onMove,
  onConnect,
  onDelete,
  onLinkSelect,
}: {
  lab: LabConfig;
  event?: SimulationEvent;
  playing: boolean;
  speed: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onConnect: (c: Connection) => void;
  onDelete: (ids: string[]) => void;
  onLinkSelect: (id: string) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void fitView({ padding: 0.1, duration: 160 });
      }, 120);
    });
    if (surface.current) observer.observe(surface.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [fitView]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void fitView({ padding: 0.1, duration: 160 });
    }, 140);
    return () => clearTimeout(timer);
  }, [lab.devices.length, lab.links.length, fitView]);
  const nodes: Node<EquipmentData>[] = useMemo(
    () =>
      lab.devices.map((d) => ({
        id: d.id,
        type: "equipment",
        position: d.position,
        data: {
          device: d,
          active: !!event?.route.includes(d.id),
          selectedDevice: selectedId === d.id,
          onSelect,
        },
        selected: false,
      })),
    [lab.devices, event, selectedId, onSelect],
  );
  const edges: Edge<WireData>[] = useMemo(
    () =>
      lab.links.map((l) => {
        const route = event?.route || [];
        let index = -1,
          reverse = false;
        for (let i = 0; i < route.length - 1; i++) {
          if (route[i] === l.source && route[i + 1] === l.target) {
            index = i;
            break;
          }
          if (route[i] === l.target && route[i + 1] === l.source) {
            index = i;
            reverse = true;
            break;
          }
        }
        return {
          id: l.id,
          source: l.source,
          target: l.target,
          sourceHandle: "out",
          targetHandle: "in",
          type: "wire",
          data: {
            event: index >= 0 ? event : undefined,
            index,
            segments: Math.max(1, route.length - 1),
            reverse,
            playing,
            duration: 1800 / speed,
            onInspect,
            online: l.online,
          },
        };
      }),
    [lab.links, event, playing, speed, onInspect],
  );
  const changes = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position) onMove(c.id, c.position);
    }
  };
  return (
    <div ref={surface} className="topology" data-testid="topology">
      <div className="network-zone zone-clients">
        RED DEL AULA <span>192.168.10.0 / 24</span>
      </div>
      <div className="network-zone zone-services">
        RED DE SERVICIOS <span>192.168.20.0 / 24</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={changes}
        onConnect={onConnect}
        onNodesDelete={(n) => onDelete(n.map((x) => x.id))}
        onEdgesDelete={(e) => onDelete(e.map((x) => x.id))}
        onEdgeClick={(_, e) => onLinkSelect(e.id)}
        onNodeClick={(_, n) => onSelect(n.id)}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.3}
        maxZoom={1.6}
        deleteKeyCode={null}
        nodesFocusable
        edgesFocusable
        connectionRadius={35}
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": "Acercar",
          "controls.zoomOut.ariaLabel": "Alejar",
          "controls.fitView.ariaLabel": "Ajustar red",
          "controls.interactive.ariaLabel": "Activar interacción",
        }}
      >
        <Background color="#c9dbe5" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="map-legend">
        <span>
          <i style={{ background: "#956322" }} />
          DNS
        </span>
        <span>
          <i style={{ background: "#147ea0" }} />
          Web
        </span>
        <span>
          <i style={{ background: "#b25a3b" }} />
          Correo
        </span>
        <span>
          <i style={{ background: "#168269" }} />
          Cifrado
        </span>
      </div>
      {event && (
        <button
          className={`flow-caption ${event.status === "error" ? "error" : ""}`}
          onClick={() => onInspect(event.id)}
        >
          <span
            className="protocol-tag"
            style={{ color: PROTOCOL_COLORS[event.protocol] }}
          >
            {event.protocol}
          </span>
          <span>{event.title}</span>
          <span className="caption-time">{event.time.toFixed(1)} s</span>
        </button>
      )}
    </div>
  );
}
