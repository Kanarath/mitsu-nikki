# 三つ日記 · Mitsu Nikki

Diario nocturno de gratitud: **tres cosas buenas de cada día**. Es una PWA estática (HTML, CSS y JavaScript sin dependencias) pensada para usarla en el móvil Android a las 21:00, y se publica en GitHub Pages.

- Las entradas se guardan **al instante en el móvil** (`localStorage`) y la app funciona sin conexión.
- Si configuras un token, se sincronizan con `data.json` de este repositorio a través de la API de GitHub.
- `data.json` se sube **cifrado** (AES-GCM de 256 bits, con la clave derivada de tu frase secreta mediante PBKDF2). El repositorio es público, pero sin la frase nadie puede leer el diario.
- Calendario con sello *hanko* rojo en los días con las 3 cosas y un punto dorado en los días con 1 o 2.
- *Omikuji*: un recuerdo aleatorio de un día bueno del pasado.
- Recordatorio nocturno con aviso del navegador, Google Calendar o archivo `.ics`.
- Exportar e importar una copia de seguridad.

---

## 1. Activar GitHub Pages

1. Crea en GitHub un repositorio **público** llamado `mitsu-nikki` (en <https://github.com/new>). No añadas README ni licencia, porque ya vienen en este proyecto.
2. Sube el proyecto desde esta carpeta:

   ```bash
   git remote add origin https://github.com/Kanarath/mitsu-nikki.git
   git push -u origin main
   ```

3. En el repositorio, ve a **Settings → Pages**.
4. En *Build and deployment*, deja **Source: Deploy from a branch**, elige la rama **`main`** y la carpeta **`/ (root)`**, y pulsa **Save**.
5. Espera 1 o 2 minutos. La app estará en:
   **<https://kanarath.github.io/mitsu-nikki/>**

### Instalarla en el móvil (Android)

1. Abre esa dirección en **Chrome**.
2. Menú ⋮ → **Añadir a pantalla de inicio** → **Instalar**.
3. Ábrela desde el icono del torii. Se abre a pantalla completa, como una app más.

---

## 2. Crear el token (Fine-grained Personal Access Token)

El token permite que la app escriba `data.json` en tu repositorio, y **solo** en ese repositorio.

1. Entra en <https://github.com/settings/personal-access-tokens/new>
   (o *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*).
2. Rellena:
   - **Token name:** `mitsu-nikki-movil`
   - **Expiration:** el plazo que prefieras (por ejemplo, 1 año). Cuando caduque, crea otro y pégalo en la app.
   - **Resource owner:** tu usuario (`Kanarath`).
   - **Repository access:** **Only select repositories** → elige **`mitsu-nikki`**.
3. En **Permissions → Repository permissions**, busca **Contents** y ponlo en **Read and write**.
   No toques nada más. *Metadata: Read-only* se añade solo y es obligatorio.
4. Pulsa **Generate token** y **copia el token** (empieza por `github_pat_…`). GitHub no te lo vuelve a mostrar.

### Conectarlo en la app

1. En la app, pulsa el botón de ajustes (arriba a la derecha).
2. Comprueba que **Usuario** es `Kanarath` y **Repositorio** es `mitsu-nikki`.
3. Pega el **token**.
4. Escribe una **frase secreta de cifrado**. Elige una larga y fácil de recordar, por ejemplo cuatro palabras al azar.
   **Si la pierdes, el diario de GitHub no se puede descifrar.** La copia de tu móvil seguiría ahí.
5. Pulsa **Probar** para comprobar el acceso y luego **Conectar**.

El punto del botón de ajustes indica el estado: dorado es sincronizado, gris es solo local o sin conexión y rojo es un error.

> **Seguridad.** El token y la frase se guardan solo en el navegador de tu móvil y nunca aparecen en el código del repositorio. Sin token, nadie más puede subir cambios. Sin la frase, nadie puede leer el contenido. Si pierdes el móvil, revoca el token en GitHub (*Fine-grained tokens → Delete*).

---

## 3. Recordatorio de las 21:00

En **Ajustes → Recordatorio nocturno**:

- **Avisos**: activa las notificaciones de Chrome y elige la hora (21:00 por defecto). Como GitHub Pages no tiene servidor, el aviso llega mientras la app esté abierta o en segundo plano. Si la instalas, Chrome puede además despertarla de vez en cuando (*Periodic Background Sync*), pero Android no lo garantiza.
- **Google Calendar** (recomendado en Android): crea un evento que se repite cada día a las 21:00 con el enlace a la app. Con esto el móvil te avisa todas las noches aunque la app esté cerrada.
- **Descargar .ics**: el mismo evento recurrente en un archivo estándar, para otros calendarios. La app de Google Calendar de Android no importa archivos `.ics` directamente; para Google usa el botón anterior, o importa el `.ics` desde calendar.google.com en el ordenador.

---

## Estructura

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Interfaz: Hoy, Calendario, Omikuji y Ajustes |
| `styles.css` | Estética nocturna *wabi-sabi* |
| `app.js` | Lógica: diario, calendario, cifrado, sincronización y recordatorios |
| `sw.js` | Service worker: funcionamiento sin conexión y avisos |
| `manifest.json` | Datos para instalar la PWA |
| `data.json` | Tu diario cifrado; al principio es `[]` |
| `icons/` | Logo e iconos de la app |

### Formato de `data.json`

```json
{ "app": "mitsu-nikki", "v": 1, "alg": "AES-GCM-256", "kdf": "PBKDF2-SHA256",
  "iter": 250000, "salt": "…", "iv": "…", "data": "…" }
```

Dentro de `data`, una vez descifrado: `{ "entries": { "2026-11-13": { "items": ["…","…","…"], "updated": "ISO-8601" } } }`.
La sincronización fusiona día a día y, si un día está en los dos lados, gana la edición más reciente.

### Probar en local

```bash
python -m http.server 5510
```

Después abre <http://localhost:5510>.

---

## Problemas frecuentes

- **"El token no tiene permiso de escritura"**: revisa que *Contents* esté en **Read and write** y que el token incluya el repositorio `mitsu-nikki`.
- **"La frase secreta no coincide"**: la frase no es la misma con la que se cifró `data.json`. Escríbela exactamente igual; distingue mayúsculas y minúsculas.
- **No veo los últimos cambios de la app tras actualizarla**: ciérrala del todo y ábrela otra vez. El service worker se actualiza en la siguiente apertura.
