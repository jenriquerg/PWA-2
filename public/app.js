// Task Manager client-side (CSR)
// - IndexedDB local store (clientId key)
// - Sync with server (/api/tasks and /api/sync)
// - Camera capture, geolocation, notifications, vibration
// - Offline-first: allow crear/editar/borrar sin conexión y sincronizar cuando vuelva a estar online

const DB_NAME = 'pwa-task-db';
const DB_STORE = 'tasks';

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        const store = db.createObjectStore(DB_STORE, { keyPath: 'clientId' });
        store.createIndex('by_createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}

async function saveTaskLocal(task) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  if (!task.clientId) {
    task.clientId = 'l:' + Date.now(); // local temporary id
    task._localId = task.clientId; // helpful for sync mapping
  }
  task.dirty = true; // mark for sync
  task.createdAt = task.createdAt || Date.now();
  store.put(task);
  return tx.complete;
}

async function putTaskLocalNoDirty(task) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  task.dirty = false;
  store.put(task);
  return tx.complete;
}

async function getAllTasksLocal() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => res(req.result.sort((a,b) => b.createdAt - a.createdAt));
    req.onerror = e => rej(e);
  });
}

async function deleteTaskLocal(clientId) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  const taskReq = store.get(clientId);
  taskReq.onsuccess = () => {
    const t = taskReq.result;
    if (!t) return;
    if (clientId.startsWith('s:')) {
      // mark deleted and dirty so sync will delete on server
      t.deleted = true;
      t.dirty = true;
      store.put(t);
    } else {
      // local-only task: remove immediately
      store.delete(clientId);
    }
  };
  return tx.complete;
}

async function replaceLocalWithServer(localClientId, serverTask) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  // delete old local entry
  store.delete(localClientId);
  // insert server task with clientId 's:<id>'
  const clientId = 's:' + serverTask.id;
  const newTask = Object.assign({}, serverTask, { clientId, dirty: false, _localId: null });
  store.put(newTask);
  return tx.complete;
}

async function markTaskSynced(clientId, serverTask) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  const req = store.get(clientId);
  req.onsuccess = () => {
    const t = req.result;
    if (!t) return;
    // update fields from serverTask
    t.title = serverTask.title;
    t.description = serverTask.description;
    t.completed = serverTask.completed;
    t.location = serverTask.location;
    t.photo = serverTask.photo;
    t.dirty = false;
    store.put(t);
  };
  return tx.complete;
}

// UI refs
const titleInput = document.getElementById('titleInput');
const descInput = document.getElementById('descInput');
const createTaskBtn = document.getElementById('createTask');
const tasksList = document.getElementById('tasksList');
const syncBtn = document.getElementById('syncBtn');
const statusEl = document.getElementById('status');
const getLocationBtn = document.getElementById('getLocation');
const openCameraBtn = document.getElementById('openCamera');
const cameraPreview = document.getElementById('cameraPreview');
const photoCanvas = document.getElementById('photoCanvas');
const createResult = document.getElementById('createResult');

let currentLocation = null;
let mediaStream = null;
let latestPhotoDataUrl = null;

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/public/sw.js').then(reg => {
    console.log('SW registrado', reg);
  }).catch(err => console.error('SW fallo', err));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
      installBtn.style.display = 'inline-block';
      installBtn.addEventListener('click', async () => {
        e.prompt();
        const choice = await e.userChoice;
        installBtn.style.display = 'none';
      });
    }
  });
}

// UI: render tasks from local DB
async function renderTasks() {
  const tasks = await getAllTasksLocal();
  tasksList.innerHTML = '';
  tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'task';
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '12px';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!t.completed;
    cb.addEventListener('change', async () => {
      t.completed = cb.checked;
      t.dirty = true;
      await putTaskLocalNoDirty(t); // mark dirty false locally for immediate UI update, but we'll mark dirty true then sync
      // Actually set dirty true to sync
      const db = await openDB();
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      t.dirty = true;
      store.put(t);
      tx.complete && tx.complete.then(()=>{});
      status('Tarea marcada. Sincronizando...');
      try { await syncPendingTasks(); status('Sincronizado.'); } catch(e){ status('Sincronización pendiente.'); }
      renderTasks();
      if (navigator.vibrate) navigator.vibrate(120);
    });

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.innerHTML = '<strong>' + escapeHtml(t.title) + '</strong>';
    const desc = document.createElement('div');
    desc.className = 'muted';
    desc.textContent = t.description || '';

    info.appendChild(title);
    info.appendChild(desc);

    left.appendChild(cb);
    left.appendChild(info);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    const syncBadge = document.createElement('span');
    syncBadge.className = 'muted';
    syncBadge.textContent = t.clientId.startsWith('l:') ? 'offline' : (t.dirty ? 'pendiente' : 'ok');
    right.appendChild(syncBadge);

    if (t.photo) {
      const img = document.createElement('img');
      img.src = t.photo;
      img.style.maxWidth = '64px';
      img.style.borderRadius = '6px';
      right.appendChild(img);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'btn';
    delBtn.textContent = 'Borrar';
    delBtn.addEventListener('click', async () => {
      if (!confirm('¿Borrar tarea?')) return;
      await deleteTaskLocal(t.clientId);
      status('Tarea borrada localmente. Sincronizando...');
      try { await syncPendingTasks(); status('Sincronizado.'); } catch(e){ status('Sincronización pendiente.'); }
      renderTasks();
    });

    right.appendChild(delBtn);

    div.appendChild(left);
    div.appendChild(right);

    tasksList.appendChild(div);
  });
}

// Helpers
function status(txt) {
  statusEl.textContent = txt;
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

// Create new task
createTaskBtn.addEventListener('click', async () => {
  const title = titleInput.value && titleInput.value.trim();
  const desc = descInput.value && descInput.value.trim();
  if (!title) return alert('Escribe un título para la tarea.');
  const task = {
    title,
    description: desc || '',
    completed: false,
    location: currentLocation || null,
    photo: latestPhotoDataUrl || null,
    createdAt: Date.now()
  };
  // save local and mark dirty
  await saveTaskLocal(task);
  titleInput.value = '';
  descInput.value = '';
  latestPhotoDataUrl = null;
  createResult.textContent = 'Tarea creada localmente.';
  renderTasks();
  // try sync immediately if online
  if (navigator.onLine) {
    status('Sincronizando nueva tarea...');
    try { await syncPendingTasks(); status('Sincronizado.'); } catch(e){ status('Sync falló, pendiente.'); }
    renderTasks();
  } else {
    status('Offline: tarea pendiente de sincronización.');
  }
});

// Get location
getLocationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation no soportada.');
  navigator.geolocation.getCurrentPosition(pos => {
    currentLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    createResult.textContent = 'Ubicación añadida: ' + currentLocation.lat.toFixed(4) + ', ' + currentLocation.lon.toFixed(4);
  }, err => {
    createResult.textContent = 'Error geolocalización: ' + err.message;
  }, { timeout: 10000 });
});

// Camera: open and capture a single photo
openCameraBtn.addEventListener('click', async () => {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    cameraPreview.srcObject = mediaStream;
    cameraPreview.style.display = 'block';
    photoCanvas.style.display = 'none';
    // add a small capture UI: change button to "Capturar" temporarily
    openCameraBtn.textContent = 'Capturar foto';
    const handler = async () => {
      // capture frame to canvas
      const video = cameraPreview;
      photoCanvas.width = video.videoWidth || 640;
      photoCanvas.height = video.videoHeight || 480;
      const ctx = photoCanvas.getContext('2d');
      ctx.drawImage(video, 0, 0, photoCanvas.width, photoCanvas.height);
      latestPhotoDataUrl = photoCanvas.toDataURL('image/jpeg', 0.8);
      photoCanvas.style.display = 'block';
      cameraPreview.style.display = 'none';
      // stop camera
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
      openCameraBtn.textContent = 'Tomar foto';
      openCameraBtn.removeEventListener('click', handler);
      createResult.textContent = 'Foto capturada y añadida a la tarea.';
    };
    openCameraBtn.removeEventListener('click', null);
    openCameraBtn.addEventListener('click', handler);
  } catch (err) {
    alert('No se pudo abrir la cámara: ' + err.message);
  }
});

// Sync logic
async function syncPendingTasks() {
  if (!navigator.onLine) throw new Error('offline');
  const all = await getAllTasksLocal();
  // First: create local-only tasks (clientId starts with 'l:')
  for (const t of all) {
    if (t.deleted) continue; // deletions handled later
    if (t.clientId && t.clientId.startsWith('l:')) {
      // Post to server
      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            title: t.title,
            description: t.description,
            completed: t.completed,
            location: t.location,
            photo: t.photo
          })
        });
        const json = await res.json();
        if (json && json.ok && json.task) {
          // replace local record with server-backed record
          await replaceLocalWithServer(t.clientId, json.task);
        }
      } catch (e) {
        console.warn('Error creando tarea en server', e);
        throw e;
      }
    }
  }

  // Refresh list after creations
  const afterCreate = await getAllTasksLocal();

  // Second: handle updates and deletions for server-backed tasks (clientId starts 's:')
  for (const t of afterCreate) {
    if (t.clientId && t.clientId.startsWith('s:')) {
      const serverId = Number(t.clientId.split(':')[1]);
      if (t.deleted) {
        // delete on server
        try {
          await fetch('/api/tasks/' + serverId, { method: 'DELETE' });
          // remove locally
          const db = await openDB();
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(t.clientId);
        } catch (e) {
          console.warn('Error borrando en server', e);
          throw e;
        }
      } else if (t.dirty) {
        // update server
        try {
          await fetch('/api/tasks/' + serverId, {
            method: 'PUT',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
              title: t.title,
              description: t.description,
              completed: t.completed,
              location: t.location,
              photo: t.photo
            })
          });
          // mark not dirty
          t.dirty = false;
          await putTaskLocalNoDirty(t);
        } catch (e) {
          console.warn('Error actualizando en server', e);
          throw e;
        }
      }
    }
  }
  // Optionally, fetch server tasks to reconcile (pull)
  try {
    const res = await fetch('/api/tasks');
    const json = await res.json();
    if (json && json.ok) {
      // Merge server tasks into local DB (ensure no duplicates)
      for (const st of json.tasks) {
        const clientId = 's:' + st.id;
        await putTaskLocalNoDirty(Object.assign({}, st, { clientId }));
      }
    }
  } catch (e) {
    console.warn('Error al obtener tasks del servidor', e);
  }

  renderTasks();
}

// Initial load: sync if online, else render local
window.addEventListener('load', async () => {
  renderTasks();
  if (navigator.onLine) {
    status('Online: sincronizando...');
    try { await syncPendingTasks(); status('Sincronizado.'); } catch(e){ status('Sincronización incompleta.'); }
    renderTasks();
  } else {
    status('Offline: trabajando con datos locales.');
  }
});

window.addEventListener('online', async () => {
  status('Vuelves a estar online: sincronizando...');
  try { await syncPendingTasks(); status('Sincronizado.'); } catch(e){ status('Sincronización incompleta.'); }
  renderTasks();
});

window.addEventListener('offline', () => {
  status('Offline: cambios se guardarán localmente.');
});

syncBtn.addEventListener('click', async () => {
  if (!navigator.onLine) return alert('Estás offline.');
  status('Sincronizando manualmente...');
  try { await syncPendingTasks(); status('Sincronizado.'); } catch(e){ status('Sync falló.'); }
});

// Notifications (local)
const notifBtn = document.getElementById('notifBtn');
notifBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) return alert('Este navegador no soporta Notifications API.');
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'granted') {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('Task Manager', { body: 'Notificaciones listas.' });
    } else {
      new Notification('Task Manager', { body: 'Notificaciones listas.' });
    }
  } else {
    alert('Permiso denegado para notificaciones.');
  }
});

// Push subscription (esqueleto)
const subscribePushBtn = document.getElementById('subscribePush');
subscribePushBtn.addEventListener('click', async () => {
  if (!('serviceWorker' in navigator)) return alert('Service worker requerido para Push.');
  if (!('PushManager' in window)) return alert('Push no soportado en este navegador.');
  const publicKey = prompt('Pega la VAPID PUBLIC KEY (server): (o deja vacío para demo local)');
  const reg = await navigator.serviceWorker.ready;
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey ? urlBase64ToUint8Array(publicKey) : undefined
    });
    await fetch('/api/save-subscription', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(sub) });
    alert('Suscripción guardada en el servidor (demo).');
  } catch (err) {
    alert('No se pudo suscribir: ' + err.message);
  }
});

const triggerServerPushBtn = document.getElementById('triggerServerPush');
triggerServerPushBtn.addEventListener('click', async () => {
  const title = prompt('Título de notificación', 'Recordatorio de tareas');
  const body = prompt('Cuerpo', 'Tienes tareas pendientes.');
  const res = await fetch('/api/send-notification', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title, body })
  });
  const json = await res.json();
  document.getElementById('pushResult').textContent = JSON.stringify(json, null, 2);
});

// Helper: convert base64 to Uint8Array
function urlBase64ToUint8Array(base64String) {
  if (!base64String) return undefined;
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i=0;i<rawData.length;++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
