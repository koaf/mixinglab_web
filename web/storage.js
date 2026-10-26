const DATABASE = 'meloa-web';
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('session');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readAutosave() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('session', 'readonly');
      const request = transaction.objectStore('session').get('current');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function writeAutosave(session) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('session', 'readwrite');
      transaction.objectStore('session').put(session, 'current');
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || Error('自動保存を中断しました。'));
    });
  } finally { db.close(); }
}
