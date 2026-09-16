import { useState } from "react";
import {
  ArrowRight,
  DownloadSimple,
  EnvelopeSimple,
  FileText,
  Folder,
  Globe,
  LockKey,
  MagnifyingGlass,
  PaperPlaneTilt,
  TerminalWindow,
  UploadSimple,
} from "@phosphor-icons/react";
import type { ScenarioId } from "../scenarios";
import type {
  ActionResult,
  AppProtocol,
  LabConfig,
  MailMessage,
  ProtocolAction,
  RuntimeData,
  SimulationEvent,
} from "../types";

interface ToolsPanelProps {
  scenario: ScenarioId;
  lab: LabConfig;
  runtime: RuntimeData;
  results: ActionResult[];
  events: SimulationEvent[];
  sourceId: string;
  pending: number;
  onAction: (action: ProtocolAction) => void;
}

function dataOf(result: ActionResult | undefined): Record<string, unknown> {
  return result?.data && typeof result.data === "object"
    ? (result.data as Record<string, unknown>)
    : {};
}

function Feedback({ result }: { result?: ActionResult }) {
  if (!result) return null;
  return (
    <div
      className={result.ok ? "result-box tool-output" : "error-box tool-output"}
      role="status"
    >
      <strong>{result.title}</strong>
      <pre>{result.output}</pre>
    </div>
  );
}

function Credentials({
  username,
  password,
  setUsername,
  setPassword,
}: {
  username: string;
  password: string;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
}) {
  return (
    <div className="field-row">
      <label className="field">
        <span className="label">Usuario</span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span className="label">Contraseña</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="off"
        />
      </label>
    </div>
  );
}

function ProtocolTabs({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (protocol: string) => void;
}) {
  return (
    <div className="protocol-tabs" aria-label="Elegir protocolo">
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={option === selected ? "active" : ""}
          aria-pressed={option === selected}
          onClick={() => onSelect(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export default function ToolsPanel({
  scenario,
  lab,
  runtime,
  results,
  events,
  sourceId,
  pending,
  onAction,
}: ToolsPanelProps) {
  const [url, setUrl] = useState("http://web.aula.test/");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [httpBody, setHttpBody] = useState('{"mensaje":"Hola desde el aula"}');
  const [localError, setLocalError] = useState("");
  const [dnsName, setDnsName] = useState("web.aula.test");
  const [mailProtocol, setMailProtocol] = useState("IMAP");
  const [from, setFrom] = useState("docente@aula.test");
  const [to, setTo] = useState("alumno@aula.test");
  const [subject, setSubject] = useState("Mi primer mensaje");
  const [mailBody, setMailBody] = useState(
    "¡Hola! Este correo acaba de recorrer la red.",
  );
  const [mailbox, setMailbox] = useState("alumno@aula.test");
  const [fileProtocol, setFileProtocol] = useState("FTP");
  const [fileHost, setFileHost] = useState("archivos.aula.test");
  const [filename, setFilename] = useState("notas.txt");
  const [fileContent, setFileContent] = useState(
    "La capa 7 conecta las aplicaciones con los servicios de red.",
  );
  const [remoteProtocol, setRemoteProtocol] = useState("SSH");
  const [remoteHost, setRemoteHost] = useState("servidor.aula.test");
  const [remoteCommand, setRemoteCommand] = useState("hostname");
  const [snmpHost, setSnmpHost] = useState("192.168.10.1");
  const [oid, setOid] = useState("1.3.6.1.2.1.1.5.0");
  const [username, setUsername] = useState("alumno");
  const [password, setPassword] = useState("redes123");

  const latest = (...protocols: AppProtocol[]) =>
    results
      .filter(
        (result) =>
          result.sourceId === sourceId && protocols.includes(result.protocol),
      )
      .at(-1);
  const send = (action: Omit<ProtocolAction, "sourceId">) => {
    setLocalError("");
    onAction({ ...action, sourceId });
  };
  const auth = { username, password };
  const credentials = (
    <Credentials
      {...auth}
      setUsername={setUsername}
      setPassword={setPassword}
    />
  );
  const sourceName =
    lab.devices.find((device) => device.id === sourceId)?.name ?? "Equipo";
  const activeSession = runtime.sessions[sourceId];
  const sourceFiles = runtime.devices[sourceId]?.files ?? {};
  const webResult = latest("HTTP", "HTTPS");
  const webData = dataOf(webResult);
  const webBody = typeof webData.body === "string" ? webData.body : "";
  const dnsResult = latest("DNS");
  const dnsData = dataOf(dnsResult);
  const mailResult = latest("IMAP", "POP3");
  const mailData = dataOf(mailResult);
  const mailListing = results
    .filter(
      (result) =>
        result.sourceId === sourceId &&
        (result.protocol === "IMAP" || result.protocol === "POP3") &&
        Array.isArray(dataOf(result).messages),
    )
    .at(-1);
  const mailMessages = (
    Array.isArray(dataOf(mailListing).messages)
      ? (dataOf(mailListing).messages as MailMessage[])
      : []
  )
    .filter((message) => message.to === mailbox)
    .map((message) => {
      const current = mailListing?.targetId
        ? runtime.devices[mailListing.targetId]?.mailboxes[mailbox]?.find(
            (item) => item.id === message.id,
          )
        : undefined;
      return current ? { ...message, read: current.read } : message;
    });
  const readMessage =
    mailData.message && typeof mailData.message === "object"
      ? (mailData.message as MailMessage)
      : undefined;
  const listingResult = results
    .filter(
      (result) =>
        result.sourceId === sourceId &&
        (result.protocol === "FTP" || result.protocol === "SFTP") &&
        Array.isArray(dataOf(result).files),
    )
    .at(-1);
  const remoteFiles = Array.isArray(dataOf(listingResult).files)
    ? (dataOf(listingResult).files as string[])
    : [];
  const fileResult = latest("FTP", "SFTP");
  const fileEvent = events
    .filter(
      (event) =>
        event.sourceId === sourceId &&
        (event.protocol === "FTP" || event.protocol === "SFTP"),
    )
    .at(-1);
  const snmpResult = latest("SNMP");
  const snmpData = dataOf(snmpResult);
  const numericSnmp =
    typeof snmpData.value === "number"
      ? snmpData.value
      : Number(snmpData.value);
  const previousSnmp = results
    .filter(
      (result) =>
        result.sourceId === sourceId &&
        result.protocol === "SNMP" &&
        result.ok &&
        dataOf(result).oid === snmpData.oid,
    )
    .slice(-8);

  const submitWeb = () => {
    try {
      const parsed = new URL(url.includes("://") ? url : `http://${url}`);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        (parsed.port &&
          parsed.port !== (parsed.protocol === "https:" ? "443" : "80"))
      )
        throw new Error();
      send({
        protocol: parsed.protocol === "https:" ? "HTTPS" : "HTTP",
        target: parsed.hostname,
        method: httpMethod,
        path: parsed.pathname + parsed.search,
        ...(httpMethod === "POST" ? { body: httpBody } : {}),
      });
    } catch {
      setLocalError(
        "Usa una URL del laboratorio: http://web.aula.test/ o https://web.aula.test/",
      );
    }
  };
  const fileAction = (method: string, name?: string) =>
    send({
      protocol: fileProtocol as "FTP" | "SFTP",
      target: fileHost,
      ...auth,
      method,
      ...(name ? { filename: name } : {}),
      ...(method === "put" ? { content: fileContent } : {}),
    });
  const mailAction = (method: string, id?: string) =>
    send({
      protocol: mailProtocol as "IMAP" | "POP3",
      target: "correo.aula.test",
      ...auth,
      to: mailbox,
      method,
      ...(id ? { filename: id } : {}),
    });

  return (
    <div className="tool-panel">
      <div className="tool-origin muted">
        Origen: <strong>{sourceName}</strong>
      </div>
      {pending > 0 && (
        <div className="tool-progress" role="status">
          <progress aria-label="Operaciones en curso" />
          <span>
            {pending}{" "}
            {pending === 1 ? "operación pendiente" : "operaciones pendientes"} ·
            observa el flujo
          </span>
        </div>
      )}

      {scenario === "web" && (
        <section className="tool-section" aria-label="Navegador web">
          <div className="tool-heading">
            <Globe size={20} />
            <h3>Navegador web</h3>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitWeb();
            }}
          >
            <label className="field">
              <span className="label">Dirección web</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="http://web.aula.test/"
                spellCheck={false}
                required
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="label">Método</span>
                <select
                  value={httpMethod}
                  onChange={(event) => setHttpMethod(event.target.value)}
                >
                  <option>GET</option>
                  <option>POST</option>
                </select>
              </label>
              <button type="submit" className="primary-button">
                <ArrowRight size={17} />
                Enviar solicitud
              </button>
            </div>
            {httpMethod === "POST" && (
              <label className="field">
                <span className="label">Datos de la solicitud</span>
                <textarea
                  value={httpBody}
                  onChange={(event) => setHttpBody(event.target.value)}
                  rows={3}
                />
              </label>
            )}
          </form>
          <div className="protocol-tabs">
            <button
              type="button"
              onClick={() => setUrl("http://web.aula.test/")}
            >
              Página HTTP
            </button>
            <button
              type="button"
              onClick={() => setUrl("https://web.aula.test/api/cursos")}
            >
              <LockKey size={13} /> API HTTPS
            </button>
          </div>
          {localError && (
            <p className="error-box" role="alert">
              {localError}
            </p>
          )}
          <div className="mini-browser">
            <div className="browser-bar">
              <Globe size={14} />
              <span>
                {webResult
                  ? `${webResult.protocol} · ${String(webData.status ?? (webResult.ok ? "OK" : "Error"))}`
                  : "Esperando una respuesta"}
              </span>
            </div>
            {webBody ? (
              <iframe
                title="Página web recibida"
                sandbox=""
                srcDoc={`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{font:14px/1.6 system-ui,sans-serif;padding:14px;color:#18363d;overflow-wrap:anywhere;margin:0}h1{font-size:23px;line-height:1.2}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>${webBody.trim().startsWith("<") ? webBody : `<pre>${webBody.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`}</body></html>`}
              />
            ) : (
              <div className="browser-placeholder">
                <Globe size={34} />
                <p>
                  La página aparecerá después de completar el recorrido de ida y
                  vuelta.
                </p>
              </div>
            )}
          </div>
          {webResult && (
            <details className="tool-output">
              <summary>Cabeceras y respuesta HTTP</summary>
              <pre>
                {webData.headers
                  ? JSON.stringify(webData.headers, null, 2)
                  : webResult.output}
              </pre>
              {webData.body !== undefined && <pre>{String(webData.body)}</pre>}
            </details>
          )}
          {!webResult?.ok && <Feedback result={webResult} />}
        </section>
      )}

      {scenario === "dns" && (
        <section className="tool-section" aria-label="Consulta DNS">
          <div className="tool-heading">
            <MagnifyingGlass size={20} />
            <h3>Resolver un nombre</h3>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send({ protocol: "DNS", target: dnsName.trim() });
            }}
          >
            <label className="field">
              <span className="label">Nombre de dominio</span>
              <input
                value={dnsName}
                onChange={(event) => setDnsName(event.target.value)}
                spellCheck={false}
                required
              />
            </label>
            <button type="submit" className="primary-button">
              <MagnifyingGlass size={17} />
              Consultar DNS
            </button>
          </form>
          {dnsResult?.ok && (
            <div className="dns-resolution result-box">
              <span>Nombre resuelto</span>
              <ArrowRight size={22} />
              <strong className="mono">{String(dnsData.ip ?? "")}</strong>
              <div className="field-row">
                <span className="metric">
                  TTL <strong>{String(dnsData.ttl ?? "—")} s</strong>
                </span>
                <span className="metric">
                  Origen{" "}
                  <strong>
                    {dnsData.cached ? "Caché del cliente" : "Servidor DNS"}
                  </strong>
                </span>
              </div>
            </div>
          )}
          <Feedback result={dnsResult} />
          <h4>Caché del equipo</h4>
          {Object.entries(runtime.cache[sourceId] ?? {}).length ? (
            Object.entries(runtime.cache[sourceId] ?? {}).map(
              ([name, entry]) => (
                <div className="file-item" key={name}>
                  <span>
                    <strong>{name}</strong>
                    <br />
                    <span className="mono muted">{entry.ip}</span>
                  </span>
                </div>
              ),
            )
          ) : (
            <p className="muted">
              Todavía no hay nombres guardados. Consulta dos veces para comparar
              el recorrido.
            </p>
          )}
        </section>
      )}

      {scenario === "mail" && (
        <section className="tool-section" aria-label="Cliente de correo">
          <div className="tool-heading">
            <EnvelopeSimple size={20} />
            <h3>Cliente de correo</h3>
          </div>
          {credentials}
          <details open>
            <summary>Redactar · SMTP</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send({
                  protocol: "SMTP",
                  target: "correo.aula.test",
                  ...auth,
                  from,
                  to,
                  subject,
                  body: mailBody,
                });
              }}
            >
              <label className="field">
                <span className="label">De</span>
                <input
                  type="email"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="label">Para</span>
                <input
                  type="email"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="label">Asunto</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="label">Mensaje</span>
                <textarea
                  value={mailBody}
                  onChange={(event) => setMailBody(event.target.value)}
                  rows={3}
                  required
                />
              </label>
              <button type="submit" className="primary-button">
                <PaperPlaneTilt size={17} />
                Enviar correo
              </button>
            </form>
            <Feedback result={latest("SMTP")} />
          </details>
          <div className="tool-section">
            <h4>Bandeja de entrada</h4>
            <ProtocolTabs
              options={["IMAP", "POP3"]}
              selected={mailProtocol}
              onSelect={setMailProtocol}
            />
            <label className="field">
              <span className="label">Buzón</span>
              <input
                type="email"
                value={mailbox}
                onChange={(event) => setMailbox(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => mailAction("list")}
            >
              <DownloadSimple size={16} />
              Consultar bandeja
            </button>
            <p className="muted">
              {mailProtocol === "IMAP"
                ? "IMAP sincroniza el buzón y conserva el estado de lectura."
                : "POP3 descarga una copia y conserva el original en esta práctica."}
            </p>
            {mailMessages.map((message) => (
              <button
                type="button"
                className={`mail-item ${message.read ? "read" : "unread"}`}
                key={message.id}
                onClick={() => mailAction("read", message.id)}
              >
                <EnvelopeSimple size={18} />
                <span>
                  <strong>{message.subject}</strong>
                  <small>{message.from}</small>
                  <small>
                    {message.read ? "Leído" : "Sin leer"} · {message.id}
                  </small>
                </span>
              </button>
            ))}
            {mailResult?.ok &&
              Array.isArray(mailData.messages) &&
              !mailMessages.length && (
                <p className="muted">El buzón está vacío.</p>
              )}
            {readMessage && readMessage.to === mailbox && (
              <article className="result-box mail-preview">
                <strong>{readMessage.subject}</strong>
                <p className="muted">
                  {readMessage.from} → {readMessage.to}
                </p>
                <p>{readMessage.body}</p>
              </article>
            )}
            <Feedback result={mailResult} />
          </div>
        </section>
      )}

      {scenario === "files" && (
        <section
          className="tool-section"
          aria-label="Transferencia de archivos"
        >
          <div className="tool-heading">
            <Folder size={20} />
            <h3>Transferir archivos</h3>
          </div>
          <ProtocolTabs
            options={["FTP", "SFTP"]}
            selected={fileProtocol}
            onSelect={setFileProtocol}
          />
          <label className="field">
            <span className="label">Servidor de archivos</span>
            <input
              value={fileHost}
              onChange={(event) => setFileHost(event.target.value)}
              spellCheck={false}
            />
          </label>
          {credentials}
          <div className="field-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileAction("open")}
            >
              Conectar
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileAction("list")}
            >
              Listar servidor
            </button>
          </div>
          <div className="file-columns">
            <div>
              <h4>En este PC</h4>
              {Object.entries(sourceFiles).map(([name, content]) => (
                <button
                  type="button"
                  className="file-item"
                  key={name}
                  onClick={() => {
                    setFilename(name);
                    setFileContent(content);
                  }}
                >
                  <FileText size={17} />
                  <span>
                    {name}
                    <small>
                      {new TextEncoder().encode(content).length} bytes
                    </small>
                  </span>
                </button>
              ))}
              {!Object.keys(sourceFiles).length && (
                <p className="muted">Sin archivos locales.</p>
              )}
            </div>
            <div>
              <h4>En el servidor</h4>
              {remoteFiles.map((name) => (
                <button
                  type="button"
                  className="file-item"
                  key={name}
                  onClick={() => fileAction("get", name)}
                  title={`Descargar ${name}`}
                >
                  <DownloadSimple size={17} />
                  <span>{name}</span>
                </button>
              ))}
              {!listingResult && (
                <p className="muted">
                  Pulsa «Listar servidor» para consultar sus archivos.
                </p>
              )}
              {listingResult && !remoteFiles.length && (
                <p className="muted">Directorio vacío.</p>
              )}
            </div>
          </div>
          <label className="field">
            <span className="label">Nombre del archivo</span>
            <input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="label">Contenido para subir</span>
            <textarea
              value={fileContent}
              onChange={(event) => setFileContent(event.target.value)}
              rows={3}
            />
          </label>
          <div className="field-row">
            <button
              type="button"
              className="primary-button"
              disabled={!filename.trim()}
              onClick={() => fileAction("put", filename.trim())}
            >
              <UploadSimple size={17} />
              Subir
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!filename.trim()}
              onClick={() => fileAction("get", filename.trim())}
            >
              <DownloadSimple size={17} />
              Descargar
            </button>
          </div>
          {fileEvent && (
            <p className="muted" aria-live="polite">
              Último paso: {fileEvent.title}
            </p>
          )}
          <Feedback result={fileResult} />
          {typeof dataOf(fileResult).content === "string" && (
            <details className="tool-output" open>
              <summary>
                Contenido del archivo · {String(dataOf(fileResult).filename)}
              </summary>
              <pre>{String(dataOf(fileResult).content)}</pre>
            </details>
          )}
        </section>
      )}

      {scenario === "remote" && (
        <section className="tool-section" aria-label="Acceso remoto">
          <div className="tool-heading">
            <TerminalWindow size={20} />
            <h3>Terminal remota</h3>
          </div>
          <ProtocolTabs
            options={["SSH", "TELNET"]}
            selected={remoteProtocol}
            onSelect={setRemoteProtocol}
          />
          <label className="field">
            <span className="label">Equipo remoto</span>
            <input
              value={remoteHost}
              onChange={(event) => setRemoteHost(event.target.value)}
              spellCheck={false}
            />
          </label>
          {credentials}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send({
                protocol: remoteProtocol as "SSH" | "TELNET",
                target: remoteHost,
                ...auth,
                command: remoteCommand,
              });
            }}
          >
            <label className="field">
              <span className="label">Comando remoto</span>
              <input
                value={remoteCommand}
                onChange={(event) => setRemoteCommand(event.target.value)}
                spellCheck={false}
                required
              />
            </label>
            <div className="protocol-tabs">
              {["hostname", "whoami", "ls", "cat bienvenida.txt"].map(
                (command) => (
                  <button
                    type="button"
                    key={command}
                    onClick={() => setRemoteCommand(command)}
                  >
                    {command}
                  </button>
                ),
              )}
            </div>
            <button type="submit" className="primary-button">
              <TerminalWindow size={17} />
              Ejecutar comando
            </button>
          </form>
          <p className="muted">
            {remoteProtocol === "SSH"
              ? "SSH protege el contenido del canal durante el recorrido."
              : "Telnet transmite el contenido sin cifrado: examina los datos del evento."}
          </p>
          {activeSession && (
            <div className="result-box">
              Sesión {activeSession.protocol} · {activeSession.username}
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  send({
                    protocol: activeSession.protocol,
                    target:
                      lab.devices.find(
                        (device) => device.id === activeSession.targetId,
                      )?.interfaces[0]?.ip ?? remoteHost,
                    username: activeSession.username,
                    ...(activeSession.protocol === "FTP" ||
                    activeSession.protocol === "SFTP"
                      ? { method: "exit" }
                      : { command: "exit" }),
                  })
                }
              >
                Cerrar sesión
              </button>
            </div>
          )}
          <Feedback result={latest("SSH", "TELNET")} />
        </section>
      )}

      {scenario === "snmp" && (
        <section className="tool-section" aria-label="Monitor SNMP">
          <div className="tool-heading">
            <MagnifyingGlass size={20} />
            <h3>Monitor del dispositivo</h3>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send({ protocol: "SNMP", target: snmpHost, oid });
            }}
          >
            <label className="field">
              <span className="label">Dispositivo</span>
              <input
                value={snmpHost}
                onChange={(event) => setSnmpHost(event.target.value)}
                spellCheck={false}
                required
              />
            </label>
            <label className="field">
              <span className="label">Dato / OID</span>
              <select
                value={oid}
                onChange={(event) => setOid(event.target.value)}
              >
                <option value="1.3.6.1.2.1.1.5.0">Nombre · sysName</option>
                <option value="1.3.6.1.2.1.1.3.0">
                  Tiempo activo · sysUpTime
                </option>
                <option value="1.3.6.1.2.1.2.2.1.10.1">
                  Bytes recibidos · ifInOctets
                </option>
                <option value="1.3.6.1.2.1.2.2.1.11.1">
                  Paquetes recibidos · ifInUcastPkts
                </option>
              </select>
            </label>
            <p className="mono muted">{oid}</p>
            <button type="submit" className="primary-button">
              <MagnifyingGlass size={17} />
              Consultar dispositivo
            </button>
          </form>
          {snmpResult?.ok && (
            <div className="result-box snmp-metric">
              <span className="muted">Valor recibido</span>
              <strong className="metric-value">
                {String(snmpData.value ?? "")}
              </strong>
              <span className="mono muted">{String(snmpData.oid ?? oid)}</span>
              {Number.isFinite(numericSnmp) && (
                <div
                  className="snmp-bars"
                  role="img"
                  aria-label={`Últimas consultas: ${previousSnmp.map((result) => String(dataOf(result).value)).join(", ")}`}
                >
                  {previousSnmp.map((result) => {
                    const value = Number(dataOf(result).value);
                    const maximum = Math.max(
                      1,
                      ...previousSnmp.map(
                        (item) => Number(dataOf(item).value) || 0,
                      ),
                    );
                    return (
                      <div
                        key={result.traceId}
                        className="snmp-bar"
                        title={String(value)}
                        style={{
                          height: `${Math.max(5, (value / maximum) * 100)}%`,
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <Feedback result={snmpResult} />
        </section>
      )}
    </div>
  );
}
