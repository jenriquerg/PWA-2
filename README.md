# PWA Task Manager — Plantilla práctica (ES)

Esta plantilla contiene un ejemplo funcional de una **Progressive Web App (PWA)** que implementa un **Task Manager** con:
- Pantalla Splash y Home (SSR).
- Vista cliente (CSR) con CRUD de tareas, offline y sincronización con servidor.
- Datos locales: IndexedDB.
- Datos remotos: API REST `/api/tasks` (server).
- Service Worker con caching básico y soporte para mostrar notificaciones push (esqueleto).
- Uso de elementos de dispositivo: vibración, geolocalización y cámara.

## Estructura
```
/pwa-case-study
  /public
    manifest.json
    sw.js
    app.html
    app.js
    icons/
  /views
    splash.ejs
    home.ejs
  server.js
  package.json
  generate-vapid.js
  README.md
```

## Cómo probarlo localmente (resumen)
1. Instala dependencias:
   ```bash
   npm install
   ```
2. Ejecuta el servidor:
   ```bash
   npm run dev
   ```
3. Abre `http://localhost:3000/app` en tu navegador.
4. Prueba crear tareas (funciona offline), tomar foto, añadir ubicación y sincronizar.
5. Para probar push desde el servidor:
   - Genera VAPID keys: `npm run generate-vapid`
   - Exporta `VAPID_PUBLIC` y `VAPID_PRIVATE` en tu entorno
   - Reinicia el servidor y usa las opciones de Push en la app.

## Sincronización (cómo funciona)
- Las tareas creadas offline se guardan localmente con `clientId` que comienza con `l:`.
- Cuando el cliente vuelve online, se envían al servidor (`POST /api/tasks`) y se reemplazan por registros con `clientId` `s:<id>` (server id).
- Las actualizaciones y eliminaciones de tareas server-backed se sincronizan con `PUT /api/tasks/:id` y `DELETE /api/tasks/:id`.

---
Si quieres, ahora:
1) Te guío a probar la creación y sincronización en tu máquina.  
2) Añadimos edición de tareas (UI para editar).  
3) Añadimos background sync con Service Worker / Workbox.  
4) Implemento recordatorios push programados (requiere VAPID y un job scheduler).

Dime qué paso quieres ahora y seguimos paso a paso.
