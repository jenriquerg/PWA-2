/**
 * Server minimal con Express para Task Manager PWA:
 * - Rutas SSR (EJS) para Splash y Home
 * - Rutas estáticas en /public (app CSR)
 * - API /api/tasks (CRUD) y /api/sync (sincronización básica)
 * - Endpoints para suscripciones push (esqueleto)
 *
 * Para push: exporta VAPID_PUBLIC y VAPID_PRIVATE como variables de entorno
 * (genera con `npm run generate-vapid`).
 */
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// Datos de ejemplo (servidor remoto / API) - en memoria para demo
let TASKS = [
  { id: 1, title: 'Comprar leche', description: 'Leche entera 1L', completed: false, createdAt: Date.now() - 3600_000 },
  { id: 2, title: 'Enviar reporte', description: 'Enviar reporte semanal', completed: false, createdAt: Date.now() - 7200_000 }
];
let NEXT_ID = TASKS.length + 1;

// Memory store de suscripciones (demo). En producción guarda en DB.
const subscriptions = [];

// Configurar web-push si existen variables de entorno
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || null;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || null;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:example@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('Web-push VAPID configurado.');
} else {
  console.log('No se encontraron VAPID keys en env. Push de servidor no funcionará hasta que se configuren.');
}

// Rutas SSR
app.get('/splash', (req, res) => {
  res.render('splash');
});

// Home SSR: renderiza tareas desde el servidor
app.get('/', (req, res) => {
  res.render('home', { tasks: TASKS });
});

// SPA cliente
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// API: obtener todas las tareas
app.get('/api/tasks', (req, res) => {
  // Simular retraso
  setTimeout(() => {
    res.json({ ok: true, tasks: TASKS, ts: Date.now() });
  }, 300);
});

// API: crear tarea
app.post('/api/tasks', (req, res) => {
  const { title, description, completed, location, photo } = req.body;
  if (!title) return res.status(400).json({ ok:false, error: 'title required' });
  const task = {
    id: NEXT_ID++,
    title,
    description: description || '',
    completed: !!completed,
    location: location || null,
    photo: photo || null,
    createdAt: Date.now()
  };
  TASKS.push(task);
  res.json({ ok: true, task });
});

// API: actualizar tarea
app.put('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const t = TASKS.find(x => x.id === id);
  if (!t) return res.status(404).json({ ok:false, error: 'not found' });
  const { title, description, completed, location, photo } = req.body;
  if (typeof title !== 'undefined') t.title = title;
  if (typeof description !== 'undefined') t.description = description;
  if (typeof completed !== 'undefined') t.completed = completed;
  if (typeof location !== 'undefined') t.location = location;
  if (typeof photo !== 'undefined') t.photo = photo;
  res.json({ ok: true, task: t });
});

// API: borrar tarea
app.delete('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = TASKS.length;
  TASKS = TASKS.filter(x => x.id !== id);
  const deleted = TASKS.length !== before;
  res.json({ ok: true, deleted });
});

// Endpoint de sincronización básica: acepta lista de tareas del cliente y crea/actualiza en server
// - Para tareas nuevas enviadas sin `id` el server creará una nueva y devolverá el mapping localId->serverId
// - Para tareas con id existentes, actualiza el registro
app.post('/api/sync', (req, res) => {
  const incoming = req.body.tasks || [];
  const created = [];
  const updated = [];
  const mapping = []; // { localId, serverId }
  incoming.forEach(task => {
    if (task._localId && !task.id) {
      // tarea nueva desde cliente (local temp id)
      const newTask = {
        id: NEXT_ID++,
        title: task.title || 'Sin título',
        description: task.description || '',
        completed: !!task.completed,
        location: task.location || null,
        photo: task.photo || null,
        createdAt: Date.now()
      };
      TASKS.push(newTask);
      created.push(newTask);
      mapping.push({ localId: task._localId, serverId: newTask.id });
    } else if (task.id) {
      // actualizar existente
      const t = TASKS.find(x => x.id === Number(task.id));
      if (t) {
        t.title = typeof task.title !== 'undefined' ? task.title : t.title;
        t.description = typeof task.description !== 'undefined' ? task.description : t.description;
        t.completed = typeof task.completed !== 'undefined' ? task.completed : t.completed;
        t.location = typeof task.location !== 'undefined' ? task.location : t.location;
        t.photo = typeof task.photo !== 'undefined' ? task.photo : t.photo;
        updated.push(t);
      }
    }
  });
  res.json({ ok:true, created, updated, mapping });
});

// Guardar suscripción push desde el cliente
app.post('/api/save-subscription', (req, res) => {
  const sub = req.body;
  if (sub && sub.endpoint) {
    subscriptions.push(sub);
    res.json({ ok: true });
  } else {
    res.status(400).json({ ok: false, error: 'Invalid subscription' });
  }
});

// Enviar notificación a suscripciones guardadas (esqueleto)
app.post('/api/send-notification', async (req, res) => {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(500).json({ ok:false, error: 'VAPID keys not configured on server' });
  }
  const payload = JSON.stringify({
    title: req.body.title || 'Notificación desde servidor',
    body: req.body.body || 'Mensaje de prueba'
  });
  const results = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      results.push({ sub: sub.endpoint, ok: true });
    } catch (err) {
      results.push({ sub: sub.endpoint, ok: false, error: err.message });
    }
  }
  res.json({ ok: true, results });
});

app.listen(PORT, () => {
  console.log('Server listening on http://localhost:' + PORT);
  console.log('Rutas: / (SSR), /app (CSR SPA), /splash');
});
