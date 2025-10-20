# PWA Task Manager

Una Progressive Web App completa que funciona 100% offline. Crea, edita y gestiona tus tareas desde cualquier lugar, incluso sin conexión a internet.

- **Funciona sin internet**: Todas tus tareas se guardan localmente
- **Sincronización automática**: Cuando vuelvas online, todo se sincroniza solo
- **Instalable**: Agrégala a tu pantalla de inicio como app nativa
- **Push notifications**: Recibe recordatorios aunque tengas la app cerrada
- **Funciones de dispositivo**: Toma fotos, agrega ubicación GPS a tus tareas

## Tecnologías usadas

- **Frontend**: Vanilla JavaScript (sin frameworks, puro y simple)
- **Backend**: Node.js + Express
- **Base de datos local**: IndexedDB (para guardar tareas offline)
- **Base de datos remota**: Memoria del servidor (API REST)
- **Service Worker**: Para caché y funcionamiento offline
- **Push Notifications**: Web Push API con VAPID

---

## Arquitectura del App Shell

El App Shell es la estructura básica de la app que se carga primero y queda en caché. Funciona como el "esqueleto" de la aplicación.

### ¿Qué se cachea? (App Shell estático)

Estos archivos se descargan y guardan la primera vez que visitas la app:

```
- /app                      → Ruta principal
- /public/app.html          → Estructura HTML (header, footer, secciones)
- /public/app.js            → Lógica de la aplicación
- /public/manifest.json     → Configuración de la PWA
- /public/icons/*.png       → Iconos de la app
- /public/offline.html      → Página de emergencia sin conexión
```

### ¿Qué es dinámico? (Se carga bajo demanda)

El contenido cambia según lo que hagas:

- **Lista de tareas**: Se renderizan desde IndexedDB
- **Fotos capturadas**: Se guardan como base64 en las tareas
- **Datos del servidor**: Se obtienen de `/api/tasks` cuando hay internet

### Componentes del App Shell

**`public/app.html`** tiene tres partes principales:

1. **Header** (líneas 18-122)
   - Título de la app
   - Botón "Instalar App" (aparece solo si es instalable)
   - Indicador de estado (online/offline)
   - Navegación entre vista SSR y CSR

2. **Contenido dinámico** (líneas 124-164)
   - Formulario para crear tareas
   - Lista de tareas (renderizada por JavaScript)
   - Controles de cámara, geolocalización y sincronización
   - Sección de notificaciones push

3. **Footer** (líneas 166-182)
   - Información de la app
   - Enlaces de navegación
   - Versión actual

---

## Estrategias de caché del Service Worker

El Service Worker (`public/sw.js`) usa dos estrategias diferentes según el tipo de contenido:

### 1. Cache First (para assets estáticos)

Para archivos que no cambian mucho (HTML, CSS, JS, imágenes):

```
Usuario pide archivo
    ↓
¿Está en caché? → SÍ → Devuelve versión cacheada ⚡
    ↓ NO
Descarga de internet → Guarda copia en caché → Devuelve archivo
```

**Ventaja**: Super rápido, funciona offline

### 2. Network First (para APIs)

Para datos que cambian frecuentemente (`/api/*`):

```
Usuario pide datos
    ↓
Intenta descargar de internet
    ↓
¿Funcionó? → SÍ → Actualiza caché → Devuelve datos frescos 🔄
    ↓ NO (sin internet)
Busca en caché → Devuelve última versión guardada
    ↓ (si no hay caché)
Devuelve respuesta offline vacía
```

**Ventaja**: Datos actualizados cuando hay internet, fallback cuando no

---

## Estructura del proyecto

```
/PWA 2
  /public
    app.html          → Interfaz principal (App Shell)
    app.js            → Lógica del cliente (IndexedDB, sync, UI)
    sw.js             → Service Worker (caché y push)
    manifest.json     → Configuración PWA (nombre, iconos, colores)
    offline.html      → Página de emergencia sin conexión
    /icons
      icon-192.png    → Icono pequeño
      icon-512.png    → Icono grande
  /views
    splash.ejs        → Pantalla inicial (SSR)
    home.ejs          → Vista home (SSR)
  server.js           → Servidor Express + API REST
  package.json        → Dependencias
  generate-vapid.js   → Generador de claves para push
  README.md           → Este archivo
```

---

## Instalación y configuración

### Paso 1: Instalar dependencias

```bash
npm install
```

Esto instala:
- Express (servidor web)
- EJS (templates)
- web-push (notificaciones)

### Paso 2: Generar claves VAPID (opcional, para push notifications)

```bash
npm run generate-vapid
```

Esto crea un archivo `vapid.json` con las claves públicas y privadas.

### Paso 3: Ejecutar el servidor

```bash
npm run dev
```

O simplemente:

```bash
node server.js
```

### Paso 4: Abrir en el navegador

Visita: **http://localhost:3000/app**

---

## Cómo probar el modo offline (paso a paso)

### Opción 1: Usando DevTools (recomendado)

1. Abre la app en Chrome: `http://localhost:3000/app`
2. Abre las DevTools (F12)
3. Ve a la pestaña **Application** > **Service Workers**
4. Verifica que el SW esté activo 
5. Marca el checkbox **Offline**
6. Recarga la página → ¡Debería seguir funcionando!
7. Crea una tarea nueva → Se guarda localmente
8. Desmarca **Offline** y haz clic en **Sincronizar** → Se envía al servidor

### Opción 2: Apagando el servidor

1. Abre la app: `http://localhost:3000/app`
2. Espera a que cargue completamente
3. Para el servidor (Ctrl+C en la terminal donde corre Node)
4. Recarga la página → Sigue funcionando desde caché
5. Crea tareas → Se guardan en IndexedDB
6. Vuelve a iniciar el servidor: `npm run dev`
7. Haz clic en **Sincronizar** → Las tareas se envían al servidor

### Opción 3: Modo avión (mobile)

1. Instala la PWA en tu celular
2. Abre la app y úsala normalmente
3. Activa el modo avión ✈️
4. Sigue creando y editando tareas
5. Desactiva el modo avión
6. Sincroniza → Todo se guarda en el servidor

---

## Sincronización: ¿Cómo funciona?

El sistema de sync es inteligente y detecta qué tareas necesitan actualizarse.

### Estados de las tareas

Cada tarea tiene un `clientId` que indica su origen:

- **`l:1234567890`** → Creada offline (local)
  - Badge: 🟣 OFFLINE
  - Estado: `dirty: true`

- **`s:42`** → Creada online y sincronizada (server)
  - Badge: 🟢 OK
  - Estado: `dirty: false`

- **`s:42` con cambios** → Modificada localmente
  - Badge: 🟠 PENDIENTE
  - Estado: `dirty: true`

### Flujo de sincronización

```
1. Usuario crea tarea offline
   ↓
   Guarda en IndexedDB con clientId: "l:timestamp"

2. Conexión vuelve (auto o manual)
   ↓
   POST /api/tasks → Envía tarea al servidor
   ↓
   Servidor devuelve task con id: 42
   ↓
   Reemplaza "l:timestamp" por "s:42" en IndexedDB

3. Usuario edita tarea s:42
   ↓
   Marca como dirty: true
   ↓
   PUT /api/tasks/42 → Actualiza en servidor
   ↓
   Marca como dirty: false

4. Usuario borra tarea s:42
   ↓
   Marca como deleted: true, dirty: true
   ↓
   DELETE /api/tasks/42 → Borra del servidor
   ↓
   Elimina de IndexedDB
```

### Sincronización automática

La app sincroniza en estos momentos:

-  Al cargar la página (si hay internet)
-  Al crear una nueva tarea
-  Al editar una tarea existente
-  Al detectar que volvió la conexión (`online` event)
-  Al hacer clic en el botón "Sincronizar"

---

## Funciones de dispositivo

### Geolocalización GPS

```javascript
// Agrega la ubicación actual a la tarea
navigator.geolocation.getCurrentPosition(pos => {
  // Guarda lat y lon en la tarea
})
```

### Cámara

```javascript
// Abre la cámara trasera
navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }})
// Captura frame del video y lo convierte a base64
```

### Vibración

```javascript
// Vibra 50ms al marcar una tarea como completada
navigator.vibrate(50)
```

---

## Push Notifications

### Configuración automática

Al abrir la app, se configura automáticamente:

1. Pide permiso para notificaciones
2. Se suscribe al servidor con claves VAPID
3. Guarda la suscripción en el servidor

### Probar notificaciones

1. Ve a la sección "Notificaciones Push"
2. Expande "Opciones de desarrollo"
3. Haz clic en:
   - **Notificación local** → Muestra notif desde el cliente
   - **Test Push servidor** → Envía desde el servidor a todos

---

## API REST (Endpoints)

```
GET    /api/tasks              → Obtener todas las tareas
POST   /api/tasks              → Crear nueva tarea
PUT    /api/tasks/:id          → Actualizar tarea
DELETE /api/tasks/:id          → Eliminar tarea
GET    /api/vapid-public       → Obtener clave pública VAPID
POST   /api/save-subscription  → Guardar suscripción push
POST   /api/send-notification  → Enviar notificación a todos
```

---

## Cómo instalar la PWA

### En escritorio (Chrome/Edge)

1. Abre la app: `http://localhost:3000/app`
2. Aparece el botón "Instalar App" en el header
3. Haz clic y confirma
4. Se abre en ventana independiente
5. Queda en tu menú de aplicaciones

### En móvil (Android/iOS)

1. Abre en Chrome/Safari
2. Menú → "Agregar a pantalla de inicio"
3. Se agrega el icono
4. Funciona como app nativa

---

## Solución de problemas

### El Service Worker no se registra

- Verifica que estés usando HTTPS o `localhost`
- Revisa la consola del navegador (F12)
- Ve a Application > Service Workers y busca errores

### Las tareas no se sincronizan

- Verifica que el servidor esté corriendo
- Revisa la consola: debe decir "Sincronizado"
- Comprueba que `navigator.onLine` sea `true`

### Push notifications no funcionan

- Genera claves VAPID: `npm run generate-vapid`
- Asegúrate de aceptar permisos de notificaciones
- Revisa que el Service Worker esté activo