import { useEffect, useState } from "react";
import { FloppyDisk, Trash, PlugsConnected } from "@phosphor-icons/react";
import type { Device, LabConfig, NetworkLink } from "../types";
import { DeviceArt } from "./Topology";

function isIp(ip: string) {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((x) => +x <= 255)
  );
}
export default function DeviceEditor({
  device,
  lab,
  onSave,
  onDelete,
  link,
  onLinkSave,
}: {
  device?: Device;
  lab: LabConfig;
  onSave: (d: Device) => void;
  onDelete: (id: string) => void;
  link?: NetworkLink;
  onLinkSave: (l: NetworkLink) => void;
}) {
  const [draft, setDraft] = useState<Device | undefined>(
    device ? structuredClone(device) : undefined,
  );
  const [error, setError] = useState("");
  const [records, setRecords] = useState("");
  const [resources, setResources] = useState("");
  useEffect(() => {
    setDraft(device ? structuredClone(device) : undefined);
    setRecords(
      device
        ? Object.entries(device.records)
            .map(([name, r]) => `${name} ${r.ip} ${r.ttl}`)
            .join("\n")
        : "",
    );
    setResources(JSON.stringify(device?.resources || {}, null, 2));
    setError("");
  }, [device]);
  if (link)
    return (
      <div className="tool-panel">
        <div className="config-heading">
          <PlugsConnected size={36} />
          <div>
            <h3>Conexión de red</h3>
            <p className="muted">Enlace Ethernet simulado</p>
          </div>
        </div>
        <div className="connection-detail">
          {lab.devices.find((d) => d.id === link.source)?.name}
          <span>↔</span>
          {lab.devices.find((d) => d.id === link.target)?.name}
        </div>
        {(["source", "target"] as const).map((end) => {
          const device = lab.devices.find((d) => d.id === link[end]);
          const key = end === "source" ? "sourceInterface" : "targetInterface";
          return device && device.interfaces.length > 0 ? (
            <label className="field" key={end}>
              Interfaz · {device.name}
              <select
                value={link[key]}
                onChange={(e) => onLinkSave({ ...link, [key]: e.target.value })}
              >
                {device.interfaces.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} · {i.ip}
                  </option>
                ))}
              </select>
            </label>
          ) : null;
        })}
        <label className="toggle-line">
          <span>Enlace activo</span>
          <input
            type="checkbox"
            checked={link.online}
            onChange={(e) => onLinkSave({ ...link, online: e.target.checked })}
          />
        </label>
        <button className="danger-button" onClick={() => onDelete(link.id)}>
          <Trash size={16} />
          Eliminar conexión
        </button>
      </div>
    );
  if (!draft)
    return (
      <div className="empty-state">
        <DeviceArt kind="client" />
        <h3>Explora un equipo</h3>
        <p>
          Selecciona un dispositivo para configurar su dirección, sus servicios
          y sus datos.
        </p>
      </div>
    );
  const update = (patch: Partial<Device>) => setDraft({ ...draft, ...patch });
  const save = () => {
    setError("");
    if (!draft.name.trim())
      return setError("Escribe un nombre para el equipo.");
    if (
      draft.interfaces.some(
        (i) =>
          !isIp(i.ip) ||
          !Number.isInteger(i.prefix) ||
          i.prefix < 1 ||
          i.prefix > 32,
      )
    )
      return setError("Revisa las direcciones IPv4 y el prefijo (1–32).");
    if (
      (draft.gateway && !isIp(draft.gateway)) ||
      (draft.dns && !isIp(draft.dns))
    )
      return setError("La puerta de enlace y DNS deben ser direcciones IPv4.");
    try {
      const parsed: Device["records"] = {};
      for (const line of records.split("\n").filter((l) => l.trim())) {
        const [name, ip, ttl = "60"] = line.trim().split(/\s+/);
        if (!name || !isIp(ip) || !Number.isFinite(+ttl) || +ttl <= 0)
          throw Error(
            "Registro DNS: utiliza nombre, dirección IP y TTL positivo.",
          );
        parsed[name] = { ip, ttl: +ttl };
      }
      const r: unknown = JSON.parse(resources);
      if (
        !r ||
        typeof r !== "object" ||
        Array.isArray(r) ||
        Object.values(r).some((v) => typeof v !== "string")
      )
        throw Error("Los recursos deben ser un objeto JSON de rutas y textos.");
      onSave({
        ...draft,
        records: parsed,
        resources: r as Record<string, string>,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Configuración inválida.");
    }
  };
  return (
    <div className="tool-panel">
      <div className="config-heading">
        <DeviceArt kind={draft.kind} small />
        <div>
          <h3>{draft.name}</h3>
          <p className="muted">Configuración del dispositivo</p>
        </div>
      </div>
      <label className="field">
        Nombre
        <input
          aria-label="Nombre del dispositivo"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <label className="toggle-line">
        <span>Equipo encendido</span>
        <input
          type="checkbox"
          checked={draft.online}
          onChange={(e) => update({ online: e.target.checked })}
        />
      </label>
      {draft.interfaces.map((i, index) => (
        <div className="field-row" key={i.id}>
          <label className="field">
            IPv4 · {i.id}
            <input
              aria-label={`IPv4 ${i.id}`}
              value={i.ip}
              onChange={(e) =>
                update({
                  interfaces: draft.interfaces.map((x, n) =>
                    n === index ? { ...x, ip: e.target.value } : x,
                  ),
                })
              }
            />
          </label>
          <label className="field prefix-field">
            Prefijo
            <input
              aria-label={`Prefijo ${i.id}`}
              type="number"
              min="1"
              max="32"
              value={i.prefix}
              onChange={(e) =>
                update({
                  interfaces: draft.interfaces.map((x, n) =>
                    n === index ? { ...x, prefix: +e.target.value } : x,
                  ),
                })
              }
            />
          </label>
        </div>
      ))}
      {draft.kind !== "switch" && (
        <>
          <label className="field">
            Puerta de enlace
            <input
              value={draft.gateway}
              onChange={(e) => update({ gateway: e.target.value })}
            />
          </label>
          <label className="field">
            Servidor DNS
            <input
              value={draft.dns}
              onChange={(e) => update({ dns: e.target.value })}
            />
          </label>
        </>
      )}
      {!!draft.services.length && (
        <section className="tool-section">
          <h4>Servicios de aplicación</h4>
          {draft.services.map((s, index) => (
            <label className="toggle-line" key={s.protocol}>
              <span>
                {s.protocol}
                <small>Puerto {s.port}</small>
              </span>
              <input
                aria-label={`Servicio ${s.protocol}`}
                type="checkbox"
                checked={s.enabled}
                onChange={(e) =>
                  update({
                    services: draft.services.map((x, n) =>
                      n === index ? { ...x, enabled: e.target.checked } : x,
                    ),
                  })
                }
              />
            </label>
          ))}
        </section>
      )}
      {draft.kind === "dns" && (
        <label className="field">
          Registros DNS
          <textarea
            rows={6}
            aria-label="Registros DNS"
            value={records}
            onChange={(e) => setRecords(e.target.value)}
          />
          <small>nombre IP TTL · un registro por línea</small>
        </label>
      )}
      {draft.kind === "server" && (
        <>
          <details className="tool-details">
            <summary>Recursos web y credenciales</summary>
            <label className="field">
              Recursos HTTP (JSON)
              <textarea
                rows={7}
                aria-label="Recursos HTTP"
                value={resources}
                onChange={(e) => setResources(e.target.value)}
              />
            </label>
            <label className="field">
              Contraseña de alumno
              <input
                value={draft.accounts.alumno || ""}
                onChange={(e) =>
                  update({
                    accounts: { ...draft.accounts, alumno: e.target.value },
                  })
                }
              />
              <small>Cuenta ficticia para las demostraciones.</small>
            </label>
            <label className="toggle-line">
              <span>Certificado válido</span>
              <input
                type="checkbox"
                checked={draft.certificateValid}
                onChange={(e) => update({ certificateValid: e.target.checked })}
              />
            </label>
          </details>
        </>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button full-width" onClick={save}>
        <FloppyDisk size={17} />
        Aplicar configuración
      </button>
      <p className="tiny muted">
        Aplicar cambios detiene las operaciones pendientes. Arrastrar el equipo
        conserva la simulación.
      </p>
      <button className="danger-button" onClick={() => onDelete(draft.id)}>
        <Trash size={16} />
        Eliminar dispositivo
      </button>
    </div>
  );
}
