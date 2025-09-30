/**
 * Genera claves VAPID usando web-push y las imprime en consola.
 * Ejecuta: npm run generate-vapid
 */
const webpush = require('web-push');

const vapidKeys = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC=' + vapidKeys.publicKey);
console.log('VAPID_PRIVATE=' + vapidKeys.privateKey);
console.log('');
console.log('Guarda estas claves en variables de entorno antes de usar push en server.js.');
