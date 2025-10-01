// spp.js — Task Manager CSR (cliente)
const DB_NAME = 'pwa-task-db';
const DB_STORE = 'tasks';

// --- IndexedDB ---
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
    task.clientId = 'l:' + Date.now();
    task._localId = task.clientId;
  }
  task.dirty = true;
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
      t.deleted = true;
      t.dirty = true;
      store.put(t);
    } else {
      store.delete(clientId);
    }
  };
  return tx.complete;
}

async function replaceLocalWithServer(localClientId, serverTask) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  store.delete(localClientId);
  const clientId = 's:' + serverTask.id;
  const newTask = Object.assign({}, serverTask, { clientId, dirty: false, _localId: null });
  store.put(newTask);
  return tx.complete;
}

// --- UI refs ---
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

// --- Service Worker ---
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

// --- Render tasks ---
async function renderTasks() {
  const tasks = await getAllTasksLocal();
  tasksList.innerHTML = '';

  tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'task';

    // Left: checkbox + info
    const left = document.createElement('div');
    left.className = 'task-left';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'task-checkbox';
    cb.checked = !!t.completed;
    cb.addEventListener('change', async () => {
      t.completed = cb.checked;
      t.dirty = true;
      const db = await openDB();
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(t);
      status('✓ Tarea actualizada');
      try { await syncPendingTasks(); status('✓ Sincronizado'); } catch(e){ status('⏳ Pendiente sincronización'); }
      renderTasks();
      if (navigator.vibrate) navigator.vibrate(50);
    });

    const info = document.createElement('div');
    info.className = 'task-info';
    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = t.title;
    if (t.completed) title.style.textDecoration = 'line-through';
    const desc = document.createElement('div');
    desc.className = 'task-desc';
    desc.textContent = t.description || '';
    info.appendChild(title);
    if (t.description) info.appendChild(desc);

    left.appendChild(cb);
    left.appendChild(info);

    // Right: badge + photo + delete
    const right = document.createElement('div');
    right.className = 'task-right';

    const badge = document.createElement('span');
    badge.className = 'task-badge';
    if (t.clientId.startsWith('l:')) {
      badge.className += ' badge-offline';
      badge.textContent = 'offline';
    } else if (t.dirty) {
      badge.className += ' badge-pending';
      badge.textContent = 'pendiente';
    } else {
      badge.className += ' badge-ok';
      badge.textContent = 'ok';
    }
    right.appendChild(badge);

    if (t.photo) {
      const img = document.createElement('img');
      img.src = t.photo;
      img.className = 'task-photo';
      right.appendChild(img);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-delete';
    delBtn.textContent = '🗑️';
    delBtn.title = 'Borrar tarea';
    delBtn.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta tarea?')) return;
      await deleteTaskLocal(t.clientId);
      status('🗑️ Tarea eliminada');
      try { await syncPendingTasks(); status('✓ Sincronizado'); } catch(e){ status('⏳ Pendiente sincronización'); }
      renderTasks();
    });

    right.appendChild(delBtn);
    div.appendChild(left);
    div.appendChild(right);
    tasksList.appendChild(div);
  });
}

// --- Helpers ---
function status(txt){ statusEl.textContent = txt; }
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

// --- Create task ---
createTaskBtn.addEventListener('click', async () => {
  const title = titleInput.value && titleInput.value.trim();
  const desc = descInput.value && descInput.value.trim();
  if (!title) return alert('Escribe un título para la tarea.');
  const task = {
    title, description: desc || '', completed:false,
    location: currentLocation||null, photo: latestPhotoDataUrl||null, createdAt: Date.now()
  };
  await saveTaskLocal(task);
  titleInput.value=''; descInput.value=''; latestPhotoDataUrl=null;
  createResult.textContent = 'Tarea creada localmente.';
  renderTasks();
  if (navigator.onLine) {
    status('Sincronizando nueva tarea...');
    try { await syncPendingTasks(); status('Sincronizado.'); } catch(e){ status('Sync falló, pendiente.'); }
    renderTasks();
  } else status('Offline: tarea pendiente de sincronización.');
});

// --- Location ---
getLocationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation no soportada.');
  navigator.geolocation.getCurrentPosition(pos => {
    currentLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    createResult.textContent = 'Ubicación añadida: ' + currentLocation.lat.toFixed(4) + ', ' + currentLocation.lon.toFixed(4);
  }, err => { createResult.textContent = 'Error geolocalización: ' + err.message; }, { timeout:10000 });
});

// --- Camera ---
openCameraBtn.addEventListener('click', async () => {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' } });
    cameraPreview.srcObject = mediaStream;
    cameraPreview.style.display='block'; photoCanvas.style.display='none';
    openCameraBtn.textContent='Capturar foto';
    const handler = async () => {
      const video = cameraPreview;
      photoCanvas.width = video.videoWidth || 640;
      photoCanvas.height = video.videoHeight || 480;
      const ctx = photoCanvas.getContext('2d');
      ctx.drawImage(video,0,0,photoCanvas.width,photoCanvas.height);
      latestPhotoDataUrl = photoCanvas.toDataURL('image/jpeg',0.8);
      photoCanvas.style.display='block'; cameraPreview.style.display='none';
      mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null;
      openCameraBtn.textContent='Tomar foto'; openCameraBtn.removeEventListener('click',handler);
      createResult.textContent='Foto capturada y añadida a la tarea.';
    };
    openCameraBtn.removeEventListener('click',null);
    openCameraBtn.addEventListener('click',handler);
  } catch(err){ alert('No se pudo abrir la cámara: ' + err.message); }
});

// --- Sync ---
async function syncPendingTasks() {
  if (!navigator.onLine) throw new Error('offline');
  const all = await getAllTasksLocal();

  // Crear tareas locales
  for (const t of all) {
    if (t.deleted) continue;
    if (t.clientId.startsWith('l:')) {
      try {
        const res = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(t) });
        const json = await res.json();
        if (json && json.ok && json.task) await replaceLocalWithServer(t.clientId,json.task);
      } catch(e){ console.warn('Error creando tarea',e); throw e; }
    }
  }

  const afterCreate = await getAllTasksLocal();

  // Actualizar o borrar server-backed
  for (const t of afterCreate) {
    if (t.clientId.startsWith('s:')) {
      const serverId = Number(t.clientId.split(':')[1]);
      if (t.deleted) {
        try { await fetch('/api/tasks/'+serverId,{method:'DELETE'});
              const db = await openDB(); const tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).delete(t.clientId);
        } catch(e){ console.warn('Error borrando server',e); throw e; }
      } else if (t.dirty) {
        try { await fetch('/api/tasks/'+serverId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)});
              t.dirty=false; await putTaskLocalNoDirty(t);
        } catch(e){ console.warn('Error actualizando server',e); throw e; }
      }
    }
  }

  // Pull server tasks
  try {
    const res = await fetch('/api/tasks');
    const json = await res.json();
    if (json && json.ok) {
      for (const st of json.tasks) {
        const clientId = 's:' + st.id;
        await putTaskLocalNoDirty(Object.assign({},st,{clientId}));
      }
    }
  } catch(e){ console.warn('Error obteniendo tasks',e); }

  renderTasks();
}

// --- Auto-setup de Push Notifications ---
async function setupPushNotifications() {
  try {
    // Verificar soporte
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('Push notifications no soportadas en este navegador');
      return;
    }

    // Esperar a que el SW esté listo
    const reg = await navigator.serviceWorker.ready;

    // Verificar si ya está suscrito
    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      console.log('Ya estás suscrito a push notifications');
      return;
    }

    // Pedir permiso si no lo tenemos
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('Permiso de notificaciones denegado');
        return;
      }
    }

    // Si el permiso fue denegado previamente, no hacer nada
    if (Notification.permission !== 'granted') {
      console.log('Notificaciones no permitidas');
      return;
    }

    // Obtener la clave pública VAPID
    const res = await fetch('/api/vapid-public');
    const { publicKey } = await res.json();

    // Suscribirse a push
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    // Guardar suscripción en el servidor
    await fetch('/api/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    console.log('Push notifications configuradas automáticamente ✓');
  } catch (err) {
    console.warn('Error al configurar push notifications:', err.message);
  }
}

// --- Load / online/offline ---
window.addEventListener('load', async () => {
  renderTasks();
  if(navigator.onLine){
    status('Online: sincronizando...');
    try{
      await syncPendingTasks();
      status('Sincronizado.');
    }catch(e){
      status('Sync incompleta.');
    }
    renderTasks();
  }else status('Offline: trabajando local.');

  // Configurar push automáticamente
  await setupPushNotifications();
});
window.addEventListener('online', async()=>{status('Online: sincronizando...');try{await syncPendingTasks();status('Sincronizado.');}catch(e){status('Sync incompleta.');} renderTasks();});
window.addEventListener('offline',()=>{status('Offline: cambios guardados localmente.');});
syncBtn.addEventListener('click',async()=>{if(!navigator.onLine)return alert('Offline.');status('Sincronizando manualmente...');try{await syncPendingTasks();status('Sincronizado.');}catch(e){status('Sync falló.');}});

// --- Notifications locales ---
document.getElementById('notifBtn').addEventListener('click',async()=>{
  if(!('Notification'in window)) return alert('Notifications API no soportada.');
  if(Notification.permission==='default') await Notification.requestPermission();
  if(Notification.permission==='granted'){
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Task Manager',{body:'Notificaciones listas.'});
  } else alert('Permiso denegado para notificaciones.');
});

// --- Push automático ---
const subscribePushBtn = document.getElementById('subscribePush');
subscribePushBtn.addEventListener('click',async()=>{
  if(!('serviceWorker'in navigator)) return alert('Service worker requerido para Push.');
  if(!('PushManager'in window)) return alert('Push no soportado.');

  const reg = await navigator.serviceWorker.ready;
  try{
    const res = await fetch('/api/vapid-public');
    const {publicKey} = await res.json();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch('/api/save-subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
    alert('Suscripción guardada. ¡Listo para recibir notificaciones!');
  }catch(err){ alert('No se pudo suscribir: '+err.message); }
});

// --- Trigger server push demo ---
document.getElementById('triggerServerPush').addEventListener('click',async()=>{
  const title=prompt('Título','Recordatorio');
  const body=prompt('Cuerpo','Tienes tareas pendientes.');
  const res=await fetch('/api/send-notification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body})});
  const json=await res.json();
  document.getElementById('pushResult').textContent=JSON.stringify(json,null,2);
});

// --- Helper base64 -> Uint8Array ---
function urlBase64ToUint8Array(base64String){
  if(!base64String) return undefined;
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData=window.atob(base64);
  const outputArray=new Uint8Array(rawData.length);
  for(let i=0;i<rawData.length;i++) outputArray[i]=rawData.charCodeAt(i);
  return outputArray;
}
