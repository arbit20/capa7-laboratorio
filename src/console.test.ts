import { describe, expect, it } from "vitest";
import { parseCommand } from "./console";
import { SimulationEngine } from "./engine";
import { createLab } from "./scenarios";
import type { Session } from "./types";

const lab = createLab();
function parse(command: string, session?: Session) {
  const runtime = new SimulationEngine(lab).getSnapshot().runtime;
  if (session) runtime.sessions.pc1 = session;
  return parseCommand(command, lab, runtime, "pc1");
}
const session = (protocol: Session["protocol"]): Session => ({
  protocol,
  sourceId: "pc1",
  targetId: "srv",
  username: "alumno",
});

describe("Consola simulada: análisis de comandos", () => {
  it("put rechaza nombres de propiedades heredadas que no son archivos", () => {
    const result = parse("put toString", session("FTP"));
    expect(result.action).toBeUndefined();
    expect(result.output).toContain("no existe");
  });
  it("help, clear e ipconfig son herramientas locales", () => {
    expect(parse("help").output).toMatch(/nslookup/);
    expect(parse("clear").clear).toBe(true);
    const ipconfig = parse("ipconfig");
    expect(ipconfig.action).toBeUndefined();
    expect(ipconfig.output).toContain("192.168.10.10");
    expect(ipconfig.output).toContain("192.168.10.1");
    expect(ipconfig.output).toContain("192.168.20.10");
  });
  it("convierte ping y nslookup en acciones de la misma fuente", () => {
    expect(parse("ping 192.168.20.20").action).toMatchObject({
      protocol: "ICMP",
      sourceId: "pc1",
      target: "192.168.20.20",
    });
    expect(parse("nslookup web.aula.test").action).toMatchObject({
      protocol: "DNS",
      sourceId: "pc1",
      target: "web.aula.test",
    });
  });
  it("curl conserva esquema, ruta, método y datos entre comillas", () => {
    expect(parse("curl https://web.aula.test/api/cursos").action).toMatchObject(
      {
        protocol: "HTTPS",
        target: "web.aula.test",
        method: "GET",
        path: "/api/cursos",
      },
    );
    expect(
      parse(
        'curl -X POST -d \'{"mensaje":"Hola clase"}\' http://web.aula.test/api/mensaje',
      ).action,
    ).toMatchObject({
      protocol: "HTTP",
      method: "POST",
      body: '{"mensaje":"Hola clase"}',
      path: "/api/mensaje",
    });
  });
  it.each(["ftp", "sftp", "ssh", "telnet"])(
    "%s acepta usuario y contraseña explícitos",
    (command) => {
      expect(
        parse(`${command} alumno@servidor.aula.test -p incorrecta`).action,
      ).toMatchObject({
        protocol: command.toUpperCase(),
        target: "servidor.aula.test",
        username: "alumno",
        password: "incorrecta",
      });
    },
  );
  it("requiere una sesión apropiada para los comandos internos", () => {
    for (const command of [
      "ls",
      "get redes.txt",
      "put notas.txt",
      "hostname",
      "whoami",
      "cat redes.txt",
    ]) {
      const result = parse(command);
      expect(result.action).toBeUndefined();
      expect(result.output).toBeTruthy();
    }
    expect(parse("get redes.txt", session("SSH")).action).toBeUndefined();
  });
  it("FTP y SFTP usan archivos locales reales al subir y descargar", () => {
    expect(parse("get redes.txt", session("FTP")).action).toMatchObject({
      protocol: "FTP",
      target: "192.168.20.30",
      method: "get",
      filename: "redes.txt",
    });
    const put = parse("put notas.txt", session("SFTP")).action;
    expect(put).toMatchObject({
      protocol: "SFTP",
      method: "put",
      filename: "notas.txt",
    });
    expect(put?.content).toContain("La capa 7");
    expect(parse("ls", session("FTP")).action?.method).toBe("list");
  });
  it("los comandos remotos conservan equipo y protocolo de la sesión", () => {
    expect(parse("cat redes.txt", session("SSH")).action).toMatchObject({
      protocol: "SSH",
      target: "192.168.20.30",
      command: "cat redes.txt",
    });
    expect(parse("whoami", session("TELNET")).action?.protocol).toBe("TELNET");
    expect(parse("exit", session("SSH")).action?.command).toBe("exit");
  });
  it("acepta envío y recuperación de correo y consultas OID", () => {
    expect(
      parse('smtp alumno@aula.test "Saludo de clase" "Mensaje de prueba"')
        .action,
    ).toMatchObject({
      protocol: "SMTP",
      to: "alumno@aula.test",
      subject: "Saludo de clase",
      body: "Mensaje de prueba",
    });
    expect(parse("imap correo.aula.test read welcome").action).toMatchObject({
      protocol: "IMAP",
      method: "read",
      filename: "welcome",
    });
    expect(parse("pop3 correo.aula.test list").action?.protocol).toBe("POP3");
    expect(
      parse("snmpget 192.168.10.1 1.3.6.1.2.1.1.5.0").action,
    ).toMatchObject({ protocol: "SNMP", oid: "1.3.6.1.2.1.1.5.0" });
  });
  it("muestra ayuda ante comandos desconocidos, incompletos o comillas inválidas", () => {
    for (const command of [
      "sudo reboot",
      "curl",
      "nslookup",
      'curl "http://web.aula.test',
    ]) {
      const result = parse(command);
      expect(result.action).toBeUndefined();
      expect(result.output).toBeTruthy();
    }
  });
  it("la acción creada por consola produce el mismo resultado que la herramienta gráfica", () => {
    const consoleEngine = new SimulationEngine(createLab());
    const graphicalEngine = new SimulationEngine(createLab());
    const parsed = parse("curl http://web.aula.test/").action!;
    consoleEngine.enqueue(parsed);
    graphicalEngine.enqueue({
      protocol: "HTTP",
      sourceId: "pc1",
      target: "web.aula.test",
      method: "GET",
      path: "/",
    });
    consoleEngine.runAll();
    graphicalEngine.runAll();
    expect(consoleEngine.getSnapshot().results).toEqual(
      graphicalEngine.getSnapshot().results,
    );
    expect(consoleEngine.getSnapshot().events).toEqual(
      graphicalEngine.getSnapshot().events,
    );
  });
});
