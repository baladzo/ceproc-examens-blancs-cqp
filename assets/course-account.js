import {connectCloud, getAccess, isCloudConfigured, isPermissionDenied} from './cloud.js';

const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const versionPattern = /^[a-f0-9]{12}$/;
const allowedRoles = new Set(['student','trainer','admin']);
const clone = value => JSON.parse(JSON.stringify(value));

export function progressFingerprint(record) {
  return record === null ? 'absent' : JSON.stringify({
    chapterId:record.chapterId, exerciseVersion:record.exerciseVersion,
    answers:record.answers, submitted:record.submitted === true,
  });
}

export function hasCourseWork(record) {
  return !!record && (record.clientUpdatedAt > 0 || record.submitted === true
    || Object.keys(record.answers || {}).length > 0);
}

export function readCourseRecord(chapter,value,uid,cleanAnswers) {
  const keys = ['uid','chapterId','exerciseVersion','answers','submitted','clientUpdatedAt','updatedAt'];
  if (!object(value) || value.uid !== uid || value.chapterId !== chapter.id
    || typeof value.exerciseVersion !== 'string' || !versionPattern.test(value.exerciseVersion)
    || typeof value.submitted !== 'boolean' || !object(value.answers)
    || !Number.isSafeInteger(value.clientUpdatedAt) || value.clientUpdatedAt <= 0
    || Object.keys(value).some(key => !keys.includes(key)) || !own(value,'updatedAt')) {
    return {kind:'invalid'};
  }
  if (value.exerciseVersion !== chapter.exerciseVersion) return {kind:'incompatible'};
  if (Object.keys(value.answers).length > 10 || Object.keys(value.answers).some(key => !/^(?:[1-9]|10)$/.test(key))) {
    return {kind:'invalid'};
  }
  const validValue = answer => {
    if (typeof answer === 'string') return /^[a-e]$/.test(answer);
    if (Array.isArray(answer)) return answer.length <= 5 && new Set(answer).size === answer.length
      && answer.every(choice => typeof choice === 'string' && /^[a-e]$/.test(choice));
    return object(answer) && Object.keys(answer).length <= 3 && Object.entries(answer).every(([key,item]) =>
      /^[a-z][a-z0-9_]{0,49}$/.test(key) && typeof item === 'string' && item.length <= 50);
  };
  if (Object.values(value.answers).some(answer => !validValue(answer))) return {kind:'invalid'};
  return {kind:'valid',record:{uid,chapterId:chapter.id,exerciseVersion:chapter.exerciseVersion,
    answers:clone(cleanAnswers(chapter,value.answers)),submitted:value.submitted,
    clientUpdatedAt:value.clientUpdatedAt}};
}

function failure(code,record) {
  const error = new Error(code);
  error.code = code;
  if (record !== undefined) error.record = record;
  return error;
}

export function createCourseAccount(options={}) {
  const host = options.host || globalThis.window;
  const doc = options.document || host?.document;
  const engine = options.engine || host?.CeprocCourseExercises;
  const connect = options.connect || connectCloud;
  const checkAccess = options.getAccess || getAccess;
  const configured = options.configured || isCloudConfigured;
  const permissionDenied = options.permissionDenied || isPermissionDenied;
  const timers = options.timers || {setTimeout,clearTimeout};
  const delay = options.delay ?? 800;
  if (!host || !engine) return null;

  let cloud = null, uid = null, identity = null, epoch = 0, phase = 'anonymous';
  let message = '', disposed = false, started = false;
  const states = new Map();
  const removers = [];

  function dispatch(name,detail) {
    if (typeof host.dispatchEvent !== 'function') return;
    const EventClass = options.CustomEvent || host.CustomEvent || globalThis.CustomEvent;
    if (typeof EventClass === 'function') host.dispatchEvent(new EventClass(name,{detail}));
  }

  function listen(name,handler) {
    if (typeof host.addEventListener !== 'function') return;
    host.addEventListener(name,handler);
    removers.push(() => host.removeEventListener?.(name,handler));
  }

  function active(ticket=epoch,expectedUid=uid) {
    return !disposed && !!expectedUid && uid === expectedUid && epoch === ticket
      && identity?.user?.uid === expectedUid && identity.user.emailVerified === true
      && identity?.access?.active === true && allowedRoles.has(identity.access.role)
      && engine.getUid() === expectedUid;
  }

  function authorized(ticket=epoch,expectedUid=uid) {
    return active(ticket,expectedUid) && cloud?.auth?.currentUser?.uid === expectedUid
      && cloud.auth.currentUser.emailVerified === true;
  }

  function current(state,ticket=epoch,expectedUid=uid) {
    return authorized(ticket,expectedUid) && states.get(state.chapter.id) === state;
  }

  function clearStates() {
    for (const state of states.values()) {
      timers.clearTimeout(state.timer);
      state.unsubscribe?.();
    }
    states.clear();
  }

  function deactivate(nextPhase='anonymous',text='') {
    epoch++;
    clearStates();
    uid = null;
    identity = null;
    phase = nextPhase;
    message = text;
    engine.switchUser(null);
    render();
  }

  function deny(state,ticket,expectedUid) {
    if (!current(state,ticket,expectedUid)) return;
    deactivate('denied','Votre autorisation ne permet plus de synchroniser les cours. Les vues privées ont été fermées.');
    dispatch('ceproc:access-denied',{uid:expectedUid,source:'courses'});
  }

  function node(tag,text,attributes={}) {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    Object.entries(attributes).forEach(([key,value]) => element.setAttribute(key,value));
    return element;
  }

  function button(text,callback,parent,disabled=false) {
    const element = node('button',text,{type:'button'});
    element.disabled = disabled;
    element.addEventListener('click',() => { void callback(); });
    parent.append(element);
    return element;
  }

  function recordSummary(chapter,record) {
    if (!record) return 'Aucune sauvegarde en ligne.';
    const answered = engine.countAnswered(chapter,record.answers);
    let text = `${answered} / ${chapter.exercises.length} questions renseignées`;
    if (record.submitted) text += ` ; résultat ${engine.grade(chapter,record.answers).score} / ${chapter.exercises.length}`;
    const date = new Date(record.clientUpdatedAt);
    if (record.clientUpdatedAt > 0 && Number.isFinite(date.getTime())) text += ` ; ${date.toLocaleString('fr-FR')}`;
    return text;
  }

  function answerText(question,answers) {
    const answer = answers?.[question.id];
    if (question.type === 'numbers') return question.fields.map(field => `${field.label} : ${object(answer) && own(answer,field.id) && String(answer[field.id]).trim() ? String(answer[field.id]) : 'non renseigné'}`).join(' ; ');
    const selected = question.type === 'single' ? [answer] : Array.isArray(answer) ? answer : [];
    return question.options.filter(option => selected.includes(option.id)).map(option => option.text).join(' ; ') || 'Aucune réponse';
  }

  function render() {
    const panel = doc?.getElementById('courseSyncPanel');
    if (!panel) return;
    panel.hidden = !uid || !configured();
    panel.replaceChildren();
    panel.append(node('h2','Sauvegarde de mes exercices de cours'));
    if (!uid) {
      panel.append(node('p',message || 'Les exercices restent enregistrés sur cet appareil, sans rattachement automatique à un compte.',{role:'status'}));
      return;
    }
    const pending = [...states.values()].filter(state => state.pending);
    const blocked = [...states.values()].filter(state => state.blocked);
    const waiting = [...states.values()].some(state => !state.serverReady);
    const dirty = [...states.values()].some(state => state.dirty || state.writing);
    let status = message;
    if (!status) status = phase === 'connecting' ? 'Ouverture de la sauvegarde de ce compte…'
      : pending.length ? 'Des copies différentes existent. Choisissez la version à reprendre pour les chapitres indiqués.'
      : waiting ? 'Connexion en attente. Les réponses de ce compte restent conservées sur cet appareil.'
      : dirty ? 'Sauvegarde des réponses en cours…'
      : 'Les réponses de ce compte sont synchronisées. Elles pourront être reprises sur un autre appareil.';
    panel.append(node('p',status,{role:'status','aria-live':'polite'}));
    if (waiting || blocked.length || phase === 'connection-error') button('Réessayer la synchronisation',retry,panel);
    for (const state of blocked) {
      panel.append(node('p',`Chapitre ${String(state.chapter.id).padStart(2,'0')} : ${state.blocked === 'incompatible' ? 'la sauvegarde en ligne appartient à une autre version des exercices. Elle est conservée et n’a pas été remplacée.' : 'la sauvegarde en ligne ne peut pas être reprise. Les réponses locales sont conservées.'}`));
    }
    for (const state of pending) {
      const conflict = state.pending;
      const card = node('section',undefined,{'class':'course-sync-conflict'});
      card.append(node('h3',`Chapitre ${String(state.chapter.id).padStart(2,'0')} — ${state.chapter.title}`),
        node('p','Cet appareil : '+recordSummary(state.chapter,conflict.local)),
        node('p','En ligne : '+recordSummary(state.chapter,conflict.remote)));
      const comparison = node('details');
      comparison.append(node('summary','Comparer les réponses des deux copies'));
      for (const question of state.chapter.exercises) {
        const local = answerText(question,conflict.local.answers);
        const remote = answerText(question,conflict.remote?.answers);
        if (local === remote) continue;
        comparison.append(node('h4',question.title),node('p','Cet appareil : '+local),node('p','En ligne : '+remote));
      }
      card.append(comparison);
      button('Reprendre la copie en ligne',() => resolveConflict(state.chapter.id,'remote',conflict),card,state.writing || !conflict.remote);
      button('Conserver la copie de cet appareil',() => resolveConflict(state.chapter.id,'local',conflict),card,state.writing);
      panel.append(card);
    }
  }

  function conflict(state,remote) {
    state.pending = {remote:remote && clone(remote),local:engine.snapshotChapter(state.chapter.id)};
    state.remote = remote;
    state.serverReady = true;
    state.dirty = false;
    timers.clearTimeout(state.timer);
    render();
  }

  function accept(state,remote) {
    state.remote = remote;
    state.base = progressFingerprint(remote);
    state.pending = null;
    state.blocked = null;
    state.error = false;
    state.serverReady = true;
    state.dirty = hasCourseWork(engine.snapshotChapter(state.chapter.id))
      && progressFingerprint(engine.snapshotChapter(state.chapter.id)) !== state.base;
    if (state.dirty) schedule(state);
  }

  function restore(state,remote) {
    const local = engine.snapshotChapter(state.chapter.id);
    const result = engine.restoreChapter(remote,{expectedUid:uid,expectedClientUpdatedAt:local.clientUpdatedAt});
    if (result.ok) accept(state,remote);
    else conflict(state,remote);
  }

  function processRemote(state,snapshot,ticket,expectedUid) {
    if (!current(state,ticket,expectedUid)) return;
    if (snapshot.metadata?.fromCache === true) {
      state.serverReady = false;
      render();
      return;
    }
    if (snapshot.metadata?.hasPendingWrites === true) return;
    let remote = null;
    if (snapshot.exists()) {
      const read = readCourseRecord(state.chapter,snapshot.data(),expectedUid,engine.cleanAnswers);
      if (read.kind !== 'valid') {
        state.blocked = read.kind;
        state.serverReady = false;
        state.pending = null;
        timers.clearTimeout(state.timer);
        render();
        return;
      }
      remote = read.record;
    }
    const local = engine.snapshotChapter(state.chapter.id);
    const localKey = progressFingerprint(local), remoteKey = progressFingerprint(remote);
    if (state.pending) {
      if (localKey === remoteKey) accept(state,remote);
      else conflict(state,remote);
    } else if (state.base === undefined) {
      if (!remote) accept(state,null);
      else if (!hasCourseWork(local)) restore(state,remote);
      else if (localKey === remoteKey) accept(state,remote);
      else conflict(state,remote);
    } else if (remoteKey === localKey || remoteKey === state.inflight) {
      accept(state,remote);
    } else if (remoteKey === state.base) {
      accept(state,remote);
    } else if (remote && localKey === state.base) {
      restore(state,remote);
    } else {
      conflict(state,remote);
    }
    phase = 'connected';
    message = '';
    render();
  }

  function schedule(state) {
    if (!current(state) || !state.serverReady || state.pending || state.blocked || state.error) return;
    timers.clearTimeout(state.timer);
    state.timer = timers.setTimeout(() => { void save(state); },delay);
  }

  async function save(state) {
    const ticket = epoch, expectedUid = uid;
    timers.clearTimeout(state.timer);
    if (!current(state,ticket,expectedUid) || !state.serverReady || state.pending || state.blocked) return;
    if (state.writing) { state.dirty = true; return; }
    const payload = engine.snapshotChapter(state.chapter.id);
    if (!hasCourseWork(payload)) return;
    const payloadKey = progressFingerprint(payload), base = state.base;
    if (payloadKey === base) { state.dirty = false; render(); return; }
    state.writing = true;
    state.inflight = payloadKey;
    state.error = false;
    render();
    const {db,dbApi:d} = cloud;
    const ref = d.doc(db,'students',expectedUid,'courseProgress',String(state.chapter.id));
    try {
      const acknowledged = await d.runTransaction(db,async transaction => {
        const snapshot = await transaction.get(ref);
        if (!current(state,ticket,expectedUid)) throw failure('ceproc/stale');
        let remote = null;
        if (snapshot.exists()) {
          const read = readCourseRecord(state.chapter,snapshot.data(),expectedUid,engine.cleanAnswers);
          if (read.kind !== 'valid') throw failure('ceproc/'+read.kind);
          remote = read.record;
        }
        const remoteKey = progressFingerprint(remote);
        if (remoteKey === payloadKey) return remote;
        if (remoteKey !== base) throw failure('ceproc/conflict',remote);
        if (!current(state,ticket,expectedUid)) throw failure('ceproc/stale');
        transaction.set(ref,{uid:expectedUid,chapterId:state.chapter.id,exerciseVersion:payload.exerciseVersion,
          answers:clone(payload.answers),submitted:payload.submitted,
          clientUpdatedAt:payload.clientUpdatedAt,updatedAt:d.serverTimestamp()});
        return payload;
      });
      if (!current(state,ticket,expectedUid)) return;
      accept(state,acknowledged);
      dispatch('ceproc:course-synced',{uid:expectedUid,chapterId:state.chapter.id});
    } catch (error) {
      if (!current(state,ticket,expectedUid)) return;
      if (permissionDenied(error)) deny(state,ticket,expectedUid);
      else if (error.code === 'ceproc/conflict') conflict(state,error.record);
      else if (['ceproc/incompatible','ceproc/invalid'].includes(error.code)) {
        state.blocked = error.code.split('/')[1];
        state.serverReady = false;
      } else if (error.code !== 'ceproc/stale') {
        state.dirty = true;
        state.error = true;
        state.serverReady = false;
        message = 'Connexion indisponible. Vos réponses restent conservées sur cet appareil ; la synchronisation reprendra après reconnexion.';
      }
    } finally {
      if (current(state,ticket,expectedUid)) {
        state.writing = false;
        state.inflight = undefined;
        if (state.dirty && !state.error && !state.pending) schedule(state);
        render();
      }
    }
  }

  async function resolveConflict(chapterId,decision,expectedConflict) {
    const state = states.get(Number(chapterId));
    if (!state || !state.pending || !current(state) || state.writing || !['remote','local'].includes(decision)) return false;
    const pending = state.pending;
    if (expectedConflict && pending !== expectedConflict) return false;
    const local = engine.snapshotChapter(state.chapter.id);
    if (progressFingerprint(local) !== progressFingerprint(pending.local)
      || local.clientUpdatedAt !== pending.local.clientUpdatedAt) {
      conflict(state,state.remote);
      return false;
    }
    if (decision === 'local') {
      state.base = progressFingerprint(pending.remote);
      state.pending = null;
      state.serverReady = true;
      state.dirty = true;
      await save(state);
      return !state.pending && !state.blocked && !state.error;
    }
    if (!pending.remote) return false;
    const ticket = epoch, expectedUid = uid;
    state.writing = true;
    render();
    try {
      const {db,dbApi:d} = cloud;
      const latest = await d.getDocFromServer(d.doc(db,'students',expectedUid,'courseProgress',String(state.chapter.id)));
      if (!current(state,ticket,expectedUid) || state.pending !== pending) return false;
      const read = latest.exists() ? readCourseRecord(state.chapter,latest.data(),expectedUid,engine.cleanAnswers) : {kind:'missing'};
      if (read.kind !== 'valid') {
        if (read.kind === 'missing') conflict(state,null);
        else { state.blocked = read.kind; state.pending = null; state.serverReady = false; }
        return false;
      }
      const nowLocal = engine.snapshotChapter(state.chapter.id);
      if (progressFingerprint(read.record) !== progressFingerprint(pending.remote)
        || nowLocal.clientUpdatedAt !== pending.local.clientUpdatedAt) {
        conflict(state,read.record);
        return false;
      }
      restore(state,read.record);
      return true;
    } catch (error) {
      if (!current(state,ticket,expectedUid)) return false;
      if (permissionDenied(error)) deny(state,ticket,expectedUid);
      else message = 'La copie en ligne n’a pas pu être vérifiée. Aucune réponse locale n’a été remplacée.';
      return false;
    } finally {
      if (current(state,ticket,expectedUid)) { state.writing = false; render(); }
    }
  }

  async function onIdentity(detail,force=false) {
    const user = detail?.user, access = detail?.access;
    const next = user?.emailVerified === true && access?.active === true && allowedRoles.has(access.role)
      && typeof user.uid === 'string' && user.uid.length > 0 && user.uid.length <= 128
      && !/[\u0000-\u001f]/.test(user.uid) ? user.uid : null;
    if (!next) { deactivate('anonymous'); return; }
    if (!force && uid === next && identity?.access?.active === true && phase !== 'connection-error') {
      identity = detail;
      return;
    }
    epoch++;
    clearStates();
    uid = next;
    identity = detail;
    engine.switchUser(next);
    phase = 'connecting';
    message = '';
    const ticket = epoch;
    render();
    try {
      const connection = await connect();
      if (!active(ticket,next)) return;
      cloud = connection;
      if (!authorized(ticket,next)) return;
      const verifiedAccess = await checkAccess(cloud.auth.currentUser);
      if (!authorized(ticket,next)) return;
      if (verifiedAccess?.active !== true || !allowedRoles.has(verifiedAccess.role)) {
        deactivate('denied','Votre accès aux cours a été refusé. Les vues privées ont été fermées.');
        dispatch('ceproc:access-denied',{uid:next,source:'courses'});
        return;
      }
      identity = {...detail,access:verifiedAccess};
      const bank = engine.getChapters().filter(chapter => versionPattern.test(chapter.exerciseVersion));
      if (bank.length !== 18) throw failure('ceproc/bank-unavailable');
      phase = 'waiting';
      for (const chapter of bank) {
        if (!authorized(ticket,next)) return;
        const state = {chapter,base:undefined,remote:null,pending:null,blocked:null,
          dirty:false,writing:false,error:false,serverReady:false};
        states.set(chapter.id,state);
        const {db,dbApi:d} = cloud;
        state.unsubscribe = d.onSnapshot(d.doc(db,'students',next,'courseProgress',String(chapter.id)),
          {includeMetadataChanges:true},snapshot => processRemote(state,snapshot,ticket,next),error => {
            if (!current(state,ticket,next)) return;
            if (permissionDenied(error)) deny(state,ticket,next);
            else { state.serverReady = false; state.error = true; render(); }
          });
      }
      render();
    } catch (error) {
      if (!active(ticket,next)) return;
      if (permissionDenied(error)) {
        deactivate('denied','Votre accès aux cours a été refusé. Les vues privées ont été fermées.');
        dispatch('ceproc:access-denied',{uid:next,source:'courses'});
      } else {
        phase = 'connection-error';
        message = 'La synchronisation n’a pas pu démarrer. Les réponses de ce compte restent conservées sur cet appareil.';
        render();
      }
    }
  }

  async function retry() {
    if (identity?.access?.active) await onIdentity(identity,true);
  }

  function saved(event) {
    const detail = event.detail;
    if (detail?.origin !== 'local' || detail.uid !== uid || !active()) return;
    const state = states.get(detail.chapterId);
    if (!state) return;
    message = '';
    if (state.pending) conflict(state,state.remote);
    else { state.dirty = true; state.error = false; schedule(state); render(); }
  }

  function start() {
    if (started || disposed) return;
    started = true;
    try {
      const bank = doc?.getElementById('course-data');
      if (bank) engine.registerChapters(JSON.parse(bank.textContent).chapters);
    } catch { /* The page's mounted definitions remain available. */ }
    listen('ceproc:identity',event => { void onIdentity(event.detail); });
    listen('ceproc:course-saved',saved);
    listen('ceproc:access-denied',event => {
      if (uid && (!event.detail?.uid || event.detail.uid === uid)) deactivate('denied');
    });
    listen('online',() => { void retry(); });
    if (!configured()) { render(); return; }
    const initial = host.CeprocAccount?.getIdentity?.();
    if (initial) void onIdentity(initial);
    else render();
  }

  return {
    start,onIdentity,retry,resolveConflict,
    async flush() { for (const state of states.values()) if (state.dirty) await save(state); },
    getStatus() { return {uid,phase,chapters:[...states.values()].map(state => ({chapterId:state.chapter.id,
      ready:state.serverReady,pending:!!state.pending,blocked:state.blocked,dirty:state.dirty,writing:state.writing}))}; },
    dispose() { disposed = true; epoch++; clearStates(); removers.forEach(remove => remove()); },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const controller = createCourseAccount();
  if (controller) { window.CeprocCourseAccount = controller; controller.start(); }
}
