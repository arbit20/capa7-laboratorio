import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const test = base.extend<{ applicationErrors: string[]; externalRequests: string[] }>({
  applicationErrors: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const sandboxDiagnostics: string[] = [];
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Chromium puede informar esta restricción al inspeccionar/remontar srcDoc.
      // Se conserva como evidencia; no se permite ejecutar scripts en el navegador simulado.
      if (message.text() === "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.") sandboxDiagnostics.push(message.text());
      else errors.push(message.text());
    });
    await use(errors);
    if (sandboxDiagnostics.length) await testInfo.attach('diagnosticos-aislamiento-iframe', { body: JSON.stringify(sandboxDiagnostics, null, 2), contentType: 'application/json' });
    expect(errors, 'La aplicación no debe producir errores JavaScript ni de consola').toEqual([]);
  }, { auto: true }],
  externalRequests: [async ({ context }, use) => {
    const external: string[] = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
          external.push(url.toString());
          await route.abort('internetdisconnected');
          return;
        }
      }
      await route.continue();
    });
    await use(external);
    expect(external, 'Todos los recursos y escenarios deben funcionar sin conexiones externas').toEqual([]);
  }, { auto: true }],
});

const results = (page: Page) => page.getByTestId('terminal-output').locator('pre.terminal-success, pre.terminal-error');
const tools = (page: Page) => page.locator('.right-panel');

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Navegación web', exact: true })).toBeVisible();
  await expect(page.getByTestId('device-pc1')).toBeVisible();
  await page.getByLabel('Velocidad de simulación').selectOption('4');
}

async function selectScenario(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Escenarios' }).getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function runAction(page: Page, trigger: () => Promise<unknown>, expected: RegExp | string) {
  await page.getByRole('button', { name: 'Consola', exact: true }).click();
  const count = await results(page).count();
  await trigger();
  await expect(results(page)).toHaveCount(count + 1, { timeout: 30_000 });
  await expect(results(page).last()).toContainText(expected);
  await expect(page.locator('.pending-label')).toHaveText('Motor en reposo');
}

async function command(page: Page, value: string, expected: RegExp | string) {
  await runAction(page, async () => {
    await page.getByLabel('Comando de consola').fill(value);
    await page.getByLabel('Comando de consola').press('Enter');
  }, expected);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string, animations: 'disabled' | 'allow' = 'disabled') {
  const directory = path.resolve('evidence', 'screenshots', testInfo.project.name);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${name}.png`);
  await page.screenshot({ path: destination, fullPage: true, animations });
  await testInfo.attach(name, { path: destination, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => ready(page));

test.afterEach(async ({ page }, testInfo) => {
  if (!page.isClosed()) {
    const title = testInfo.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    await screenshot(page, testInfo, title);
  }
});

test('01 · laboratorio inicial legible sin errores ni desbordamiento', async ({ page }, testInfo) => {
  await expect(page.getByRole('navigation', { name: 'Escenarios' }).getByRole('button')).toHaveCount(6);
  await expect(page.locator('[data-testid^="device-"]')).toHaveCount(8);
  await expect(page.getByLabel('Comando de consola')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar flujo', exact: true })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    width: window.innerWidth, height: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    canvasHeight: document.querySelector('[data-testid="topology"]')!.getBoundingClientRect().height,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.canvasHeight).toBeGreaterThan(180);
  await screenshot(page, testInfo, 'initial');
});

test('02 · DNS resuelve y HTTP entrega una página real', async ({ page }, testInfo) => {
  await runAction(page, () => page.getByTestId('start-flow').click(), /HTTP · 200 OK/);
  await expect(page.locator('iframe[title="Página web recibida"]')).toHaveAttribute('sandbox', '');
  await expect(page.frameLocator('iframe[title="Página web recibida"]').locator('script')).toHaveCount(0);
  await expect(page.frameLocator('iframe[title="Página web recibida"]').getByRole('heading', { name: '¡Hola, capa 7!' })).toBeVisible();
  await page.getByRole('button', { name: /Línea temporal/ }).click();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows.filter({ hasText: 'DNS' })).toHaveCount(2);
  await expect(rows.filter({ hasText: /HTTP · GET/ })).toHaveCount(1);
  await rows.filter({ hasText: /HTTP · GET/ }).click();
  await expect(page.getByTestId('payload')).toContainText('GET / HTTP/1.1');
  await expect(page.getByTestId('payload')).toContainText('Host: web.aula.test');
  await page.getByRole('button', { name: 'Ver detalle técnico' }).click();
  await expect(tools(page).locator('.technical-details')).toContainText('Router · Campus');
  await page.getByRole('tab', { name: 'Aplicación', exact: true }).click();
  await screenshot(page, testInfo, 'web');
});

test('03 · HTTPS muestra datos en el extremo y los protege en tránsito', async ({ page }, testInfo) => {
  await page.getByLabel('Dirección web').fill('https://web.aula.test/api/cursos');
  await runAction(page, () => page.getByRole('button', { name: 'Enviar solicitud' }).click(), /HTTPS · 200 OK/);
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await expect(page.getByTestId('payload')).toContainText('HTTP/1.1 200 OK');
  await expect(page.getByTestId('payload')).toContainText('Sistemas de Comunicaciones');
  await page.getByRole('button', { name: 'En tránsito', exact: true }).click();
  await expect(page.getByTestId('payload')).toContainText('Contenido cifrado');
  await expect(page.getByTestId('payload')).not.toContainText('Sistemas de Comunicaciones');
  await expect(page.getByTestId('payload')).not.toContainText('HTTP/1.1');
  await screenshot(page, testInfo, 'encrypted');
  await page.getByRole('button', { name: 'En el equipo', exact: true }).click();
  await expect(page.getByTestId('payload')).toContainText('Sistemas de Comunicaciones');
});

test('04 · DNS repite la consulta desde la caché y muestra TTL', async ({ page }) => {
  await selectScenario(page, 'Resolución DNS');
  await runAction(page, () => page.getByRole('button', { name: 'Consultar DNS', exact: true }).click(), '192.168.20.20');
  await expect(tools(page).locator('.dns-resolution')).toContainText('Servidor DNS');
  await expect(tools(page).locator('.dns-resolution')).toContainText('60 s');
  await runAction(page, () => page.getByRole('button', { name: 'Consultar DNS', exact: true }).click(), '192.168.20.20');
  await expect(tools(page).locator('.dns-resolution')).toContainText('Caché del cliente');
  await expect(tools(page)).toContainText('web.aula.test');
});

test('05 · SMTP entrega y el mismo correo se lee con IMAP y POP3', async ({ page }, testInfo) => {
  await selectScenario(page, 'Correo electrónico');
  await page.getByLabel('Asunto', { exact: true }).fill('Correo de prueba E2E');
  await page.getByRole('textbox', { name: 'Mensaje', exact: true }).fill('El correo viajó entre aplicaciones.');
  await runAction(page, () => page.getByRole('button', { name: 'Enviar correo', exact: true }).click(), /SMTP · Correo entregado/);
  await runAction(page, () => page.getByRole('button', { name: 'Consultar bandeja', exact: true }).click(), 'Correo de prueba E2E');
  await runAction(page, () => page.getByRole('button', { name: /Correo de prueba E2E.*Sin leer/ }).click(), /IMAP · Mensaje leído y sincronizado/);
  await expect(tools(page).locator('.mail-preview')).toContainText('El correo viajó entre aplicaciones.');
  await expect(page.getByRole('button', { name: /Correo de prueba E2E.*Leído/ })).toBeVisible();
  await screenshot(page, testInfo, 'mail');
  await page.getByRole('button', { name: 'POP3', exact: true }).click();
  await runAction(page, () => page.getByRole('button', { name: 'Consultar bandeja', exact: true }).click(), /POP3 · 2 mensajes/);
  await runAction(page, () => page.getByRole('button', { name: /Correo de prueba E2E.*Leído/ }).click(), /POP3 · Mensaje descargado; original conservado/);
  await expect(tools(page).locator('.mail-preview')).toContainText('El correo viajó entre aplicaciones.');
});

test('06 · FTP descarga y SFTP sube el contenido visible del archivo', async ({ page }, testInfo) => {
  await selectScenario(page, 'Transferencia de archivos');
  await page.getByLabel('Nombre del archivo', { exact: true }).fill('bienvenida.txt');
  await runAction(page, () => page.getByRole('button', { name: 'Descargar', exact: true }).click(), /FTP · Archivo descargado/);
  await expect(tools(page).getByRole('button', { name: /bienvenida.txt.*bytes/ })).toBeVisible();
  await expect(tools(page).getByText('Contenido del archivo · bienvenida.txt')).toBeVisible();
  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await page.getByLabel('Nombre del archivo', { exact: true }).fill('prueba-e2e.txt');
  await page.getByRole('textbox', { name: 'Contenido para subir', exact: true }).fill('Datos creados desde la interfaz gráfica.');
  await runAction(page, () => page.getByRole('button', { name: 'Subir', exact: true }).click(), /SFTP · Archivo subido/);
  await runAction(page, () => page.getByRole('button', { name: 'Listar servidor', exact: true }).click(), /prueba-e2e.txt/);
  await runAction(page, () => tools(page).getByRole('button', { name: 'prueba-e2e.txt', exact: true }).click(), /SFTP · Archivo descargado/);
  await expect(tools(page).getByRole('button', { name: /prueba-e2e.txt.*bytes/ })).toBeVisible();
  await expect(tools(page).locator('.tool-output').last()).toContainText('Datos creados desde la interfaz gráfica.');
  await screenshot(page, testInfo, 'files');
});

test('07 · SSH y Telnet comparten resultados con distinta protección', async ({ page }) => {
  await selectScenario(page, 'Acceso remoto');
  await runAction(page, () => tools(page).getByRole('button', { name: 'Ejecutar comando', exact: true }).click(), /SSH · Comando completado/);
  await expect(results(page).last()).toContainText('Servidor de Aplicaciones');
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.getByRole('button', { name: 'En tránsito', exact: true }).click();
  await expect(page.getByTestId('payload')).toContainText('Contenido cifrado');
  await page.getByRole('tab', { name: 'Aplicación', exact: true }).click();
  await page.getByRole('button', { name: 'TELNET', exact: true }).click();
  await runAction(page, () => tools(page).getByRole('button', { name: 'Ejecutar comando', exact: true }).click(), /TELNET · Comando completado/);
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  await page.getByRole('button', { name: 'En tránsito', exact: true }).click();
  await expect(page.getByTestId('payload')).toContainText('Servidor de Aplicaciones');
  await expect(page.getByTestId('payload')).not.toContainText('Contenido cifrado');
});

test('08 · SNMP devuelve identidad y contadores crecientes', async ({ page }) => {
  await selectScenario(page, 'Monitoreo de red');
  await runAction(page, () => page.getByRole('button', { name: 'Consultar dispositivo', exact: true }).click(), 'Router · Campus');
  await expect(tools(page).locator('.metric-value')).toHaveText('Router · Campus');
  await page.getByRole('combobox', { name: 'Dato / OID', exact: true }).selectOption('1.3.6.1.2.1.2.2.1.11.1');
  await runAction(page, () => page.getByRole('button', { name: 'Consultar dispositivo', exact: true }).click(), 'Counter32');
  const first = Number(await tools(page).locator('.metric-value').textContent());
  await runAction(page, () => page.getByRole('button', { name: 'Consultar dispositivo', exact: true }).click(), 'Counter32');
  const second = Number(await tools(page).locator('.metric-value').textContent());
  expect(first).toBeGreaterThan(0);
  expect(second).toBeGreaterThan(first);
  await expect(tools(page).getByRole('img', { name: /Últimas consultas/ })).toBeVisible();
  await expect(tools(page).locator('.snmp-bar')).toHaveCount(2);
});

test('09 · avanzar ejecuta un evento y la pausa mantiene el tiempo congelado', async ({ page }) => {
  await page.clock.install();
  await page.getByRole('button', { name: 'Avanzar un evento', exact: true }).click();
  await expect(page.getByRole('button', { name: /Línea temporal/ })).toContainText('1');
  await expect(page.locator('.simulation-state')).toHaveText('En pausa');
  const firstTime = await page.locator('.logical-time').textContent();
  await page.clock.runFor(5_000);
  await expect(page.getByRole('button', { name: /Línea temporal/ })).toContainText('1');
  await expect(page.locator('.logical-time')).toHaveText(firstTime!);
  await page.getByRole('button', { name: 'Avanzar un evento', exact: true }).click();
  await expect(page.getByRole('button', { name: /Línea temporal/ })).toContainText('2');
  await page.getByRole('button', { name: 'Reproducir simulación', exact: true }).click();
  await page.clock.runFor(450);
  await page.getByRole('button', { name: 'Pausar simulación', exact: true }).click();
  const stoppedCount = await page.getByRole('button', { name: /Línea temporal/ }).textContent();
  const stoppedTime = await page.locator('.logical-time').textContent();
  await page.clock.runFor(5_000);
  await expect(page.getByRole('button', { name: /Línea temporal/ })).toHaveText(stoppedCount!);
  await expect(page.locator('.logical-time')).toHaveText(stoppedTime!);
});

test('10 · una puerta de enlace incorrecta rompe la ruta y corregirla recupera el flujo', async ({ page }) => {
  await page.getByRole('button', { name: 'Configurar PC · Estudiante', exact: true }).click();
  await page.getByLabel('Puerta de enlace', { exact: true }).fill('192.168.10.254');
  await page.getByRole('button', { name: 'Aplicar configuración', exact: true }).click();
  await command(page, 'ping 192.168.20.20', /puerta de enlace|gateway|ruta/i);
  await expect(results(page).last()).toHaveClass('terminal-error');
  await page.getByLabel('Puerta de enlace', { exact: true }).fill('192.168.10.1');
  await page.getByRole('button', { name: 'Aplicar configuración', exact: true }).click();
  await command(page, 'ping 192.168.20.20', 'Destino alcanzable por IP');
  await expect(results(page).last()).toHaveClass('terminal-success');
  await page.getByRole('tab', { name: 'Aplicación', exact: true }).click();
  await runAction(page, () => page.getByTestId('start-flow').click(), /HTTP · 200 OK/);
});

test('11 · un servicio caído conserva IP y se recupera al corregir el fallo', async ({ page }) => {
  await page.getByRole('button', { name: 'Fallos', exact: true }).click();
  await page.getByRole('button', { name: /Servicio HTTP apagado/ }).click();
  await page.getByRole('button', { name: 'Cerrar fallos', exact: true }).click();
  await command(page, 'ping 192.168.20.20', 'Destino alcanzable por IP');
  await runAction(page, () => page.getByTestId('start-flow').click(), /apagado|deshabilitado|servicio|disponible|rechaz/i);
  await expect(results(page).last()).toHaveClass('terminal-error');
  await page.getByRole('button', { name: 'Fallos', exact: true }).click();
  await page.getByRole('button', { name: /Servicio HTTP apagado/ }).click();
  await page.getByRole('button', { name: 'Cerrar fallos', exact: true }).click();
  await runAction(page, () => page.getByTestId('start-flow').click(), /HTTP · 200 OK/);
});

test('12 · exportar importar y recargar conserva archivos de aplicación', async ({ page }, testInfo) => {
  await selectScenario(page, 'Transferencia de archivos');
  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await page.getByLabel('Nombre del archivo', { exact: true }).fill('persistencia-e2e.txt');
  await page.getByRole('textbox', { name: 'Contenido para subir', exact: true }).fill('Este contenido debe sobrevivir a la recarga.');
  await runAction(page, () => page.getByRole('button', { name: 'Subir', exact: true }).click(), /SFTP · Archivo subido/);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar laboratorio', exact: true }).click();
  const exported = await downloading;
  const file = testInfo.outputPath('laboratorio-exportado.json');
  await exported.saveAs(file);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  expect(saved.schemaVersion).toBe(1);
  expect(saved.runtime.devices.srv.files['persistencia-e2e.txt']).toBe('Este contenido debe sobrevivir a la recarga.');
  await page.getByRole('button', { name: 'Restaurar escenario', exact: true }).click();
  await expect(results(page)).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText('Laboratorio importado y detenido.', { exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const stored = localStorage.getItem('capa7.laboratorio.v1');
    return stored ? JSON.parse(stored).runtime.devices.srv.files['persistencia-e2e.txt'] : undefined;
  })).toBe('Este contenido debe sobrevivir a la recarga.');
  await page.reload();
  await page.getByLabel('Velocidad de simulación').selectOption('4');
  await selectScenario(page, 'Transferencia de archivos');
  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await runAction(page, () => page.getByRole('button', { name: 'Listar servidor', exact: true }).click(), 'persistencia-e2e.txt');
  await runAction(page, () => tools(page).getByRole('button', { name: 'persistencia-e2e.txt', exact: true }).click(), 'Este contenido debe sobrevivir a la recarga.');
});

test('13 · consola con ayuda historial autocompletado y rechazo de órdenes externas', async ({ page }) => {
  const input = page.getByLabel('Comando de consola');
  await input.fill('nsloo');
  await input.press('Tab');
  await expect(input).toHaveValue('nslookup ');
  await command(page, 'nslookup web.aula.test', '192.168.20.20');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('nslookup web.aula.test');
  await input.fill('ipconfig'); await input.press('Enter');
  await expect(page.getByTestId('terminal-output')).toContainText('Puerta de enlace: 192.168.10.1');
  await input.fill('Remove-Item datos'); await input.press('Enter');
  await expect(page.getByTestId('terminal-output')).toContainText('Comando no disponible: Remove-Item');
  await input.fill('help'); await input.press('Enter');
  await expect(page.getByTestId('terminal-output')).toContainText('No se ejecutan órdenes del sistema operativo.');
  await input.fill('clear'); await input.press('Enter');
  await expect(page.getByTestId('terminal-output').locator('pre')).toHaveCount(0);
});

test('14 · los seis escenarios funcionan con Internet bloqueado', async ({ page, externalRequests }) => {
  const cases: [string, RegExp][] = [
    ['Navegación web', /HTTP · 200 OK/],
    ['Resolución DNS', /DNS/],
    ['Correo electrónico', /SMTP · Correo entregado/],
    ['Transferencia de archivos', /FTP · Archivo descargado/],
    ['Acceso remoto', /SSH · Comando completado/],
    ['Monitoreo de red', /SNMP · Objeto consultado/],
  ];
  for (const [name, expected] of cases) {
    await selectScenario(page, name);
    await runAction(page, () => page.getByTestId('start-flow').click(), expected);
    await expect(results(page).last()).toHaveClass('terminal-success');
  }
  expect(externalRequests).toEqual([]);
});

test('15 · modo presentación ofrece una guía visual navegable', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Presentar', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/presentation-mode/);
  await expect(page.getByRole('button', { name: 'Guía', exact: true })).toHaveClass('active');
  await expect(page.getByRole('heading', { name: 'Un nombre, una dirección', exact: true })).toBeVisible();
  await screenshot(page, testInfo, 'presentation');
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¿Qué protege HTTPS?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Correo electrónico', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Del emisor al buzón', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Salir de presentación', exact: true }).click();
  await expect(page.locator('.app')).not.toHaveClass(/presentation-mode/);
});

test('16 · el paquete se desplaza sobre el enlace y queda visible al pausar', async ({ page }, testInfo) => {
  await page.getByLabel('Velocidad de simulación').selectOption('0.5');
  await page.getByTestId('start-flow').click();
  const packet = page.getByRole('button', { name: 'Inspeccionar DNS', exact: true }).first();
  await expect(packet).toBeVisible();
  const beginning = await packet.boundingBox();
  expect(beginning).not.toBeNull();
  await expect.poll(async () => {
    const current = await packet.boundingBox();
    return current && beginning ? Math.hypot(current.x - beginning.x, current.y - beginning.y) : 0;
  }, { intervals: [50, 50, 100], timeout: 2_000 }).toBeGreaterThan(4);
  await page.getByRole('button', { name: 'Pausar simulación', exact: true }).click();
  const visiblePackets = await page.locator('.packet-motion').evaluateAll(elements => elements.filter(element => Number(getComputedStyle(element).opacity) > 0.1).map(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  expect(visiblePackets.length).toBeGreaterThan(0);
  const canvas = await page.getByTestId('topology').boundingBox();
  for (const box of visiblePackets) {
    expect(box.x + box.width / 2).toBeGreaterThan(canvas!.x);
    expect(box.x + box.width / 2).toBeLessThan(canvas!.x + canvas!.width);
    expect(box.y + box.height / 2).toBeGreaterThan(canvas!.y);
    expect(box.y + box.height / 2).toBeLessThan(canvas!.y + canvas!.height);
  }
  await screenshot(page, testInfo, 'traffic-motion', 'allow');
});

test('17 · un fallo HTTP persiste al recargar y puede desactivarse después', async ({ page }) => {
  await page.getByRole('button', { name: 'Fallos', exact: true }).click();
  const service = page.getByRole('button', { name: /Servicio HTTP apagado/ });
  await service.click();
  await expect(service).toHaveClass('active');
  await expect.poll(async () => page.evaluate(() => {
    const stored = localStorage.getItem('capa7.laboratorio.v1');
    if (!stored) return false;
    const snapshot = JSON.parse(stored);
    return snapshot.faults?.some((fault: { action: { kind: string; targetId: string; protocol?: string; active: boolean } }) =>
      fault.action.kind === 'service' && fault.action.targetId === 'web' && fault.action.protocol === 'HTTP' && fault.action.active,
    ) ?? false;
  })).toBe(true);
  await page.reload();
  await page.getByLabel('Velocidad de simulación').selectOption('4');
  await page.getByRole('button', { name: 'Fallos', exact: true }).click();
  await expect(service).toHaveClass('active');
  await page.getByRole('button', { name: 'Cerrar fallos', exact: true }).click();
  await runAction(page, () => page.getByTestId('start-flow').click(), /apagado|deshabilitado|servicio|disponible|rechaz/i);
  await expect(results(page).last()).toHaveClass('terminal-error');
  await page.getByRole('button', { name: 'Fallos', exact: true }).click();
  await service.click();
  await expect(service).not.toHaveClass('active');
  await page.getByRole('button', { name: 'Cerrar fallos', exact: true }).click();
  await runAction(page, () => page.getByTestId('start-flow').click(), /HTTP · 200 OK/);
  await expect(page.frameLocator('iframe[title="Página web recibida"]').getByRole('heading', { name: '¡Hola, capa 7!' })).toBeVisible();
});

test('18 · crear configurar conectar y eliminar un servidor funciona desde el editor', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Agregar servidor', exact: true }).click();
  await expect(page.locator('[data-testid^="device-"]')).toHaveCount(9);
  await page.getByLabel('Nombre del dispositivo', { exact: true }).fill('Servidor E2E');
  await page.getByLabel('IPv4 eth0', { exact: true }).fill('192.168.20.99');
  await tools(page).getByText('Recursos web y credenciales', { exact: true }).click();
  await page.getByLabel('Recursos HTTP', { exact: true }).fill(JSON.stringify({
    '/': '<h1>Servidor E2E conectado</h1><p>Enlace creado con el ratón.</p>',
  }));
  await page.getByRole('button', { name: 'Aplicar configuración', exact: true }).click();
  const server = page.locator('[data-testid^="device-server-"]').filter({ has: page.getByRole('button', { name: 'Configurar Servidor E2E', exact: true }) });
  await expect(server).toBeVisible();
  const serverTestId = await server.getAttribute('data-testid');
  const serverId = serverTestId!.replace('device-', '');
  await page.getByRole('button', { name: 'Ajustar red', exact: true }).click();
  const sourceHandle = page.getByTestId('device-sw2').locator('.react-flow__handle[data-handleid="out"]');
  const targetHandle = server.locator('.react-flow__handle[data-handleid="in"]');
  await page.getByTestId('device-sw2').hover();
  // dragTo genera eventos reales de ratón y espera a que el ajuste del lienzo termine.
  await sourceHandle.dragTo(targetHandle);
  await expect(page.getByRole('group', { name: `Edge from sw2 to ${serverId}`, exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('8 enlaces activos');
  await command(page, 'curl http://192.168.20.99/', /HTTP · 200 OK/);
  await expect(results(page).last()).toContainText('Servidor E2E conectado');
  await expect(results(page).last()).toContainText('Enlace creado con el ratón.');
  await screenshot(page, testInfo, 'editor-connected');
  await page.getByRole('button', { name: 'Configurar Servidor E2E', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar dispositivo', exact: true }).click();
  await expect(server).toHaveCount(0);
  await expect(page.locator('[data-testid^="device-"]')).toHaveCount(8);
  await expect(page.getByRole('group', { name: `Edge from sw2 to ${serverId}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('7 enlaces activos');
  await command(page, 'curl http://192.168.20.99/', /No existe un equipo/);
  await expect(results(page).last()).toHaveClass('terminal-error');
});

test('19 · la guía ocupa el panel inferior y permite volver a la consola', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Presentar', exact: true }).click();
  const guide = page.locator('.guide-card');
  await expect(guide).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guía', exact: true })).toHaveClass('active');
  const canvasBox = await page.getByTestId('topology').boundingBox();
  const guideBox = await guide.boundingBox();
  const bottomBox = await page.getByRole('region', { name: 'Consola y eventos' }).boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(guideBox).not.toBeNull();
  expect(bottomBox).not.toBeNull();
  expect(guideBox!.y).toBeGreaterThanOrEqual(canvasBox!.y + canvasBox!.height);
  expect(guideBox!.y + guideBox!.height).toBeLessThanOrEqual(bottomBox!.y + bottomBox!.height + 1);
  await screenshot(page, testInfo, 'presentation-guide-layout');
  await page.getByRole('button', { name: 'Consola', exact: true }).click();
  await expect(page.getByLabel('Comando de consola')).toBeVisible();
  await expect(guide).toHaveCount(0);
  await page.getByLabel('Comando de consola').fill('ipconfig');
  await page.getByLabel('Comando de consola').press('Enter');
  await expect(page.getByTestId('terminal-output')).toContainText('192.168.10.10');
  await page.getByRole('button', { name: 'Guía', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Un nombre, una dirección', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¿Qué protege HTTPS?', exact: true })).toBeVisible();
  const updatedGuideBox = await guide.boundingBox();
  const updatedCanvasBox = await page.getByTestId('topology').boundingBox();
  expect(updatedGuideBox!.y).toBeGreaterThanOrEqual(updatedCanvasBox!.y + updatedCanvasBox!.height);
});
