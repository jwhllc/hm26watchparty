/*
  LocalStore: saves everything in this browser's localStorage.

  It mimics the small slice of a document-database API that app.js uses
  (collection().onSnapshot / add / doc, and doc().get / set / update / delete),
  so the same app code can also run against a shared backend later.

  Data shape (also the backup file format):
  { tasks: {id: {...}}, guests: {...}, picks: {...}, expenses: {...}, settings: {budget: {...}} }
*/
const LocalStore = (() => {
  const KEY = 'hm26-watch-party:data:v1';
  const COLLECTIONS = ['tasks', 'guests', 'picks', 'expenses', 'settings'];
  const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  const listeners = new Set();
  let data = null;
  let persistent = true;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const blank = () => Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
  const newId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function fromSeed() {
    const d = blank();
    for (const c of ['tasks', 'guests', 'expenses']) {
      (SEED[c] || []).forEach(({ id, ...doc }) => { d[c][id] = clone(doc); });
    }
    d.settings.budget = clone(SEED.settings || {});
    return d;
  }

  // Accepts anything; keeps only well-formed collections and documents.
  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('That file is not a watch party backup.');
    const d = blank();
    let count = 0;
    for (const c of COLLECTIONS) {
      const src = obj[c];
      if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
      for (const [id, doc] of Object.entries(src)) {
        if (ID_RE.test(id) && doc && typeof doc === 'object' && !Array.isArray(doc)) { d[c][id] = doc; count++; }
      }
    }
    if (!count) throw new Error('That file has no to-dos, guests or budget data in it.');
    return d;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); persistent = true; }
    catch (e) { persistent = false; }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { data = normalize(JSON.parse(raw)); return; }
    } catch (e) { /* unreadable or blocked: fall back to the starting data */ }
    data = fromSeed();
    save();
  }

  const emit = () => setTimeout(() => listeners.forEach((fn) => fn()), 0);

  function snapDoc(c, id) {
    const exists = !!(data[c] && data[c][id]);
    return {
      id, exists,
      data: () => (exists ? clone(data[c][id]) : undefined),
      metadata: { fromCache: false, hasPendingWrites: false },
    };
  }

  function listen(fn) { listeners.add(fn); setTimeout(fn, 0); return () => listeners.delete(fn); }

  function doc(path) {
    const i = path.lastIndexOf('/');
    const c = path.slice(0, i), id = path.slice(i + 1);
    const bucket = () => (data[c] = data[c] || {});
    return {
      id, path,
      get: async () => snapDoc(c, id),
      set: async (body) => { bucket()[id] = clone(body); save(); emit(); },
      update: async (body) => {
        if (!bucket()[id]) throw { code: 'invalid_argument', message: 'That item no longer exists.' };
        Object.assign(bucket()[id], clone(body)); save(); emit();
      },
      delete: async () => { delete bucket()[id]; save(); emit(); },
      onSnapshot: (next) => listen(() => next(snapDoc(c, id))),
    };
  }

  function collection(c) {
    return {
      path: c,
      doc: (id) => doc(c + '/' + (id || newId())),
      add: async (body) => { const ref = doc(c + '/' + newId()); await ref.set(body); return ref; },
      onSnapshot: (next) => listen(() => {
        const docs = Object.keys(data[c] || {}).sort().map((id) => snapDoc(c, id));
        next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
      }),
    };
  }

  // Keep several open tabs in step.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    try { data = e.newValue ? normalize(JSON.parse(e.newValue)) : fromSeed(); } catch (_) { return; }
    emit();
  });

  return {
    open() { if (!data) load(); return Object.freeze({ doc, collection }); },
    get persistent() { return persistent; },
    dump() { return Object.assign({ app: 'hm26-watch-party', version: 1, exportedAt: new Date().toISOString() }, clone(data)); },
    replace(obj) { data = normalize(obj); save(); emit(); },
    reset() { data = fromSeed(); save(); emit(); },
  };
})();
