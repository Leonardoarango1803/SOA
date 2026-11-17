// Metricas, disponibilidad y rendimiento (documento 11.5).
// Modulo compartido en memoria: todos los servicios registran aqui.

const porServicio = new Map(); // servicio -> acumuladores

function slot(servicio) {
  if (!porServicio.has(servicio)) {
    porServicio.set(servicio, {
      llamadas: 0,
      errores: 0,
      reintentos: 0,
      circuitoAbierto: 0, // veces que el circuito se abrio
      latencias: [], // ms de cada llamada (ventana)
      vivo: true,
    });
  }
  return porServicio.get(servicio);
}

export function registrarLlamada(servicio, duracionMs, ok) {
  const s = slot(servicio);
  s.llamadas++;
  if (!ok) s.errores++;
  s.latencias.push(duracionMs);
  if (s.latencias.length > 500) s.latencias.shift();
}

export function registrarReintento(servicio) {
  slot(servicio).reintentos++;
}

export function registrarCircuitoAbierto(servicio) {
  slot(servicio).circuitoAbierto++;
}

export function setVivo(servicio, vivo) {
  slot(servicio).vivo = vivo;
}

// Contadores de negocio (documento 11.5).
export const negocio = {
  pendientesDePago: 0,
  comprobantesPendientes: 0,
};

// Profundidad de colas y DLF (la llena el broker).
export const colas = {
  outbox: 0,
  pendientesBroker: 0,
  dlq: 0,
};

function percentil(arr, p) {
  if (arr.length === 0) return 0;
  const ordenado = [...arr].sort((a, b) => a - b);
  const idx = Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length));
  return ordenado[idx];
}

export function snapshot() {
  const servicios = {};
  for (const [nombre, s] of porServicio.entries()) {
    const tasaError = s.llamadas ? s.errores / s.llamadas : 0;
    servicios[nombre] = {
      vivo: s.vivo,
      llamadas: s.llamadas,
      errores: s.errores,
      tasaError: Number((tasaError * 100).toFixed(2)), // %
      reintentos: s.reintentos,
      circuitoAbierto: s.circuitoAbierto,
      latenciaP95ms: percentil(s.latencias, 95),
      latenciaPromedioMs: s.latencias.length
        ? Math.round(s.latencias.reduce((a, b) => a + b, 0) / s.latencias.length)
        : 0,
    };
  }
  return {
    ts: new Date().toISOString(),
    servicios,
    negocio: { ...negocio },
    colas: { ...colas },
  };
}
