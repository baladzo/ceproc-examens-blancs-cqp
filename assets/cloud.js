import {cloudEnabled, firebaseConfig, firebaseVersion} from './firebase-config.js';

let connection;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isCloudConfigured() {
  return cloudEnabled === true && ['apiKey', 'authDomain', 'projectId', 'appId']
    .every(key => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].trim());
}

export async function connectCloud() {
  if (!isCloudConfigured()) {
    const error = new Error('Les comptes partagés ne sont pas configurés. Les exercices restent disponibles sur cet appareil.');
    error.code = 'ceproc/cloud-disabled';
    throw error;
  }
  if (!connection) {
    connection = (async () => {
      const prefix = `https://www.gstatic.com/firebasejs/${firebaseVersion}/`;
      const [appApi, authApi, dbApi] = await Promise.all([
        import(prefix + 'firebase-app.js'),
        import(prefix + 'firebase-auth.js'),
        import(prefix + 'firebase-firestore.js'),
      ]);
      const app = appApi.getApps().find(candidate => candidate.name === 'ceproc-study')
        || appApi.initializeApp(firebaseConfig, 'ceproc-study');
      const auth = authApi.getAuth(app);
      // Do not persist an authenticated account after this browser session closes.
      await authApi.setPersistence(auth, authApi.browserSessionPersistence);
      auth.languageCode = 'fr';
      // Firestore's default memory cache is retained; no shared IndexedDB persistence.
      const db = dbApi.getFirestore(app);
      return {auth, db, authApi, dbApi};
    })().catch(error => { connection = undefined; throw error; });
  }
  return connection;
}

export async function getAccess(user) {
  const email = normalizeEmail(user?.email);
  if (!user || !email || !user.emailVerified) {
    return {active:false, role:null, email, reason:'email-unverified'};
  }
  const {db, dbApi} = await connectCloud();
  const snapshot = await dbApi.getDocFromServer(dbApi.doc(db, 'accessGrants', email));
  if (!snapshot.exists()) return {active:false, role:null, email, reason:'not-authorized'};
  const grant = snapshot.data();
  const role = ['student','trainer','admin'].includes(grant.role) ? grant.role : null;
  const uidMatches = !grant.bootstrapUid || grant.bootstrapUid === user.uid;
  return {email, role, active:grant.active === true && role !== null && uidMatches,
    reason:uidMatches ? undefined : 'uid-mismatch'};
}

export function isPermissionDenied(error) {
  return ['permission-denied', 'firestore/permission-denied'].includes(error?.code);
}
