export type DeviceKind = "client" | "switch" | "router" | "server" | "dns";
export type AppProtocol =
  | "DNS"
  | "HTTP"
  | "HTTPS"
  | "SMTP"
  | "IMAP"
  | "POP3"
  | "FTP"
  | "SFTP"
  | "SSH"
  | "TELNET"
  | "SNMP"
  | "ICMP";
export type Protocol = AppProtocol | "TCP" | "TLS";
export interface NetworkInterface {
  id: string;
  ip: string;
  prefix: number;
}
export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  read: boolean;
}
export interface Service {
  protocol: AppProtocol;
  enabled: boolean;
  port: number;
}
export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  position: { x: number; y: number };
  online: boolean;
  interfaces: NetworkInterface[];
  gateway: string;
  dns: string;
  services: Service[];
  records: Record<string, { ip: string; ttl: number }>;
  resources: Record<string, string>;
  files: Record<string, string>;
  accounts: Record<string, string>;
  mailboxes: Record<string, MailMessage[]>;
  certificateValid: boolean;
}
export interface NetworkLink {
  id: string;
  source: string;
  target: string;
  sourceInterface: string;
  targetInterface: string;
  online: boolean;
}
export interface LabConfig {
  schemaVersion: 1;
  name: string;
  devices: Device[];
  links: NetworkLink[];
}
export interface ProtocolAction {
  protocol: AppProtocol;
  sourceId: string;
  target: string;
  method?: string;
  path?: string;
  body?: string;
  username?: string;
  password?: string;
  from?: string;
  to?: string;
  subject?: string;
  filename?: string;
  content?: string;
  command?: string;
  oid?: string;
}
export interface SimulationEvent {
  id: string;
  traceId: string;
  time: number;
  protocol: Protocol;
  sourceId: string;
  targetId: string;
  sourcePort: number;
  targetPort: number;
  sourceAddress?: string;
  targetAddress?: string;
  route: string[];
  title: string;
  explanation: string;
  payload: string;
  encrypted: boolean;
  status: "ok" | "error" | "info";
  layer: number;
  bytes: number;
}
export interface ActionResult {
  traceId: string;
  protocol: AppProtocol;
  ok: boolean;
  title: string;
  output: string;
  data?: unknown;
  sourceId: string;
  targetId?: string;
}
export interface DeviceRuntime {
  files: Record<string, string>;
  mailboxes: Record<string, MailMessage[]>;
  resources?: Record<string, string>;
  packets: number;
  bytes: number;
}
export interface DnsCacheEntry {
  ip: string;
  expiresAt: number;
}
export interface Session {
  protocol: "FTP" | "SFTP" | "SSH" | "TELNET";
  sourceId: string;
  targetId: string;
  username: string;
}
export interface RuntimeData {
  devices: Record<string, DeviceRuntime>;
  cache: Record<string, Record<string, DnsCacheEntry>>;
  sessions: Record<string, Session>;
}
export interface FaultAction {
  kind: "link" | "service" | "dns" | "credentials" | "certificate";
  targetId: string;
  active: boolean;
  protocol?: AppProtocol;
}
export interface PersistedFault {
  action: FaultAction;
  original: unknown;
}
export interface LabSnapshot {
  schemaVersion: 1;
  lab: LabConfig;
  runtime: RuntimeData;
  faults?: PersistedFault[];
}
export const PROTOCOL_COLORS: Record<Protocol, string> = {
  DNS: "#956322",
  HTTP: "#147ea0",
  HTTPS: "#168269",
  SMTP: "#b25a3b",
  IMAP: "#b25a3b",
  POP3: "#b25a3b",
  FTP: "#5474b5",
  SFTP: "#168269",
  SSH: "#168269",
  TELNET: "#97618b",
  SNMP: "#7664b2",
  ICMP: "#718096",
  TCP: "#718096",
  TLS: "#168269",
};
