// Formato de error comun (documento 9.4): codigo, mensaje comprensible, correlationId,
// si es reintentable y, cuando aplica, el estado actual de la encomienda.

export class ErrorSOA extends Error {
  constructor({ codigo, mensaje, correlationId, reintentable = false, estado = null, httpStatus = 400, tipo = "negocio" }) {
    super(mensaje);
    this.name = "ErrorSOA";
    this.codigo = codigo;
    this.correlationId = correlationId || null;
    this.reintentable = reintentable;
    this.estado = estado;
    this.httpStatus = httpStatus;
    this.tipo = tipo; // "negocio" | "tecnico-transitorio" | "tecnico-permanente"
  }

  toBody() {
    return {
      error: {
        codigo: this.codigo,
        mensaje: this.message,
        correlationId: this.correlationId,
        reintentable: this.reintentable,
        tipo: this.tipo,
        estado: this.estado,
      },
    };
  }
}

// Atajos de uso frecuente.
export const errorNegocio = (codigo, mensaje, extra = {}) =>
  new ErrorSOA({ codigo, mensaje, reintentable: false, httpStatus: 422, tipo: "negocio", ...extra });

export const errorTecnico = (codigo, mensaje, extra = {}) =>
  new ErrorSOA({ codigo, mensaje, reintentable: true, httpStatus: 503, tipo: "tecnico-transitorio", ...extra });

export const errorAuth = (codigo, mensaje, extra = {}) =>
  new ErrorSOA({ codigo, mensaje, reintentable: false, httpStatus: 401, tipo: "negocio", ...extra });

export const errorConflicto = (codigo, mensaje, extra = {}) =>
  new ErrorSOA({ codigo, mensaje, reintentable: false, httpStatus: 409, tipo: "negocio", ...extra });
