/* Eng30Storage v13: IndexedDB primary, localStorage recovery mirror/fallback. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.Eng30Storage = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  var PREFIX = 'eng30_';
  var DB_NAME = 'eng30-v13';
  var STORE = 'kv';
  var RECORDINGS_STORE = 'recordings';
  var PENDING_SPEECH_STORE = 'pendingSpeech';
  var DB_VERSION = 2;
  var SCHEMA_VERSION = 13;
  var cache = Object.create(null);
  var db = null;
  var backend = 'initializing';
  var chain = Promise.resolve();

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }

  function hashString(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  function validKey(key) { return typeof key === 'string' && key.indexOf(PREFIX) === 0; }
  function cloneMap(obj) {
    var out = {};
    Object.keys(obj || {}).sort().forEach(function (key) { if (validKey(key)) out[key] = String(obj[key]); });
    return out;
  }
  function makePackage(data, now) {
    data = cloneMap(data);
    var keys = Object.keys(data).sort();
    var bytes = keys.reduce(function (sum, key) { return sum + key.length + data[key].length; }, 0);
    return {
      formatVersion: 1,
      appVersion: 'v13',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date(now || Date.now()).toISOString(),
      data: data,
      statistics: { recordCount: keys.length, byteCount: bytes, keys: keys },
      checksum: { algorithm: 'fnv1a32', value: hashString(stableStringify(data)) }
    };
  }
  function validatePackage(pkg) {
    if (!pkg || typeof pkg !== 'object') throw new Error('备份文件不是有效对象');
    if (pkg.formatVersion !== 1 || pkg.schemaVersion > SCHEMA_VERSION) throw new Error('备份版本不受支持');
    if (!pkg.data || typeof pkg.data !== 'object' || Array.isArray(pkg.data)) throw new Error('备份缺少 data');
    Object.keys(pkg.data).forEach(function (key) {
      if (!validKey(key) || typeof pkg.data[key] !== 'string') throw new Error('备份包含无效数据键或值');
    });
    var expected = hashString(stableStringify(cloneMap(pkg.data)));
    if (!pkg.checksum || pkg.checksum.algorithm !== 'fnv1a32' || pkg.checksum.value !== expected) {
      throw new Error('备份校验摘要不匹配，文件可能损坏');
    }
    return true;
  }

  function notify(error, operation) {
    var detail = { error: error, operation: operation, backend: backend };
    try { root.dispatchEvent(new CustomEvent('eng30-storage-error', { detail: detail })); } catch (_) {}
    try {
      var box = root.document && root.document.getElementById('storage-error-banner');
      if (!box && root.document && root.document.body) {
        box = root.document.createElement('div');
        box.id = 'storage-error-banner';
        box.setAttribute('role', 'alert');
        box.style.cssText = 'position:fixed;z-index:100000;left:12px;right:12px;bottom:12px;padding:12px;border-radius:10px;background:#8b1e1e;color:white;font-size:14px';
        root.document.body.appendChild(box);
      }
      if (box) box.textContent = '本地数据存储异常，已尝试安全回退：' + (error.message || error);
    } catch (_) {}
    if (root.console) root.console.error('[Eng30Storage:' + operation + ']', error);
  }

  function mirrorSet(key, value) { try { root.localStorage.setItem(key, value); } catch (e) { notify(e, 'mirror-set'); } }
  function mirrorRemove(key) { try { root.localStorage.removeItem(key); } catch (e) { notify(e, 'mirror-remove'); } }
  function localRecords() {
    var out = {};
    try {
      if (!root.localStorage) return out;
      for (var i = 0; i < root.localStorage.length; i++) {
        var key = root.localStorage.key(i);
        if (validKey(key)) out[key] = root.localStorage.getItem(key);
      }
    } catch (e) { notify(e, 'local-load'); }
    return out;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('IndexedDB 不可用'));
      var req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'key' });
        if (!d.objectStoreNames.contains(RECORDINGS_STORE)) {
          var recordings = d.createObjectStore(RECORDINGS_STORE, { keyPath: 'id' });
          recordings.createIndex('byItem', ['module', 'day', 'itemId'], { unique: false });
          recordings.createIndex('byCreatedAt', 'createdAt', { unique: false });
        }
        if (!d.objectStoreNames.contains(PENDING_SPEECH_STORE)) {
          var pending = d.createObjectStore(PENDING_SPEECH_STORE, { keyPath: 'id' });
          pending.createIndex('byItem', ['module', 'day', 'itemId'], { unique: false });
          pending.createIndex('byCreatedAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
      req.onblocked = function () { reject(new Error('IndexedDB 升级被其他页面阻塞')); };
    });
  }
  function readAll() {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function transactionWrite(actions) {
    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { reject(e); return; }
      var store = tx.objectStore(STORE);
      try { actions(store, tx); } catch (e) { try { tx.abort(); } catch (_) {} reject(e); return; }
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB 事务失败')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB 事务已回滚')); };
    });
  }
  function enqueue(work, fallback) {
    chain = chain.then(work).catch(function (error) {
      backend = 'localStorage';
      notify(error, 'indexeddb-write');
      if (fallback) fallback();
    });
    return chain;
  }

  var ready = (async function () {
    var local = localRecords();
    try {
      db = await openDb();
      var records = await readAll();
      var byKey = Object.create(null);
      records.forEach(function (record) { if (validKey(record.key)) byKey[record.key] = record; });
      var migrate = [];
      Object.keys(local).forEach(function (key) {
        if (!byKey[key]) migrate.push({ key: key, value: local[key], updatedAt: 0, migratedAt: Date.now() });
      });
      if (migrate.length) await transactionWrite(function (store) { migrate.forEach(function (r) { store.put(r); }); });
      records = migrate.length ? await readAll() : records;
      records.forEach(function (record) {
        if (!validKey(record.key)) return;
        cache[record.key] = String(record.value);
        mirrorSet(record.key, cache[record.key]);
      });
      backend = 'indexedDB';
    } catch (error) {
      Object.keys(local).forEach(function (key) { cache[key] = local[key]; });
      backend = 'localStorage';
      notify(error, 'startup-fallback');
    }
    try { root.dispatchEvent(new CustomEvent('eng30-storage-ready', { detail: { backend: backend } })); } catch (_) {}
    return api;
  })();

  function get(key) { return validKey(key) && Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null; }
  function set(key, value) {
    if (!validKey(key)) return Promise.reject(new Error('只允许 eng30_* 键'));
    value = String(value);
    cache[key] = value;
    if (backend !== 'indexedDB') { mirrorSet(key, value); return Promise.resolve(); }
    return enqueue(function () {
      return transactionWrite(function (store) { store.put({ key: key, value: value, updatedAt: Date.now() }); })
        .then(function () { mirrorSet(key, value); });
    }, function () { mirrorSet(key, value); });
  }
  function remove(key) {
    if (!validKey(key)) return Promise.reject(new Error('只允许 eng30_* 键'));
    delete cache[key];
    if (backend !== 'indexedDB') { mirrorRemove(key); return Promise.resolve(); }
    return enqueue(function () {
      return transactionWrite(function (store) { store.delete(key); }).then(function () { mirrorRemove(key); });
    }, function () { mirrorRemove(key); });
  }
  function keys() { return Object.keys(cache).filter(validKey).sort(); }
  function exportData() { return makePackage(cache); }
  async function exportJSON() { await chain; return JSON.stringify(makePackage(cache), null, 2); }
  async function importData(pkg) {
    validatePackage(pkg);
    await chain;
    var next = cloneMap(pkg.data);
    var snapshot = makePackage(cache);
    var snapshotKey = 'eng30_backup_before_import_v13';
    next[snapshotKey] = JSON.stringify(snapshot);
    if (backend === 'indexedDB') {
      await transactionWrite(function (store) {
        store.clear();
        var now = Date.now();
        Object.keys(next).forEach(function (key) { store.put({ key: key, value: next[key], updatedAt: now }); });
      });
    }
    keys().forEach(mirrorRemove);
    cache = Object.create(null);
    Object.keys(next).forEach(function (key) { cache[key] = next[key]; mirrorSet(key, next[key]); });
    return { imported: Object.keys(pkg.data).length, snapshotKey: snapshotKey };
  }
  async function importJSON(text) { var pkg; try { pkg = JSON.parse(text); } catch (_) { throw new Error('不是有效 JSON 文件'); } return importData(pkg); }


  function speechRecord(input, requireBlob) {
    input = input || {};
    var id = String(input.id || ('speech-' + Date.now() + '-' + Math.random().toString(36).slice(2)));
    if (requireBlob && typeof Blob !== 'undefined' && !(input.blob instanceof Blob)) throw new Error('Recording data must be a Blob');
    return {
      id: id, recordingId: String(input.recordingId || id), blob: input.blob || null,
      mimeType: String(input.mimeType || (input.blob && input.blob.type) || 'audio/webm'),
      day: input.day == null ? null : input.day, module: String(input.module || 'speech'),
      itemId: String(input.itemId || ''), prompt: String(input.prompt || ''),
      createdAt: Number(input.createdAt || Date.now()), attempts: Number(input.attempts || 0),
      lastError: String(input.lastError || ''), retryable: !!input.retryable
    };
  }
  function storeRequest(storeName, mode, action) {
    return ready.then(function () {
      if (!db || backend !== 'indexedDB') throw new Error('Recording Blob requires IndexedDB');
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, mode);
        var store = tx.objectStore(storeName);
        var req;
        try { req = action(store); } catch (error) { reject(error); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('IndexedDB request failed')); };
      });
    });
  }
  function putRecording(input) { var row = speechRecord(input, true); return storeRequest(RECORDINGS_STORE, 'readwrite', function (s) { return s.put(row); }).then(function () { return row; }); }
  function getRecording(id) { return storeRequest(RECORDINGS_STORE, 'readonly', function (s) { return s.get(String(id)); }); }
  function listSpeechStore(storeName) { return storeRequest(storeName, 'readonly', function (s) { return s.getAll(); }).then(function (rows) { return (rows || []).sort(function (a,b) { return b.createdAt-a.createdAt; }); }); }
  function filterSpeech(rows, filter) { filter=filter||{}; return rows.filter(function (r) { return (filter.day==null || r.day===filter.day) && (!filter.module || r.module===filter.module) && (!filter.itemId || r.itemId===filter.itemId); }); }
  function listRecordings(filter) { return listSpeechStore(RECORDINGS_STORE).then(function (rows) { return filterSpeech(rows, filter); }); }
  function deleteRecording(id) { return storeRequest(RECORDINGS_STORE, 'readwrite', function (s) { return s.delete(String(id)); }); }
  function enqueuePendingSpeech(input) { var row=speechRecord(input, false); return storeRequest(PENDING_SPEECH_STORE, 'readwrite', function (s) { return s.put(row); }).then(function () { try { root.dispatchEvent(new CustomEvent('eng30-pending-speech-change')); } catch (_) {} return row; }); }
  function listPendingSpeech(filter) { return listSpeechStore(PENDING_SPEECH_STORE).then(function (rows) { return filterSpeech(rows, filter); }); }
  function removePendingSpeech(id) { return storeRequest(PENDING_SPEECH_STORE, 'readwrite', function (s) { return s.delete(String(id)); }).then(function () { try { root.dispatchEvent(new CustomEvent('eng30-pending-speech-change')); } catch (_) {} }); }
  function clearPendingSpeechForItem(filter) { return listPendingSpeech(filter).then(function (rows) { return Promise.all(rows.map(function (r) { return removePendingSpeech(r.id); })); }); }
  function markPendingSpeechRetryable(online) { return listPendingSpeech().then(function (rows) { return Promise.all(rows.map(function (r) { r.retryable=!!online; return enqueuePendingSpeech(r); })); }); }

  var api = {
    ready: ready,
    get: get, set: set, remove: remove, keys: keys,
    getItem: get, setItem: set, removeItem: remove,
    export: exportData, exportJSON: exportJSON,
    import: importData, importJSON: importJSON,
    flush: function () { return chain; },
    backend: function () { return backend; },
    putRecording: putRecording, getRecording: getRecording, listRecordings: listRecordings, deleteRecording: deleteRecording,
    enqueuePendingSpeech: enqueuePendingSpeech, listPendingSpeech: listPendingSpeech, removePendingSpeech: removePendingSpeech,
    clearPendingSpeechForItem: clearPendingSpeechForItem, markPendingSpeechRetryable: markPendingSpeechRetryable,
    _pure: { stableStringify: stableStringify, hashString: hashString, makePackage: makePackage, validatePackage: validatePackage }
  };
  return api;
});
