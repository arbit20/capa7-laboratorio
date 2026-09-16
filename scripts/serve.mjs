import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(workspaceRoot, 'dist');
const host = '127.0.0.1';
const port = 4173;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.map': 'application/json',
};

try {
  await fs.access(path.join(publicRoot, 'index.html'));
} catch {
  console.error('No se encontró dist/index.html. Ejecuta npm install y npm run build antes de iniciar.');
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  const send = (status, body, contentType = 'text/plain; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.setHeader('Allow', 'GET, HEAD');
    send(405, 'Método no permitido.');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${host}:${port}`).pathname);
  } catch {
    send(400, 'Dirección no válida.');
    return;
  }
  if (pathname === '/__health') {
    send(200, JSON.stringify({ app: 'capa7-laboratorio', version: '1.0.0', workspaceRoot }), 'application/json; charset=utf-8');
    return;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) {
    send(400, 'Ruta no válida.');
    return;
  }
  const requested = path.resolve(publicRoot, `.${pathname}`);
  const relative = path.relative(publicRoot, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    send(403, 'Acceso no permitido.');
    return;
  }
  try {
    let file = pathname.endsWith('/') ? path.join(requested, 'index.html') : requested;
    try {
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      if (path.extname(file)) { send(404, 'Archivo no encontrado.'); return; }
      file = path.join(publicRoot, 'index.html');
    }
    // Evita que un enlace simbólico dentro de dist exponga archivos externos.
    const real = await fs.realpath(file);
    const realRelative = path.relative(await fs.realpath(publicRoot), real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) { send(403, 'Acceso no permitido.'); return; }
    send(200, await fs.readFile(real), mime[path.extname(real).toLowerCase()] ?? 'application/octet-stream');
  } catch {
    send(404, 'Archivo no encontrado.');
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? 'El puerto 4173 está ocupado. No se cerró ningún proceso. Usa Iniciar-Simulador.cmd para comprobar si es este laboratorio.'
    : `No se pudo iniciar el laboratorio: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Laboratorio Capa 7 disponible en http://${host}:${port}`);
  console.log('Solo escucha en este equipo. Ctrl+C detiene el servidor. No necesita Internet.');
});
