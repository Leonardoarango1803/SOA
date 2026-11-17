# Prototipo ejecutable SOA — Señor de Luren Express (APF3)

Prototipo que **demuestra** la arquitectura orientada a servicios (SOA) diseñada para la
gestión de encomiendas de *Transportes Logísticos y Turísticos Señor de Luren Express E.I.R.L.*,
curso de Arquitectura Orientada al Servicio (UTP).

No es un sistema completo: es un **prototipo para una demo corta** que hace visible el
**registro de una encomienda** (pasos 1–11 del documento) atravesando los servicios, con un
fallo provocado y recuperado, y con la operación reconstruible por su *correlation ID*.
Corresponde a la recomendación de la §12.4 del entregable final.

> **Honestidad técnica:** SUNAT/OSE, el canal de mensajería (WhatsApp/SMS/correo) y el
> monitoreo GPS están **simulados**. SOAP/WSDL/WS-Security, el envío en lote B2B, el registro
> UDDI, TLS real, el segundo factor, el gestor de secretos y OpenTelemetry están **descritos en
> el diseño pero no implementados** en el prototipo. Los valores numéricos (tiempos, reintentos,
> umbrales) son valores de partida.

## Cómo ejecutar

Requisito: **Node.js 22.5 o superior** (probado en Node 24). Sin Docker ni módulos nativos:
la base de datos usa el **SQLite integrado de Node** (`node:sqlite`), por eso se requiere Node 22.5+.

```bash
npm install
npm start
```

Luego abrir **http://127.0.0.1:4000** en el navegador. Tres pantallas:

- **Counter** — registrar una encomienda (el proceso de la §9), con una **línea de tiempo en vivo**
  que muestra cada paso conforme ocurre (reintentos, compensación y diferimiento incluidos).
- **Rastreo** — consulta pública por código (sin sesión) + lista de **envíos recientes** (ayuda solo para la demo).
- **Monitoreo** — salud, métricas, interruptores de falla, reconstrucción por *correlation ID* y botón de **reiniciar datos**.

Los datos se guardan en SQLite y **persisten entre reinicios**. Para empezar limpio: usar el botón
"Reiniciar datos de la demo" en Monitoreo, o arrancar con `SOA_RESET=1 npm start`.

Demo más ágil (acorta las esperas de *backoff*):

```bash
SOA_SPEED=4 npm start
```

En Windows PowerShell:

```powershell
$env:SOA_SPEED=4; npm start
```

Un recorrido guiado de 5–7 minutos está en [`demo/guion-demo.md`](demo/guion-demo.md).
Ejemplos de invocación por API en [`demo/requests.http`](demo/requests.http).

## Qué se puede demostrar y dónde se ve (rúbrica APF3)

| Criterio de la rúbrica | Qué muestra el prototipo |
|---|---|
| **Relación BPM–SOA** | El flujo de registro ejecutado paso a paso (línea de tiempo en vivo); cada paso es una operación de un servicio. |
| **Arquitectura e integración** | 8 servicios como listeners HTTP propios que se llaman por contrato REST, + API Gateway + broker. |
| **Coordinación y composición** | Orquestación (pasos 3–8, con compensación) y coreografía por eventos (pasos 9–11). |
| **Confiabilidad y errores** | Timeout, reintentos con *backoff*+*jitter*, *circuit breaker*, **idempotencia**, **compensación (7C)** y **diferimiento (8D)**. |
| **Seguridad** | Token con perfil y sede; autorización en el gateway y por servicio; rechazo auditado de otra sede. |
| **Monitoreo y trazabilidad** | *Correlation ID* en todos los logs, `/metrics`, salud, y **reconstrucción** de una operación. |

## Arquitectura (resumen)

Un solo `npm start` levanta, en un proceso Node, el **API Gateway** (puerto 4000, sirve la UI
y expone `/api/*`), los **8 servicios** (puertos 4002–4009) y el broker en memoria. El
orquestador es un módulo que el gateway invoca; sus llamadas a los servicios son **HTTP real**.

```
UI (counter / rastreo / monitor)
      │ REST
  API Gateway  → correlationId, token, autorización perfil+sede, rate limit, auditoría
      │
  Orquestador (saga)  → pasos 3→8, estado del proceso, reintentos+backoff, circuit breaker,
      │ HTTP real         compensación 7C, diferimiento 8D
      ├─ Clientes        ├─ Encomiendas      ├─ Cobros y caja
      ├─ Tarifario       └─ Facturación (SUNAT/OSE simulado)
      │ outbox → publica EstadoDeEnvioCambiado
  Broker (memoria: colas + reintentos + DLQ)
      ├─ Trazabilidad (registrarEvento / consultarEstado)
      └─ Notificaciones (WhatsApp simulado)
```

### Correspondencia con el documento

- **Pasos 1–11** del BPMN (§5.4), con compensación **7C** (`anularEncomienda`) y diferimiento **8D** (`encolarEmision`).
- **Estados** de la encomienda (§4.4): Registrada, Pendiente de pago, Cobrada, Comprobante pendiente, Facturada, Anulada, etc.
- **Cuatro identificadores** (§11.3): `correlationId`, clave de idempotencia, código de rastreo (no predecible), id de evento.
- **Confiabilidad** (§9.2): timeouts y *backoff* por servicio, presupuesto del counter 15 s, circuit breaker 5 fallos → 30 s.
- **Autorización** por matriz perfil × operación (§10.3).
- **Logs** (§11.2) y **métricas** (§11.5) con los mismos campos del documento.

## Estructura del proyecto

```
src/
  index.js              Launcher (un comando levanta todo)
  config.js             Puertos, confiabilidad, seguridad, interruptores de falla
  gateway/gateway.js    API Gateway + servidor de la UI
  orchestrator/registrar.js   Saga del registro (pasos 3→8, compensación, eventos)
  services/             Los 8 servicios (tarifario, clientes, encomiendas, cobros,
                        facturacion, trazabilidad, notificaciones, recojo)
  shared/               logger, ids, auth, httpClient, broker, metrics, errors, idempotency
  data/                 db.js (SQLite, un archivo por servicio) + seed (datos de prueba)
  data/db/              archivos SQLite por servicio (se crean al arrancar)
  ui/                   counter.html, rastreo.html, monitor.html, app.js, styles.css
demo/                   guion-demo.md, requests.http
```

## Usuarios de prueba (login de demo)

El login solo selecciona un usuario sembrado y emite su token (no se usa contraseña).

| Usuario | Perfil | Sede |
|---|---|---|
| Counter Ica | counter | Ica |
| Counter Lima | counter | Lima |
| Jefe de agencia Ica | jefe_agencia | Ica |
| Motorizado Ica | motorizado | Ica |
| Administración central | admin_central | Lima |
| One Berry (B2B) | b2b | Lima |

## Persistencia (SQLite, esquema por servicio)

Cada servicio tiene su **propio archivo SQLite** en `src/data/db/` (clientes.db, encomiendas.db,
cobros.db, …), creado automáticamente al arrancar. Esto representa el principio de **autonomía de
datos / esquema por servicio** del diseño (§6.2): ningún servicio accede al almacén de otro. Se usa
el módulo nativo `node:sqlite`, sin dependencias ni compilación. Los datos persisten entre reinicios;
se pueden limpiar desde Monitoreo o con `SOA_RESET=1`.

## Notas

- Factor de velocidad: `SOA_SPEED=4 npm start` acorta las esperas de *backoff* para una demo más ágil.
- Pensado para explicarse y ejecutarse por cualquier integrante en pocos minutos.
