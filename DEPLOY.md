# Despliegue

Guia para subir el prototipo a **GitHub** y publicarlo en **Render**. Incluye por que
Vercel no encaja y cuando tendria sentido Supabase.

## Resumen de la decision

| Plataforma | Veredicto | Motivo |
|---|---|---|
| **Render** (o Railway / Fly.io) | **Recomendada** | El prototipo es un proceso Node de larga duracion que levanta el gateway + 8 servicios y usa SSE. Encaja de forma nativa. |
| **Vercel** | No encaja | Es *serverless* (funciones efimeras): no admite un proceso persistente con varios puertos internos, ni un sistema de archivos para SQLite. Requeriria reescribir todo. |
| **Supabase** | Opcional | Es Postgres gestionado. Solo necesario si quieres una base de datos persistente de verdad; implica cambiar `node:sqlite` por Postgres. No hace falta para la demo. |

El prototipo ya esta listo para la nube: el gateway escucha en `process.env.PORT` (lo inyecta
Render) y el directorio de las bases SQLite es configurable con `SOA_DB_DIR`.

---

## Paso 1 — Subir a GitHub

Ya hay un repositorio git local con un commit inicial. Falta crear el repo remoto y empujar.

### Opcion A: desde la web (sin instalar nada)
1. Entra a <https://github.com/new> y crea un repositorio **vacio** (sin README ni .gitignore),
   por ejemplo `soa-senor-de-luren`. Elige **Private** si no quieres que sea publico.
2. Copia la URL que te da GitHub y, en la carpeta del proyecto, ejecuta:

   ```bash
   git remote add origin https://github.com/<tu-usuario>/soa-senor-de-luren.git
   git branch -M main
   git push -u origin main
   ```

### Opcion B: con GitHub CLI (`gh`)
Si instalas [GitHub CLI](https://cli.github.com/) y haces `gh auth login`:

```bash
gh repo create soa-senor-de-luren --private --source=. --remote=origin --push
```

> El `.gitignore` ya excluye `node_modules/`, las bases SQLite (`src/data/db/`) y los `*.log`.

---

## Paso 2 — Desplegar en Render

1. Crea una cuenta en <https://render.com> (puedes entrar con GitHub).
2. **New +** → **Blueprint** → conecta tu repositorio. Render leera `render.yaml` y creara
   el servicio web automaticamente. (Alternativa manual: **New +** → **Web Service**, con
   Build command `npm install` y Start command `npm start`.)
3. Verifica las variables de entorno (ya vienen en `render.yaml`):
   - `NODE_VERSION = 22.12.0` (necesario para `node:sqlite`).
   - `SOA_SPEED = 3` (demo mas agil; pon `1` para los valores reales del documento).
4. **Create / Deploy**. Al terminar, Render te da una URL `https://soa-senor-de-luren.onrender.com`.
   Abre ahi el Counter, Rastreo y Monitoreo.

### Importante para la sustentacion (plan free de Render)
- El servicio **se duerme tras ~15 min de inactividad**; la primera visita luego tarda ~1 min
  en despertar. **Abre la URL 1-2 minutos antes de presentar** para que este caliente.
- El disco es **efimero**: las bases SQLite se reinician en cada redeploy o al despertar. Para
  la demo no es problema (los clientes de ejemplo se vuelven a sembrar; puedes reiniciar datos
  desde Monitoreo). **Recomendacion:** usa el despliegue como enlace para compartir, pero para
  la demo en vivo corre tambien localmente (`npm start`), que es lo mas confiable.

### Datos persistentes en Render (opcional, plan de pago)
1. En el servicio, agrega un **Disk** (p. ej. montado en `/var/data`).
2. Agrega la variable `SOA_DB_DIR = /var/data`. Las bases SQLite viviran en el disco y
   sobreviviran a los redeploys.

---

## Supabase (opcional, solo si quieres BD gestionada y persistente)

No es necesario para la demo. Si lo quieres mas adelante, el cambio es:
- Reemplazar `node:sqlite` por un cliente de Postgres (`pg`) en `src/data/db.js` y en los servicios.
- Usar la cadena de conexion de Supabase (`DATABASE_URL`) como variable de entorno.
- **Ventaja de diseno:** Postgres tiene *schemas* reales, asi que "un schema por servicio"
  (p. ej. `clientes.encomiendas`, `cobros.cobros`) seria aun mas fiel al documento que los
  archivos SQLite. Es una buena mejora, pero es trabajo adicional.

Si lo decides, avisame y lo adapto.
