/* v13 speech recording fallback. Saved Blob cannot be fed to Web Speech. */
(function (root) {
  'use strict';
  var objectUrls = [];
  function storage() { return root.Eng30Storage; }
  function filter(meta) { return { day: meta.day == null ? null : meta.day, module: meta.module, itemId: String(meta.itemId) }; }
  async function saveAttempt(meta, blob, succeeded, lastError) {
    var api = storage();
    if (!api || !blob || !blob.size) return null;
    var now = Date.now();
    var row = await api.putRecording({ blob: blob, mimeType: blob.type, day: meta.day, module: meta.module, itemId: meta.itemId, prompt: meta.prompt, createdAt: now, attempts: Number(meta.attempts || 1), lastError: succeeded ? '' : String(lastError || 'recognition-failed'), retryable: !succeeded && !!navigator.onLine });
    if (succeeded) await api.clearPendingSpeechForItem(filter(meta));
    else await api.enqueuePendingSpeech({ blob: blob, id: row.id, recordingId: row.id, day: row.day, module: row.module, itemId: row.itemId, prompt: row.prompt, createdAt: row.createdAt, attempts: row.attempts, lastError: row.lastError, retryable: !!navigator.onLine });
    try { root.dispatchEvent(new CustomEvent('eng30-pending-speech-change')); } catch (_) {}
    return row;
  }
  async function scan() {
    var api = storage();
    if (!api || !api.listPendingSpeech) return [];
    await api.markPendingSpeechRetryable(!!navigator.onLine);
    var rows = await api.listPendingSpeech();
    try { root.dispatchEvent(new CustomEvent('eng30-pending-speech-scan', { detail: { rows: rows, online: !!navigator.onLine } })); } catch (_) {}
    return rows;
  }
  async function list(meta) { var api=storage(); return api ? api.listPendingSpeech(filter(meta)) : []; }
  async function playLatest(meta, audio) {
    var api=storage(); if (!api || !audio) return false;
    var rows=await api.listRecordings(filter(meta)); if (!rows.length) return false;
    var url=URL.createObjectURL(rows[0].blob); objectUrls.push(url); audio.src=url; audio.classList.remove('hidden'); await audio.play(); return true;
  }
  function onResume() { scan().catch(function () {}); }
  root.addEventListener('online', onResume);
  root.addEventListener('pageshow', onResume);
  root.addEventListener('beforeunload', function () { objectUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} }); });
  root.Eng30SpeechFallback = { saveAttempt: saveAttempt, scan: scan, list: list, playLatest: playLatest };
})(window);
