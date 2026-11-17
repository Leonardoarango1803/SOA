// Broker de mensajeria SIMULADO en memoria (en produccion seria, p. ej., RabbitMQ).
// Implementa el patron bandeja de salida (outbox, documento 9.6): el evento se guarda
// primero y se publica despues; entrega "al menos una vez" con reintentos y cola de
// mensajes fallidos (DLQ). Los consumidores descartan duplicados por idEvento (documento 9.3).
import { EVENT_RETRIES } from "../config.js";
import * as metrics from "./metrics.js";
import { log } from "./logger.js";

const suscriptores = new Map(); // tipoEvento -> [{ nombre, handler, procesados:Set }]
const outbox = []; // eventos guardados, aun no entregados
const tareas = []; // entregas pendientes: { evento, sub, intento, due }
let dlq = []; // cola de mensajes fallidos

const dormirHasta = (ms) => Date.now() + ms;

export function suscribir(tipoEvento, nombre, handler) {
  if (!suscriptores.has(tipoEvento)) suscriptores.set(tipoEvento, []);
  suscriptores.get(tipoEvento).push({ nombre, handler, procesados: new Set() });
}

// Publicar = guardar en la bandeja de salida (outbox). Un flush la vacia hacia los suscriptores.
export function publicar(evento) {
  outbox.push(evento);
  metrics.colas.outbox = outbox.length;
  log({
    correlationId: evento.correlationId,
    servicio: "broker",
    operacion: "outbox.guardar",
    resultado: "info",
    codigoRastreo: evento.carga?.codigoRastreo || null,
    detalle: `evento ${evento.tipo} guardado en outbox`,
  });
}

function flushOutbox() {
  while (outbox.length) {
    const evento = outbox.shift();
    const subs = suscriptores.get(evento.tipo) || [];
    for (const sub of subs) {
      tareas.push({ evento, sub, intento: 1, due: Date.now() });
    }
    log({
      correlationId: evento.correlationId,
      servicio: "broker",
      operacion: "publicar",
      resultado: "info",
      codigoRastreo: evento.carga?.codigoRastreo || null,
      detalle: `evento ${evento.tipo} publicado a ${subs.length} suscriptor(es)`,
    });
  }
  metrics.colas.outbox = outbox.length;
}

async function procesarTareas() {
  const ahora = Date.now();
  const listas = tareas.filter((t) => t.due <= ahora);
  for (const tarea of listas) {
    const idx = tareas.indexOf(tarea);
    if (idx >= 0) tareas.splice(idx, 1);
    const { evento, sub, intento } = tarea;

    // Descartar duplicados ya procesados por este suscriptor (documento 9.3).
    if (sub.procesados.has(evento.idEvento)) {
      log({
        correlationId: evento.correlationId,
        servicio: "broker",
        operacion: `entregar:${sub.nombre}`,
        resultado: "info",
        detalle: `evento ${evento.idEvento} descartado (duplicado)`,
      });
      continue;
    }

    try {
      await sub.handler(evento);
      sub.procesados.add(evento.idEvento);
    } catch (err) {
      if (intento >= EVENT_RETRIES) {
        dlq.push({ evento, suscriptor: sub.nombre, motivo: String(err?.message || err) });
        metrics.colas.dlq = dlq.length;
        log({
          correlationId: evento.correlationId,
          servicio: "broker",
          operacion: `dlq:${sub.nombre}`,
          resultado: "error",
          codigoError: "DLQ",
          detalle: `evento ${evento.tipo} a la cola de fallidos tras ${intento} intentos`,
        });
      } else {
        // Reintento con espera creciente (1 s, 2 s, ... simplificado).
        tareas.push({ evento, sub, intento: intento + 1, due: dormirHasta(1000 * intento) });
      }
    }
  }
  metrics.colas.pendientesBroker = tareas.length;
}

let timer = null;
export function iniciarBroker() {
  if (timer) return;
  timer = setInterval(() => {
    flushOutbox();
    procesarTareas();
  }, 200);
}

export function estadoColas() {
  return { outbox: outbox.length, pendientes: tareas.length, dlq: dlq.length };
}

export function verDLQ() {
  return dlq;
}
