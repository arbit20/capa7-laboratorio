import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const unit = JSON.parse(
  await fs.readFile(path.join(root, "evidence/unit-results.json"), "utf8"),
);
const e2e = JSON.parse(
  await fs.readFile(
    path.join(root, "evidence/playwright-results.json"),
    "utf8",
  ),
);
const summary = {
  date: new Date().toISOString(),
  unit: {
    passed: unit.numPassedTests,
    failed: unit.numFailedTests,
    total: unit.numTotalTests,
  },
  browser: e2e.stats,
  projects: e2e.config.projects.map((p) => p.name),
  assets: [],
};
for (const file of (await fs.readdir(path.join(root, "dist/assets"))).sort()) {
  const content = await fs.readFile(path.join(root, "dist/assets", file));
  summary.assets.push({
    file,
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  });
}
await fs.writeFile(
  path.join(root, "evidence/summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const captions = {
  initial: "Laboratorio y topología",
  "traffic-motion": "Mensaje en tránsito",
  web: "Página recibida",
  encrypted: "Contenido protegido con HTTPS",
  mail: "Correo recibido y leído",
  files: "Archivo transferido",
  presentation: "Guía para la exposición",
};
let sections = "";
for (const project of summary.projects) {
  let cards = "";
  for (const [file, title] of Object.entries(captions)) {
    const relative = `screenshots/${project}/${file}.png`;
    try {
      await fs.access(path.join(root, "evidence", relative));
      cards += `<a class="shot" href="${relative}"><img loading="lazy" src="${relative}" alt="${escape(title)} · ${escape(project)}"><span>${escape(title)}</span></a>`;
    } catch {
      /* Only show real captured evidence. */
    }
  }
  sections += `<section><h2>${escape(project)}</h2><div class="gallery">${cards}</div></section>`;
}
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capa 7 · Evidencia de pruebas</title><style>*{box-sizing:border-box}body{font:15px/1.6 system-ui,sans-serif;color:#294b60;background:#f2f7fa;margin:0;padding:40px}main{max-width:1360px;margin:auto}header{border-bottom:1px solid #cbdde7;padding-bottom:24px}h1{font-size:34px;letter-spacing:-1px;margin:6px 0}p{color:#6d8798;margin:8px 0}.label{font-size:11px;font-weight:700;letter-spacing:2px;color:#0b7194}.stats{display:flex;gap:20px;flex-wrap:wrap;margin-top:22px}.stats span{padding:9px 14px;background:#e2f0f5;border-radius:6px;color:#166989}h2{font-size:18px;margin-top:32px;font-weight:600}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}.shot{text-decoration:none;color:#436b83;border:1px solid #d3e3ed;background:white;border-radius:8px;overflow:hidden}.shot img{width:100%;height:auto;display:block;border-bottom:1px solid #e4edf3}.shot span{display:block;padding:10px 13px;font-size:13px}.links{display:flex;gap:18px;font-size:13px;margin:20px 0}.links a{color:#127695}footer{font-size:12px;color:#8198a7;margin-top:35px}@media(max-width:600px){body{padding:20px}h1{font-size:27px}}</style><main><header><div class="label">UNIFRANZ · SISTEMAS DE COMUNICACIONES</div><h1>Un laboratorio que se puede comprobar.</h1><p>Capturas reales de Chrome y Edge. Los escenarios se ejecutaron bloqueando toda conexión externa.</p><div class="stats"><span><b>${unit.numPassedTests}/${unit.numTotalTests}</b> pruebas unitarias</span><span><b>${e2e.stats.expected}</b> pruebas de navegador aprobadas</span><span><b>${e2e.stats.unexpected}</b> fallos · <b>${e2e.stats.skipped}</b> omitidas</span></div></header><div class="links"><a href="COMPROBACIONES.md">Comprobaciones</a><a href="summary.json">Resultados y hashes</a><a href="playwright-report/index.html">Reporte Playwright</a></div>${sections}<footer>Generado ${escape(summary.date)}. Cada imagen abre su captura completa. Para explorar todas las trazas: npx playwright show-report evidence/playwright-report</footer></main></html>`;
await fs.writeFile(path.join(root, "evidence/index.html"), html);
const reportPath = path.join(root, "evidence/COMPROBACIONES.md");
let report = await fs.readFile(reportPath, "utf8");
report = report.replace(
  /\*\*Resultado:\*\* \d+ pruebas aprobadas en cuatro archivos;/,
  `**Resultado:** ${unit.numPassedTests} pruebas aprobadas en cuatro archivos;`,
);
report =
  report.split("## Navegador y evidencia visual")[0] +
  `## Navegador y evidencia visual\n\n**${e2e.stats.expected} pruebas E2E aprobadas**, ${e2e.stats.unexpected} fallos, ${e2e.stats.skipped} omitidas y ${e2e.stats.flaky} inestables. Chrome y Edge, en 1366×768 y 1920×1080. Duración de Playwright: ${(e2e.stats.duration / 1000).toFixed(1)} segundos.\n\nTodos los escenarios se ejecutaron con conexiones externas bloqueadas. Se comprobaron movimiento real de sobres, pausa, datos HTTP/HTTPS, correo, archivos, terminal remota, SNMP, fallos y recuperación, edición de la red, persistencia y guía de presentación.\n\nSe revisaron capturas del laboratorio, del tráfico en movimiento y de la guía. La guía ocupa la pestaña inferior para conservar libre la topología. El navegador simulado mantiene el contenido en un iframe aislado sin permisos de scripts. El diagnóstico específico del navegador sobre ejecución bloqueada dentro de ese iframe se adjunta cuando aparece; todos los demás errores de consola y los errores JavaScript hacen fallar la prueba.\n\n- [Galería de capturas](index.html)\n- [Resultados unitarios](unit-results.json)\n- [Resultados Playwright](playwright-results.json)\n- [Resumen y SHA-256 de la compilación](summary.json)\n\nValidación reproducible completa: \`npm run test:all\`. Para explorar el reporte interactivo: \`npx playwright show-report evidence/playwright-report\`.\n`;
// Keep code spans literal in the Markdown output.
report = report.replaceAll("\`", "`");
await fs.writeFile(reportPath, report);
console.log(
  JSON.stringify({
    unit: summary.unit,
    e2e: {
      passed: e2e.stats.expected,
      failed: e2e.stats.unexpected,
      skipped: e2e.stats.skipped,
    },
    gallery: "evidence/index.html",
  }),
);
