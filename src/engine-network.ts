import type { Device, LabConfig, NetworkInterface } from "./types";

export class NetworkError extends Error {}

export function ipv4(value: string): number | undefined {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
  )
    return undefined;
  return parts.reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
}

export function sameNetwork(
  address: string,
  network: string,
  prefix: number,
): boolean {
  const a = ipv4(address),
    b = ipv4(network);
  if (
    a === undefined ||
    b === undefined ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  )
    return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

export function deviceByAddress(
  lab: LabConfig,
  address: string,
): Device | undefined {
  return lab.devices.find(
    (d) => d.id === address || d.interfaces.some((i) => i.ip === address),
  );
}

/** The originating IP belongs to the interface used on the first physical hop. */
export function routeSourceAddress(
  lab: LabConfig,
  route: string[],
): string | undefined {
  const source = lab.devices.find((device) => device.id === route[0]);
  if (!source) return undefined;
  if (route.length < 2) return source.interfaces[0]?.ip;
  const link = lab.links.find(
    (item) =>
      item.online &&
      ((item.source === route[0] && item.target === route[1]) ||
        (item.target === route[0] && item.source === route[1])),
  );
  const interfaceId =
    link?.source === route[0] ? link.sourceInterface : link?.targetInterface;
  return source.interfaces.find((iface) => iface.id === interfaceId)?.ip;
}

function interfaceValid(
  iface: NetworkInterface | undefined,
): iface is NetworkInterface {
  return (
    !!iface &&
    ipv4(iface.ip) !== undefined &&
    Number.isInteger(iface.prefix) &&
    iface.prefix >= 0 &&
    iface.prefix <= 32
  );
}

/** A layer-two segment can contain switches, never an intervening host or router. */
function segment(
  lab: LabConfig,
  source: Device,
  sourceInterface: string,
  target: Device,
  targetInterface: string,
): string[] | undefined {
  const queue: string[][] = [[source.id]];
  const visited = new Set([source.id]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const link of lab.links) {
      if (!link.online || (link.source !== current && link.target !== current))
        continue;
      const forward = link.source === current;
      const nextId = forward ? link.target : link.source;
      const leavingInterface = forward
        ? link.sourceInterface
        : link.targetInterface;
      const enteringInterface = forward
        ? link.targetInterface
        : link.sourceInterface;
      if (current === source.id && leavingInterface !== sourceInterface)
        continue;
      const next = lab.devices.find((d) => d.id === nextId);
      if (!next?.online) continue;
      if (next.id === target.id) {
        if (enteringInterface === targetInterface) return [...path, next.id];
        continue;
      }
      if (next.kind !== "switch" || visited.has(next.id)) continue;
      visited.add(next.id);
      queue.push([...path, next.id]);
    }
  }
  return undefined;
}

/** Static addressing and directly connected router networks; no invented routes. */
export function networkRoute(
  lab: LabConfig,
  sourceId: string,
  targetId: string,
  destinationIp?: string,
): string[] {
  const assigned = new Set<string>();
  for (const device of lab.devices.filter((d) => d.online))
    for (const iface of device.interfaces) {
      if (ipv4(iface.ip) === undefined) continue;
      if (assigned.has(iface.ip))
        throw new NetworkError(
          `Conflicto de IP duplicada: ${iface.ip}. Cada interfaz activa necesita una dirección única.`,
        );
      assigned.add(iface.ip);
    }
  const source = lab.devices.find((d) => d.id === sourceId);
  const target = lab.devices.find((d) => d.id === targetId);
  if (!source || !target)
    throw new NetworkError("Equipo de origen o destino inexistente.");
  if (!source.online || !target.online)
    throw new NetworkError(
      "Sin conectividad: uno de los equipos está apagado.",
    );
  if (source.kind === "switch" || target.kind === "switch")
    throw new NetworkError(
      "Este switch no dispone de una interfaz IP de administración.",
    );
  if (source.id === target.id) return [source.id];
  const destination =
    target.interfaces.find((i) => i.ip === destinationIp) ??
    target.interfaces[0];
  if (!interfaceValid(destination))
    throw new NetworkError(
      "La dirección IPv4 o el prefijo del destino no es válido.",
    );
  const sourceInterfaces = source.interfaces.filter(interfaceValid);
  if (!sourceInterfaces.length)
    throw new NetworkError(
      "El origen no tiene una dirección IPv4 y un prefijo válidos.",
    );
  const direct = sourceInterfaces.filter((i) =>
    sameNetwork(destination.ip, i.ip, i.prefix),
  );
  if (direct.length) {
    for (const iface of direct) {
      const route = segment(lab, source, iface.id, target, destination.id);
      if (route) return route;
    }
    throw new NetworkError(
      "Sin enlace en la red local: revisa cables, interfaces y equipos intermedios.",
    );
  }
  if (source.kind === "router")
    throw new NetworkError(
      "El router no tiene una ruta directamente conectada a la red de destino.",
    );
  if (!source.gateway)
    throw new NetworkError(
      "Falta la puerta de enlace para salir de la subred.",
    );
  const gateway = lab.devices.find(
    (d) =>
      d.kind === "router" && d.interfaces.some((i) => i.ip === source.gateway),
  );
  if (!gateway?.online)
    throw new NetworkError(
      "Puerta de enlace inaccesible: debe ser una interfaz de un router encendido.",
    );
  const gatewayInterface = gateway.interfaces.find(
    (i) => i.ip === source.gateway,
  )!;
  if (!interfaceValid(gatewayInterface))
    throw new NetworkError("La interfaz de la puerta de enlace no es válida.");
  for (const iface of sourceInterfaces) {
    if (
      !sameNetwork(source.gateway, iface.ip, iface.prefix) ||
      !sameNetwork(iface.ip, gatewayInterface.ip, gatewayInterface.prefix)
    )
      continue;
    const first = segment(lab, source, iface.id, gateway, gatewayInterface.id);
    if (!first) continue;
    // A router accepts packets addressed to any of its own interfaces locally.
    // Reaching its remote interface address does not require a loop out and back.
    if (gateway.id === target.id) return first;
    for (const outgoing of gateway.interfaces.filter(interfaceValid)) {
      if (!sameNetwork(destination.ip, outgoing.ip, outgoing.prefix)) continue;
      const second = segment(lab, gateway, outgoing.id, target, destination.id);
      if (second) return [...first, ...second.slice(1)];
    }
    throw new NetworkError(
      "El router no dispone de una interfaz conectada a la subred destino o el enlace de salida está caído.",
    );
  }
  throw new NetworkError(
    "La puerta de enlace no está en la subred del origen o no hay un enlace válido hasta ella.",
  );
}
