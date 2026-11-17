// Launcher: levanta con un solo comando el broker, los 8 servicios y el API Gateway
// (que ademas sirve la UI). Todo en un proceso Node; los servicios escuchan en puertos
// propios y se llaman por HTTP real.
import { PORTS, HOST, SPEED, SIM } from "./config.js";
import { iniciarBroker } from "./shared/broker.js";
import { inicializarEsquemas, sembrarClientes, reiniciarDatos } from "./data/db.js";
import { iniciarGateway } from "./gateway/gateway.js";

import { crearApp as tarifario } from "./services/tarifario.js";
import { crearApp as clientes } from "./services/clientes.js";
import { crearApp as encomiendas } from "./services/encomiendas.js";
import { crearApp as cobros } from "./services/cobros.js";
import { crearApp as facturacion } from "./services/facturacion.js";
import { crearApp as trazabilidad } from "./services/trazabilidad.js";
import { crearApp as notificaciones } from "./services/notificaciones.js";
import { crearApp as recojo } from "./services/recojo.js";

const SERVICIOS = [
  ["tarifario", tarifario],
  ["clientes", clientes],
  ["encomiendas", encomiendas],
  ["cobros", cobros],
  ["facturacion", facturacion],
  ["trazabilidad", trazabilidad],
  ["notificaciones", notificaciones],
  ["recojo", recojo],
];

function escuchar(nombre, app) {
  return new Promise((resolve) => app.listen(PORTS[nombre], () => resolve(nombre)));
}

async function main() {
  inicializarEsquemas();
  if (process.env.SOA_RESET === "1") reiniciarDatos(); // arranque limpio opcional
  sembrarClientes();
  iniciarBroker();

  for (const [nombre, crear] of SERVICIOS) {
    await escuchar(nombre, crear());
  }
  const puertoGw = await iniciarGateway();

  // Resumen legible en consola (ademas de los logs JSON por operacion).
  console.error("\n====================================================");
  console.error("  Prototipo SOA - Senor de Luren Express (APF3)");
  console.error("====================================================");
  console.error(`  UI / API Gateway : http://${HOST}:${puertoGw}`);
  console.error(`     - Counter      : http://${HOST}:${puertoGw}/counter.html`);
  console.error(`     - Rastreo      : http://${HOST}:${puertoGw}/rastreo.html`);
  console.error(`     - Monitoreo    : http://${HOST}:${puertoGw}/monitor.html`);
  console.error("  Servicios (HTTP real):");
  for (const [nombre] of SERVICIOS) console.error(`     - ${nombre.padEnd(14)} http://${HOST}:${PORTS[nombre]}`);
  console.error(`  Factor de velocidad (SOA_SPEED): ${SPEED}`);
  console.error(`  NOTA: ${SIM.nota}`);
  console.error("  Listo. Abre la UI en el navegador.\n");
}

main().catch((e) => {
  console.error("Error al iniciar:", e);
  process.exit(1);
});
