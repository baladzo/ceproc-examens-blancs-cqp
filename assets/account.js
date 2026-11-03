import {connectCloud, getAccess, isCloudConfigured, isPermissionDenied, normalizeEmail} from './cloud.js';
import {BANK_VERSION, attemptFromSnapshot, chooseInitialState, queueAttempt} from './account-state.js';

const panel = document.getElementById('accountPanel');
const study = window.CeprocStudy;
let cloud, currentUser = null, access = null, identityEpoch = 0;
let suppressSync = true, readyToSync = false, saveTimer, unsubscribeGrant;
let message = '', pendingChoice = null, currentProfile = null, writing = false, writeAgain = false;
const pendingKey = uid => `ceproc-bank2-pending-attempts-${uid}`;

function node(tag, content, attributes={}) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  Object.entries(attributes).forEach(([key,value]) => element.setAttribute(key, value));
  return element;
}

function action(label, callback, parent) {
  const button = node('button', label, {type:'button'});
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await callback(); }
    catch (error) { await showError(error); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  parent.append(button);
  return button;
}

function notify(text) {
  message = text;
  render();
}

function identityChanged() {
  window.dispatchEvent(new CustomEvent('ceproc:identity', {detail:{user:currentUser, access}}));
}

function stopSync() {
  suppressSync = true;
  readyToSync = false;
  clearTimeout(saveTimer);
  unsubscribeGrant?.();
  unsubscribeGrant = undefined;
}

function clearPrivateView() {
  // switchUser saves the OLD namespace and emits ceproc:save, so inhibit first.
  stopSync();
  study?.switchUser(null);
  pendingChoice = null;
  currentProfile = null;
  access = null;
  identityChanged();
}

async function showError(error) {
  if (isPermissionDenied(error)) {
    identityEpoch++;
    clearPrivateView();
    message = 'Accès aux données refusé. Les vues privées ont été fermées ; vérifiez votre autorisation auprès de l’administrateur.';
  } else if (error?.code === 'auth/invalid-credential') {
    message = 'Connexion impossible. Vérifiez votre adresse et votre mot de passe.';
  } else if (error?.code === 'auth/weak-password') {
    message = 'Le mot de passe ne respecte pas la politique du service.';
  } else if (error?.code === 'auth/too-many-requests') {
    message = 'Trop de tentatives. Réessayez plus tard.';
  } else {
    message = 'L’opération n’a pas abouti. Les réponses enregistrées sur cet appareil restent disponibles. Réessayez quand la connexion est rétablie.';
  }
  render();
}

function readQueue(uid) {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey(uid)) || '[]');
    return Array.isArray(value) ? value.filter(item => item?.data?.uid === uid && typeof item.id === 'string').slice(-100) : [];
  } catch { return []; }
}

function storeQueue(uid, queue) {
  try { localStorage.setItem(pendingKey(uid), JSON.stringify(queue)); }
  catch { message = 'Sauvegarde locale indisponible : gardez la page ouverte et réessayez la synchronisation.'; }
}

function canSync(uid, epoch) {
  return readyToSync && !suppressSync && currentUser?.uid === uid && identityEpoch === epoch
    && access?.active === true;
}

async function syncNow() {
  if (!currentUser || !access?.active || !readyToSync || suppressSync || !study) return;
  if (writing) { writeAgain = true; return; }
  writing = true;
  const uid = currentUser.uid, epoch = identityEpoch;
  const state = study.snapshot();
  const {db, dbApi:d} = cloud;
  try {
    if (!canSync(uid, epoch)) return;
    await d.setDoc(d.doc(db, 'students', uid, 'progress', 'current'), {
      uid, version:2, bankVersion:BANK_VERSION, state,
      clientUpdatedAt:Date.now(), updatedAt:d.serverTimestamp(),
    });
    if (!canSync(uid, epoch)) return;
    const queue = readQueue(uid);
    for (const attempt of queue) {
      if (!canSync(uid, epoch)) return;
      const ref = d.doc(db, 'students', uid, 'attempts', attempt.id);
      // Transaction makes a retry idempotent while rules forbid changing attempts.
      await d.runTransaction(db, async transaction => {
        const existing = await transaction.get(ref);
        if (!existing.exists()) transaction.set(ref, {...attempt.data, createdAt:d.serverTimestamp()});
      });
      if (!canSync(uid, epoch)) return;
      storeQueue(uid, readQueue(uid).filter(item => item.id !== attempt.id));
    }
    if (canSync(uid, epoch)) notify('Réponses synchronisées avec votre espace.');
  } catch (error) {
    if (identityEpoch === epoch) await showError(error);
  } finally {
    writing = false;
    if (writeAgain) { writeAgain = false; scheduleSync(); }
  }
}

function scheduleSync() {
  if (suppressSync || !readyToSync || !access?.active) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncNow, 900);
}

async function startAuthorizedUser(user, epoch) {
  const {db, dbApi:d} = cloud;
  suppressSync = true;
  study?.switchUser(user.uid);
  const studentRef = d.doc(db, 'students', user.uid);
  const profile = await d.getDocFromServer(studentRef);
  if (epoch !== identityEpoch) return;
  const savedProfile = profile.exists() ? profile.data() : null;
  const identity = {uid:user.uid, email:normalizeEmail(user.email), role:access.role,
    displayName:savedProfile ? savedProfile.displayName || '' : user.displayName || '',
    updatedAt:d.serverTimestamp(), lastSeenAt:d.serverTimestamp()};
  if (!profile.exists()) {
    identity.createdAt = d.serverTimestamp();
    identity.group = '';
  }
  await d.setDoc(studentRef, identity, {merge:true});
  if (epoch !== identityEpoch) return;
  currentProfile = {displayName:identity.displayName, group:savedProfile?.group || ''};
  const progress = await d.getDocFromServer(d.doc(db, 'students', user.uid, 'progress', 'current'));
  if (epoch !== identityEpoch) return;
  const remote = progress.exists() ? progress.data().state : null;
  const choice = chooseInitialState(study?.snapshot(), remote);
  if (choice === 'incompatible') {
    notify('La sauvegarde distante concerne une autre version des examens. Elle n’a pas été remplacée ; contactez le formateur.');
    return;
  }
  if (choice === 'conflict') {
    pendingChoice = {remote, epoch};
    notify('Deux sauvegardes différentes existent pour ce compte. Choisissez celle à reprendre. Les tentatives déjà remises restent conservées.');
  } else {
    if (choice === 'remote') study?.restoreRemote(remote);
    readyToSync = true;
    suppressSync = false;
    notify('Espace personnel ouvert. Vos nouvelles réponses seront synchronisées.');
    scheduleSync();
  }
  unsubscribeGrant = d.onSnapshot(d.doc(db, 'accessGrants', normalizeEmail(user.email)), snapshot => {
    if (epoch !== identityEpoch) return;
    const grant = snapshot.exists() ? snapshot.data() : null;
    if (!grant || grant.active !== true || !['student','trainer','admin'].includes(grant.role)
        || (grant.bootstrapUid && grant.bootstrapUid !== user.uid)) {
      identityEpoch++;
      clearPrivateView();
      notify('Votre accès a été retiré. Les vues privées sont fermées.');
      return;
    }
    const roleChanged = access?.role !== grant.role;
    access = {...access, role:grant.role};
    if (roleChanged) {
      // This snapshot role is not an authority: the server checks it against the grant.
      d.updateDoc(studentRef,{role:grant.role,updatedAt:d.serverTimestamp()})
        .catch(error => { if (epoch === identityEpoch) void showError(error); });
    }
    identityChanged();
    render();
  }, async error => { if (epoch === identityEpoch) await showError(error); });
}

async function authChanged(user) {
  const epoch = ++identityEpoch;
  clearPrivateView();
  currentUser = user;
  identityChanged();
  if (!user) { notify('Vous révisez sur cet appareil, sans synchronisation de compte.'); return; }
  if (!user.emailVerified) { notify('Vérifiez votre adresse pour ouvrir un espace autorisé. Aucun e-mail n’est envoyé automatiquement.'); return; }
  try {
    access = await getAccess(user);
    if (epoch !== identityEpoch) return;
    if (!access.active) { notify('Ce compte n’a pas d’autorisation active. Demandez l’accès à l’administrateur.'); return; }
    identityChanged();
    await startAuthorizedUser(user, epoch);
  } catch (error) { if (epoch === identityEpoch) await showError(error); }
}

function render() {
  if (!panel) return;
  panel.replaceChildren();
  panel.append(node('h2', 'Mon espace'));
  if (!isCloudConfigured()) {
    panel.append(node('p', 'Le suivi de l’école n’est pas encore activé. Tu peux réviser et exporter tes réponses sur cet appareil.'));
    return;
  }
  if (!cloud) {
    panel.append(node('p', message || 'Chargement du service de connexion…', {role:'status'}));
    return;
  }
  panel.append(node('p', message, {role:'status','aria-live':'polite'}));
  if (!currentUser) {
    const form = node('form');
    const emailId = 'ceprocAccountEmail', passwordId = 'ceprocAccountPassword';
    form.append(node('label', 'Adresse e-mail', {for:emailId}));
    const email = node('input', undefined, {id:emailId, type:'email', autocomplete:'username', required:'', maxlength:'254'});
    form.append(email, node('label', 'Mot de passe', {for:passwordId}));
    const password = node('input', undefined, {id:passwordId, type:'password', autocomplete:'current-password', required:'', minlength:'8', maxlength:'256'});
    form.append(password);
    const submit = node('button', 'Se connecter', {type:'submit'});
    form.append(submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      const enteredPassword = password.value;
      password.value = '';
      try { await cloud.authApi.signInWithEmailAndPassword(cloud.auth, normalizeEmail(email.value), enteredPassword); }
      catch (error) { await showError(error); }
      finally { if (submit.isConnected) submit.disabled = false; }
    });
    action('Créer mon compte', async () => {
      if (!form.reportValidity()) return;
      const enteredPassword = password.value;
      password.value = '';
      await cloud.authApi.createUserWithEmailAndPassword(cloud.auth, normalizeEmail(email.value), enteredPassword);
      // Verification is an explicit separate click, never automatic at sign-up.
    }, form);
    action('Mot de passe oublié : envoyer un e-mail', async () => {
      if (!email.reportValidity()) return;
      await cloud.authApi.sendPasswordResetEmail(cloud.auth, normalizeEmail(email.value));
      notify('Si cette adresse permet une réinitialisation, les instructions ont été demandées.');
    }, form);
    panel.append(form, node('p', 'L’inscription ne donne pas l’accès : votre adresse doit être vérifiée et autorisée par l’administrateur.'));
    return;
  }
  panel.append(node('p', currentUser.email || 'Compte connecté'));
  if (!currentUser.emailVerified) {
    action('Envoyer mon e-mail de vérification', async () => {
      await cloud.authApi.sendEmailVerification(currentUser);
      notify('E-mail de vérification demandé. Ouvrez-le, puis revenez vérifier votre accès.');
    }, panel);
    action('J’ai vérifié mon adresse', async () => {
      await cloud.authApi.reload(currentUser);
      await currentUser.getIdToken(true);
      await authChanged(cloud.auth.currentUser);
    }, panel);
  } else if (access?.active) {
    panel.append(node('p', `Rôle : ${{student:'élève',trainer:'formateur',admin:'administrateur'}[access.role]}`));
    if (currentProfile) {
      const details = node('details');
      details.append(node('summary', 'Mon profil'));
      const profileForm = node('form');
      profileForm.append(node('label', 'Nom ou pseudo (facultatif)', {for:'ceprocProfileName'}));
      const name = node('input', undefined, {id:'ceprocProfileName',type:'text',maxlength:'120',autocomplete:'nickname'});
      name.value = currentProfile.displayName;
      profileForm.append(name, node('label', 'Groupe (facultatif)', {for:'ceprocProfileGroup'}));
      const group = node('input', undefined, {id:'ceprocProfileGroup',type:'text',maxlength:'120'});
      group.value = currentProfile.group;
      const submit = node('button', 'Enregistrer mon profil', {type:'submit'});
      profileForm.append(group,submit);
      profileForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!profileForm.reportValidity()) return;
        const uid = currentUser?.uid, epoch = identityEpoch;
        if (!uid || !access?.active) return;
        submit.disabled = true;
        const fields = {displayName:name.value.trim(),group:group.value.trim()};
        try {
          await cloud.dbApi.updateDoc(cloud.dbApi.doc(cloud.db,'students',uid), {
            ...fields,updatedAt:cloud.dbApi.serverTimestamp(),
          });
          if (epoch === identityEpoch) {
            currentProfile = fields;
            notify('Profil enregistré. Le groupe sert à organiser le suivi.');
          }
        } catch (error) { if (epoch === identityEpoch) await showError(error); }
        finally { if (submit.isConnected) submit.disabled = false; }
      });
      details.append(profileForm);
      panel.append(details);
    }
    if (pendingChoice) {
      action('Reprendre la sauvegarde distante', async () => {
        const selected = pendingChoice;
        if (!selected || selected.epoch !== identityEpoch) return;
        study?.restoreRemote(selected.remote);
        pendingChoice = null; readyToSync = true; suppressSync = false;
        notify('Sauvegarde distante reprise.'); scheduleSync();
      }, panel);
      action('Conserver la sauvegarde de cet appareil', async () => {
        if (!pendingChoice || pendingChoice.epoch !== identityEpoch) return;
        pendingChoice = null; readyToSync = true; suppressSync = false;
        notify('Sauvegarde de cet appareil retenue.'); scheduleSync();
      }, panel);
    } else if (readyToSync) action('Synchroniser maintenant', syncNow, panel);
    if (['trainer','admin'].includes(access.role)) panel.append(node('a', 'Ouvrir le suivi des élèves', {href:'admin.html'}));
  } else {
    action('Revérifier mon accès', async () => authChanged(cloud.auth.currentUser), panel);
  }
  action('Se déconnecter', async () => {
    identityEpoch++;
    clearPrivateView();
    await cloud.authApi.signOut(cloud.auth);
  }, panel);
}

window.addEventListener('ceproc:save', scheduleSync);
window.addEventListener('ceproc:complete', event => {
  if (suppressSync || !readyToSync || !access?.active || !currentUser) return;
  const attempt = attemptFromSnapshot(currentUser.uid, event.detail?.examId, study?.snapshot());
  storeQueue(currentUser.uid, queueAttempt(readQueue(currentUser.uid), attempt));
  scheduleSync();
});
window.addEventListener('online', scheduleSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && readyToSync) void syncNow();
});

export async function initializeAccounts() {
  render();
  if (!panel || !study || !isCloudConfigured()) return;
  try {
    cloud = await connectCloud();
    cloud.authApi.onAuthStateChanged(cloud.auth, authChanged);
  } catch (error) { await showError(error); }
}

void initializeAccounts();
