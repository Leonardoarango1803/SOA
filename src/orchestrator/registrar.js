// Orquestador del registro de una encomienda (documento 8.2 y 9.5): patron saga.
// Coordina los pasos 3 a 8 de forma sincrona invocando a los servicios por HTTP real,
// persiste el estado del proceso (documento 9.6), aplica compensacion (7C) y diferimiento
// (8D) y publica el evento de estado (paso 9) hacia el broker (coreografia 10-11).
import { llamar } from "../shared/httpClient.js";
import { log } from "../shared/logger.js";
import { publicar } from "../shared/broker.js";
import { nuevoIdEvento } from "../shared/ids.js";
import { ErrorSOA } from "../shared/errors.js";
import { db } from "../data/db.js";
import * as metrics from "../shared/metrics.js";

// Publica EstadoDeEnvioCambiado con el sobre comun del documento (8.5).
function publicarEstado({ codigoRastreo, estado, sede, usuario, correlationId }) {
  publicar({
    idEvento: nuevoIdEvento(),
    tipo: "EstadoDeEnvioCambiado",
    version: "1.0",
    fecha: new Date().toISOString(),
    correlationId,
    sede,
    usuario,
    carga: { codigoRastreo, estado, sede, usuario },
  });
}

// Persiste el estado del proceso (documento 9.6) en el SQLite del orquestador (upsert).
function guardarEstadoProceso(correlationId, parcial) {
  const prev = db.orquestador.prepare("SELECT * FROM procesos WHERE correlation_id = ?").get(correlationId) || {};
  const fila = {
    paso: parcial.paso ?? prev.paso ?? null,
    estado: parcial.estado ?? prev.estado ?? null,
    id_encomienda: parcial.idEncomienda ?? prev.id_encomienda ?? null,
    codigo_rastreo: parcial.codigoRastreo ?? prev.codigo_rastreo ?? null,
    sede: parcial.sede ?? prev.sede ?? null,
    usuario: parcial.usuario ?? prev.usuario ?? null,
  };
  db.orquestador
    .prepare(`INSERT INTO procesos (correlation_id, paso, estado, id_encomienda, codigo_rastreo, sede, usuario, actualizado)
      VALUES (@cid, @paso, @estado, @ide, @cod, @sede, @usuario, @act)
      ON CONFLICT(correlation_id) DO UPDATE SET
        paso=@paso, estado=@estado, id_encomienda=@ide, codigo_rastreo=@cod, sede=@sede, usuario=@usuario, actualizado=@act`)
    .run({ cid: correlationId, paso: String(fila.paso), estado: fila.estado, ide: fila.id_encomienda, cod: fila.codigo_rastreo, sede: fila.sede, usuario: fila.usuario, act: new Date().toISOString() });
}

// payload: { destinatario, envio, pago, sede, usuario, tipoCliente }
// ctx: { correlationId, idemKey, perfil }
export async function registrarEncomienda(payload, ctx) {
  const { destinatario, envio, pago = {}, sede, usuario, tipoCliente = "normal" } = payload;
  const { correlationId, idemKey } = ctx;
  const comun = { correlationId, perfil: ctx.perfil };

  // Paso 3: iniciar proceso y correlationId.
  guardarEstadoProceso(correlationId, { paso: 3, estado: "Iniciado", sede, usuario });
  log({ correlationId, servicio: "orquestador", operacion: "iniciarRegistro", resultado: "info", sede, usuario, detalle: "proceso iniciado" });

  // Paso 4: registrar o validar clientes.
  guardarEstadoProceso(correlationId, { paso: 4 });
  const cliente = await llamar("clientes", "/buscar-o-crear", { method: "POST", body: destinatario, ...comun });

  // Paso 5: cotizar.
  guardarEstadoProceso(correlationId, { paso: 5 });
  const cotizacion = await llamar("tarifario", "/cotizar", {
    method: "POST",
    body: { destino: envio.destino, peso: envio.peso, volumen: envio.volumen, modalidad: envio.modalidad, tipoCliente },
    ...comun,
  });

  // Paso 6: crear orden y codigo de rastreo (idempotente).
  guardarEstadoProceso(correlationId, { paso: 6 });
  const orden = await llamar("encomiendas", "/crear", {
    method: "POST",
    idemKey: `${idemKey}:encomienda`,
    body: {
      remitente: payload.remitente || null,
      destinatario: { id: cliente.id, nombre: cliente.nombre },
      origen: envio.origen,
      destino: envio.destino,
      bultos: envio.bultos,
      peso: envio.peso,
      tarifa: cotizacion.tarifa,
      modalidad: envio.modalidad,
      sede,
    },
    ...comun,
  });
  guardarEstadoProceso(correlationId, { idEncomienda: orden.id, codigoRastreo: orden.codigoRastreo, estado: "Registrada" });
  publicarEstado({ codigoRastreo: orden.codigoRastreo, estado: "Recibida en origen", sede, usuario, correlationId });

  // Paso 7: registrar cobro. Si falla de forma tecnica -> Pendiente de pago y compensacion 7C.
  guardarEstadoProceso(correlationId, { paso: 7 });
  let cobro;
  try {
    cobro = await llamar("cobros", "/registrar", {
      method: "POST",
      idemKey: `${idemKey}:cobro`,
      body: { idEncomienda: orden.id, monto: cotizacion.tarifa, tarifa: cotizacion.tarifa, medio: pago.medio || "efectivo", agencia: sede, turno: pago.turno || "manana" },
      ...comun,
    });
    await llamar("encomiendas", "/estado", { method: "POST", body: { id: orden.id, estado: "Cobrada" }, ...comun });
    publicarEstado({ codigoRastreo: orden.codigoRastreo, estado: "Cobrada", sede, usuario, correlationId });
  } catch (err) {
    const e = err instanceof ErrorSOA ? err : null;
    // Error de negocio (p. ej. monto distinto): el counter corrige; no se compensa.
    if (e && e.tipo === "negocio" && e.codigo !== "COBRO_NO_DISPONIBLE") throw e;

    // Fallo tecnico definitivo del cobro: Pendiente de pago -> compensacion (anular orden).
    metrics.negocio.pendientesDePago++;
    guardarEstadoProceso(correlationId, { estado: "Pendiente de pago" });
    await llamar("encomiendas", "/estado", { method: "POST", body: { id: orden.id, estado: "Pendiente de pago" }, ...comun });
    publicarEstado({ codigoRastreo: orden.codigoRastreo, estado: "Pendiente de pago", sede, usuario, correlationId });
    log({ correlationId, servicio: "orquestador", operacion: "compensar", resultado: "error", codigoError: "COBRO_FALLIDO", codigoRastreo: orden.codigoRastreo, detalle: "se ejecuta compensacion 7C (anular orden)" });

    const anulada = await llamar("encomiendas", "/anular", { method: "POST", body: { id: orden.id, motivo: "compensacion por falla de cobro" }, ...comun });
    metrics.negocio.pendientesDePago = Math.max(0, metrics.negocio.pendientesDePago - 1);
    guardarEstadoProceso(correlationId, { paso: "7C", estado: "Anulada" });
    publicarEstado({ codigoRastreo: orden.codigoRastreo, estado: "Anulada", sede, usuario, correlationId });
    return {
      correlationId,
      idEncomienda: orden.id,
      codigoRastreo: orden.codigoRastreo,
      estado: "Anulada",
      cliente,
      tarifa: cotizacion.tarifa,
      comprobante: null,
      nota: "El cobro no se pudo registrar; la orden fue anulada por compensacion (7C).",
    };
  }

  // Paso 8: emitir comprobante. Si SUNAT/OSE no responde -> diferir (8D), sin perder el envio.
  guardarEstadoProceso(correlationId, { paso: 8 });
  let comprobante;
  let estadoFinal = "Facturada";
  try {
    comprobante = await llamar("facturacion", "/emitir", {
      method: "POST",
      idemKey: `${idemKey}:comprobante`,
      body: { idEncomienda: orden.id, idCobro: cobro.idCobro, cliente: { id: cliente.id, nombre: cliente.nombre }, tipo: tipoCliente === "b2b" ? "factura" : "boleta", monto: cotizacion.tarifa },
      ...comun,
    });
    await llamar("encomiendas", "/estado", { method: "POST", body: { id: orden.id, estado: "Facturada" }, ...comun });
    publicarEstado({ codigoRastreo: orden.codigoRastreo, estado: "Facturada", sede, usuario, correlationId });
  } catch (err) {
    const e = err instanceof ErrorSOA ? err : null;
    if (e && e.tipo === "negocio") throw e;
    // Diferimiento 8D.
    metrics.negocio.comprobantesPendientes++;
    comprobante = await llamar("facturacion", "/encolar", { method: "POST", body: { idEncomienda: orden.id, idCobro: cobro.idCobro, motivo: "SUNAT/OSE no disponible" }, ...comun });
    estadoFinal = "Comprobante pendiente";
    await llamar("encomiendas", "/estado", { method: "POST", body: { id: orden.id, estado: "Comprobante pendiente" }, ...comun });
    publicarEstado({ codigoRastreo: orden.codigoRastreo, estado: "Comprobante pendiente", sede, usuario, correlationId });
    log({ correlationId, servicio: "orquestador", operacion: "diferir", resultado: "error", codigoError: "SUNAT_NO_DISPONIBLE", codigoRastreo: orden.codigoRastreo, detalle: "emision diferida (8D)" });
  }

  guardarEstadoProceso(correlationId, { paso: 9, estado: estadoFinal });
  log({ correlationId, servicio: "orquestador", operacion: "registrarEncomienda", resultado: "exito", codigoRastreo: orden.codigoRastreo, detalle: `proceso completo, estado ${estadoFinal}` });

  return {
    correlationId,
    idEncomienda: orden.id,
    codigoRastreo: orden.codigoRastreo,
    estado: estadoFinal,
    cliente: { id: cliente.id, nombre: cliente.nombre, reutilizado: cliente.reutilizado },
    tarifa: cotizacion.tarifa,
    desglose: cotizacion.desglose,
    cobro: { idCobro: cobro.idCobro, estado: "Cobrada" },
    comprobante,
  };
}
