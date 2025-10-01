/**
 * Server minimal con Express para Task Manager PWA:
 * - Rutas SSR (EJS) para Splash y Home
 * - Rutas estáticas en /public (app CSR)
 * - API /api/tasks (CRUD) y /api/sync (sincronización básica)
 * - Endpoints para suscripciones push
 * - VAPID generado automáticamente si no existe
 */

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// Datos de ejemplo (en memoria para demo)
let TASKS = [
  { id: 1, title: 'Comprar leche', description: 'Leche entera 1L', completed: false, createdAt: Date.now() - 3600_000 },
  { id: 2, title: 'Enviar reporte', description: 'Enviar reporte semanal', completed: false, createdAt: Date.now() - 7200_000 }
];
let NEXT_ID = TASKS.length + 1;

// Memory store de suscripciones (demo). En producción guarda en DB.
const subscriptions = [];

// --- VAPID automático ---
const vapidFile = path.join(__dirname, 'vapid.json');
let VAPID_PUBLIC, VAPID_PRIVATE;

if (fs.existsSync(vapidFile)) {
  const vapidData = JSON.parse(fs.readFileSync(vapidFile));
  VAPID_PUBLIC = vapidData.publicKey;
  VAPID_PRIVATE = vapidData.privateKey;
} else {
  const vapidKeys = webpush.generateVAPIDKeys();
  VAPID_PUBLIC = vapidKeys.publicKey;
  VAPID_PRIVATE = vapidKeys.privateKey;
  fs.writeFileSync(vapidFile, JSON.stringify(vapidKeys));
  console.log('Claves VAPID generadas automáticamente.');
}

webpush.setVapidDetails('mailto:example@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
console.log('Web-push VAPID configurado.');

// --- Rutas SSR ---
app.get('/', (_req, res) => res.render('splash'));
app.get('/splash', (_req, res) => res.render('splash'));
app.get('/home', (_req, res) => res.render('home', { tasks: TASKS }));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// --- API de tareas ---
app.get('/api/tasks', (_req, res) => setTimeout(() => res.json({ ok:true, tasks:TASKS, ts: Date.now() }), 300));

app.post('/api/tasks', (req, res) => {
  const { title, description, completed, location, photo } = req.body;
  if (!title) return res.status(400).json({ ok:false, error: 'title required' });
  const task = { id:NEXT_ID++, title, description:description||'', completed:!!completed, location:location||null, photo:photo||null, createdAt:Date.now() };
  TASKS.push(task);
  res.json({ ok:true, task });
});

app.put('/api/tasks/:id', (req, res) => {
  const t = TASKS.find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ ok:false, error:'not found' });
  Object.assign(t, req.body);
  res.json({ ok:true, task: t });
});

app.delete('/api/tasks/:id', (req, res) => {
  const before = TASKS.length;
  TASKS = TASKS.filter(x => x.id !== Number(req.params.id));
  res.json({ ok:true, deleted:TASKS.length !== before });
});

// --- Sync básica ---
app.post('/api/sync', (req, res) => {
  const incoming = req.body.tasks||[];
  const created=[], updated=[], mapping=[];
  incoming.forEach(task => {
    if (task._localId && !task.id) {
      const newTask = { id:NEXT_ID++, title:task.title||'Sin título', description:task.description||'', completed:!!task.completed, location:task.location||null, photo:task.photo||null, createdAt:Date.now() };
      TASKS.push(newTask);
      created.push(newTask);
      mapping.push({ localId: task._localId, serverId: newTask.id });
    } else if (task.id) {
      const t = TASKS.find(x => x.id===Number(task.id));
      if (t) Object.assign(t, task), updated.push(t);
    }
  });
  res.json({ ok:true, created, updated, mapping });
});

// --- Push ---
app.get('/api/vapid-public', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

app.post('/api/save-subscription', (req, res) => {
  const sub = req.body;
  if (sub && sub.endpoint) { subscriptions.push(sub); res.json({ ok:true }); }
  else res.status(400).json({ ok:false, error:'Invalid subscription' });
});

app.post('/api/send-notification', async (req, res) => {
  const payload = JSON.stringify({
    title: req.body.title || 'Notificación desde servidor',
    body: req.body.body || 'Mensaje de prueba'
  });
  
  const results = await Promise.all(subscriptions.map(async sub => {
    try { await webpush.sendNotification(sub, payload); return { sub: sub.endpoint, ok:true }; }
    catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) subscriptions.splice(subscriptions.indexOf(sub), 1);
      return { sub: sub.endpoint, ok:false, error: err.message };
    }
  }));

  res.json({ ok:true, results });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log('Rutas: / (SSR), /app (CSR SPA), /splash');
});
