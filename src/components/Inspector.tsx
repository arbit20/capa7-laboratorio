import { useState } from "react";
import {
  ArrowRight,
  EnvelopeOpen,
  LockKey,
  Eye,
  CheckCircle,
  WarningCircle,
  Stack,
} from "@phosphor-icons/react";
import type { LabConfig, SimulationEvent } from "../types";
import { PROTOCOL_COLORS } from "../types";
export function OsiPanel({ event }: { event?: SimulationEvent }) {
  const layers = [
    [
      "Aplicación",
      "Servicios para las aplicaciones",
      "DNS · HTTP · SMTP · FTP · SSH · SNMP",
    ],
    [
      "Presentación",
      "Representación de la información",
      "Formatos, codificación y protección",
    ],
    ["Sesión", "Gestión del diálogo", "Contexto de la comunicación"],
    ["Transporte", "Comunicación entre procesos", "TCP / UDP · puertos"],
    ["Red", "Entrega entre redes", "IPv4 · direcciones y rutas"],
    ["Enlace de datos", "Entrega en el enlace local", "Ethernet · tramas"],
    ["Física", "Transmisión de señales", "Medio de transmisión"],
  ];
  return (
    <div className="tool-panel osi-panel">
      <p className="eyebrow">DE LOS DATOS A LA RED</p>
      <h3>Siete capas, una conversación</h3>
      <p className="muted">
        La aplicación genera un mensaje. Las capas inferiores permiten llevarlo
        al otro equipo.
      </p>
      <div className="osi-stack">
        {layers.map(([name, desc, example], i) => (
          <div
            key={name}
            className={`osi-layer ${i === 0 ? "application" : ""} ${event?.layer === 7 - i ? "current" : ""}`}
          >
            <b>{7 - i}</b>
            <div>
              <strong>{name}</strong>
              <span>{desc}</span>
              <small>{example}</small>
            </div>
            {event?.layer === 7 - i && <span className="layer-dot" />}
          </div>
        ))}
      </div>
      <div className="encapsulation">
        <span>Trama</span>
        <div>
          <span>Paquete IP</span>
          <div>
            <span>TCP / UDP</span>
            <div>Datos de aplicación</div>
          </div>
        </div>
      </div>
      <p className="tiny muted">
        Modelo conceptual: TCP/IP no asigna cada mecanismo a una única capa OSI.
        Los routers reenvían tráfico; no interpretan la página o el correo.
      </p>
    </div>
  );
}
export default function Inspector({
  event,
  lab,
}: {
  event?: SimulationEvent;
  lab: LabConfig;
}) {
  const [vantage, setVantage] = useState<"endpoint" | "wire">("endpoint");
  const [details, setDetails] = useState(false);
  if (!event)
    return (
      <div className="empty-state">
        <EnvelopeOpen size={54} weight="duotone" />
        <h3>Abre un mensaje</h3>
        <p>
          Inicia un flujo y selecciona un sobre o una fila de la línea temporal
          para observar sus datos.
        </p>
        <div className="empty-path">
          <span>Solicitud</span>
          <ArrowRight />
          <span>Respuesta</span>
        </div>
      </div>
    );
  const origin = lab.devices.find((d) => d.id === event.sourceId);
  const dest = lab.devices.find((d) => d.id === event.targetId);
  const encrypted = vantage === "wire" && event.encrypted;
  return (
    <div className="tool-panel inspector-content">
      <div className="inspect-title">
        <span
          className="protocol-pill"
          style={{ background: PROTOCOL_COLORS[event.protocol] }}
        >
          {event.protocol}
        </span>
        <span
          className={event.status === "error" ? "text-error" : "text-success"}
        >
          {event.status === "error" ? (
            <WarningCircle size={18} />
          ) : (
            <CheckCircle size={18} />
          )}{" "}
          {event.status === "error" ? "Interrumpido" : "Evento registrado"}
        </span>
      </div>
      <h3>{encrypted ? "Datos de aplicación protegidos" : event.title}</h3>
      <p className="explanation">
        {encrypted
          ? "El contenido de este mensaje se interpreta en los extremos de la conexión. Desde el enlace puedes observar su recorrido y los metadatos."
          : event.explanation}
      </p>
      <div className="route-summary">
        <div>
          <span>ORIGEN</span>
          <strong>{origin?.name || event.sourceId}</strong>
          <code>
            {event.sourceAddress || origin?.interfaces[0]?.ip || "Local"}
            {event.sourcePort ? `:${event.sourcePort}` : ""}
          </code>
        </div>
        <ArrowRight size={22} />
        <div>
          <span>DESTINO</span>
          <strong>{dest?.name || event.targetId}</strong>
          <code>
            {event.targetAddress || dest?.interfaces[0]?.ip || "Local"}
            {event.targetPort ? `:${event.targetPort}` : ""}
          </code>
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Punto de observación">
        <button
          className={vantage === "endpoint" ? "active" : ""}
          onClick={() => setVantage("endpoint")}
        >
          <Eye size={15} />
          En el equipo
        </button>
        <button
          className={vantage === "wire" ? "active" : ""}
          onClick={() => setVantage("wire")}
        >
          <LockKey size={15} />
          En tránsito
        </button>
      </div>
      <div
        className={`payload-box ${encrypted ? "encrypted" : ""}`}
        data-testid="payload"
      >
        <div className="payload-caption">
          {encrypted ? (
            <>
              <LockKey size={15} />
              CONTENIDO PROTEGIDO
            </>
          ) : (
            <>
              DATOS DEL MENSAJE <span>{event.bytes} B</span>
            </>
          )}
        </div>
        {encrypted ? (
          <div className="encrypted-message">
            <LockKey size={38} weight="duotone" />
            <strong>Contenido cifrado</strong>
            <p>
              La solicitud y sus datos viajan protegidos. El observador del
              enlace ve direcciones, puertos, tamaños y tiempos.
            </p>
            <code>•••• •••• •••• ••••</code>
          </div>
        ) : (
          <pre>{event.payload || "Evento local sin carga de aplicación."}</pre>
        )}
      </div>
      <p className="vantage-note">
        {event.encrypted
          ? encrypted
            ? "Representación didáctica del cifrado."
            : "El equipo es un extremo de la conexión y puede ver el contenido descifrado."
          : "Esta etapa no está marcada como cifrada."}
      </p>
      <button className="text-button" onClick={() => setDetails(!details)}>
        <Stack size={16} />
        {details ? "Ocultar" : "Ver"} detalle técnico
      </button>
      {details && (
        <dl className="technical-details">
          <dt>Transacción</dt>
          <dd>{event.traceId}</dd>
          <dt>Evento</dt>
          <dd>{event.id}</dd>
          <dt>Tiempo simulado</dt>
          <dd>{event.time.toFixed(2)} s</dd>
          <dt>Capa OSI</dt>
          <dd>{event.layer}</dd>
          <dt>Recorrido</dt>
          <dd>
            {event.route
              .map((id) => lab.devices.find((d) => d.id === id)?.name || id)
              .join(" → ") || "Operación local"}
          </dd>
        </dl>
      )}
    </div>
  );
}
