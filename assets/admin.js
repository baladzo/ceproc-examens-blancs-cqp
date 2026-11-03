import {connectCloud,getAccess} from './cloud.js';
import {summarizeStudent,schoolStats,csvCell} from './stats.js';
import {loadProgressBanks,summarizeCourseProgress,renderCourseProgress} from './personal-progress.js';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const fmt=n=>n===null||n===undefined?'—':Number(n).toLocaleString('fr-FR',{maximumFractionDigits:2});
const date=n=>n?new Date(n).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'Aucune tentative';
const roles={student:'Élève',trainer:'Formateur',admin:'Administrateur'};
let cloud,bank,courseBank,user,access,students=[],grants=[],session=0,loadEpoch=0,stopGrant;
function status(text){$('cloudStatus').textContent=text;}
function clearPrivate(){students=[];grants=[];$('privatePanel').hidden=true;$('studentRows').replaceChildren();$('grantRows').replaceChildren();$('studentDetail').replaceChildren();$('studentDetail').hidden=true;$('kpis').replaceChildren();$('identity').textContent='';$('groupFilter').replaceChildren(new Option('Tous les groupes',''));$('grantEmail').value='';$('grantStatus').textContent='';}
function denied(error){++session;++loadEpoch;stopGrant?.();stopGrant=undefined;access=null;clearPrivate();$('loginPanel').hidden=false;status(['permission-denied','firestore/permission-denied'].includes(error?.code)?'Accès aux données refusé. Vérifie ton autorisation auprès de l’administrateur.':'Chargement interrompu. Aucune donnée privée n’est affichée. Réessaie après avoir vérifié la connexion.');}
function filtered(){const term=$('searchInput').value.trim().toLocaleLowerCase('fr');const group=$('groupFilter').value;return students.filter(s=>(!group||(s.group||'Sans groupe')===group)&&(!term||[s.displayName,s.email].join(' ').toLocaleLowerCase('fr').includes(term)));}
function draw(){
  const rows=filtered(),s=schoolStats(rows);$('kpis').replaceChildren();
  for(const [value,label] of [[s.students,'élèves affichés'],[s.attempts,'tentatives enregistrées'],[fmt(s.average),'moyenne sur 50'],[s.passRate===null?'—':fmt(s.passRate)+' %','réussite · dernières tentatives']]){const c=el('div',undefined,'kpi');c.append(el('strong',value),el('span',label));$('kpis').append(c);}
  $('studentRows').replaceChildren();
  for(const row of rows){const tr=el('tr'),name=el('td');name.append(el('strong',row.displayName||'Élève'),el('small',row.email),el('small',row.group||'Sans groupe'));tr.append(name,el('td',row.completed+' / '+bank.exams.length),el('td',row.courseSummary.completed+' / '+row.courseSummary.total),el('td',row.attemptCount),el('td',fmt(row.average)),el('td',row.improvement===null?'Pas encore comparable':(row.improvement>0?'+':'')+fmt(row.improvement)+' pts'),el('td',date(row.lastWhen)));const td=el('td'),b=el('button','Consulter','secondary');b.type='button';b.addEventListener('click',()=>detail(row));td.append(b);tr.append(td);$('studentRows').append(tr);}
  if(!rows.length){const tr=el('tr'),td=el('td','Aucun élève ne correspond aux filtres.');td.colSpan=8;tr.append(td);$('studentRows').append(tr);}
}
function detail(s){
  const box=$('studentDetail');box.replaceChildren();box.hidden=false;
  box.append(el('h2',s.displayName||s.email),el('p',s.email+' · '+(s.group||'Sans groupe')),el('p','Meilleure moyenne : '+fmt(s.bestAverage)+' / 50 · Sujets réussis à la dernière tentative : '+s.passed+' / '+s.completed));
  const progress=s.progress?.state?.exams||{};
  const current=Object.entries(progress).filter(([,v])=>!v.resultsViewed&&Object.keys(v.answers||{}).length);
  if(current.length)box.append(el('p','En cours : '+current.map(([id,v])=>'sujet '+id+' ('+Object.keys(v.answers||{}).length+' question(s) commencée(s))').join(' ; ')));
  box.append(el('h3','Évolution des notes'));
  const chart=el('div',undefined,'trend');chart.setAttribute('role','img');chart.setAttribute('aria-label',s.scored.length?s.scored.map(a=>'Sujet '+a.examId+' : '+fmt(a.grade.score)+' sur 50, '+date(a.when)).join(' ; '):'Aucune tentative');
  for(const a of s.scored){const item=el('div',undefined,'trend-item');item.title=date(a.when);item.append(el('span',fmt(a.grade.score)));const bar=el('span',undefined,'trend-bar');bar.style.height=(a.grade.rawScore/50*105)+'px';item.append(bar,el('span','S'+a.examId));chart.append(item);}box.append(chart);
  box.append(el('h3','Compétences à retravailler'),el('p','Scores regroupés par thème, à partir de la dernière tentative de chaque sujet.', 'hint'));
  for(const d of s.domains){const row=el('div',undefined,'theme'),track=el('div',undefined,'theme-track'),fill=el('div',undefined,'theme-fill');fill.style.width=Math.max(0,Math.min(100,d.percent))+'%';track.append(fill);row.append(el('span',d.label),track,el('strong',fmt(d.percent)+' %'));box.append(row);}
  const wrap=el('div',undefined,'table-wrap'),table=el('table');table.append(el('caption','Historique des tentatives'));const head=el('thead'),hr=el('tr');['Date','Sujet','Note / 50','Bonnes questions','Résultat'].forEach(t=>hr.append(el('th',t)));head.append(hr);table.append(head);const body=el('tbody');for(const a of [...s.scored].reverse()){const tr=el('tr');[date(a.when),a.exam.title,fmt(a.grade.score),a.grade.fullyCorrect+' / '+a.grade.totalQuestions,a.grade.passed?'REÇU':'NON REÇU'].forEach(t=>tr.append(el('td',t)));body.append(tr);}table.append(body);wrap.append(table);box.append(wrap);
  renderCourseProgress(box,s.courseSummary,{title:'Exercices des cours de cet élève'});
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadData(){
  const mySession=session,myLoad=++loadEpoch,actor=user;
  const live=()=>mySession===session&&myLoad===loadEpoch&&actor?.uid===user?.uid;
  try {
  const permission=await getAccess(actor);
  if(!live())return false;
  if(!permission?.active||!['admin','trainer'].includes(permission.role))throw Object.assign(new Error('refused'),{code:'permission-denied'});
  access=permission;
  if(access.role!=='admin'){grants=[];$('grantRows').replaceChildren();$('grantEmail').value='';$('grantStatus').textContent='';}
  const {db,dbApi:d}=cloud;
  const roster=await d.getDocsFromServer(d.collection(db,'students'));
  if(!live())return false;
  const loaded=[];
  for(const student of roster.docs){
    const data=student.data();
    if(data.role!=='student')continue;
    const [attemptDocs,progressDoc,courseDocs]=await Promise.all([d.getDocsFromServer(d.collection(db,'students',student.id,'attempts')),d.getDocFromServer(d.doc(db,'students',student.id,'progress','current')),d.getDocsFromServer(d.collection(db,'students',student.id,'courseProgress'))]);
    if(!live())return false;
    const progress=progressDoc.exists()?progressDoc.data():null;
    const courseSummary=summarizeCourseProgress(courseBank,courseDocs.docs.map(doc=>doc.data()),window.gradeQuestion,student.id);
    loaded.push(summarizeStudent(bank,{...data,id:student.id,courseSummary,progress:progress?.uid===student.id&&progress.bankVersion===bank.bankVersion?progress:null},attemptDocs.docs.map(doc=>({...doc.data(),id:doc.id})).filter(attempt=>attempt.uid===student.id),window.gradeExam));
  }
  if(!live())return false;
  students=loaded.sort((a,b)=>(a.displayName||a.email).localeCompare(b.displayName||b.email,'fr'));
  const oldGroup=$('groupFilter').value;$('groupFilter').replaceChildren(new Option('Tous les groupes',''));
  for(const group of [...new Set(students.map(s=>s.group||'Sans groupe'))].sort())$('groupFilter').append(new Option(group,group));
  if([...$('groupFilter').options].some(o=>o.value===oldGroup))$('groupFilter').value=oldGroup;
  $('privatePanel').hidden=false;$('loginPanel').hidden=true;$('identity').textContent=(user.email||'')+' · '+roles[access.role];$('accessTab').hidden=access.role!=='admin';
  if(access.role!=='admin')showTab('students');
  draw();
  status('Données privées chargées · '+new Date().toLocaleTimeString('fr-FR')+'. Le bilan porte sur les dix sujets et les '+courseBank.chapters.length+' cours de cette version.');
  if(access.role==='admin')await loadGrants(mySession,myLoad);
  return live();
  }catch(error){if(!live())return false;throw error;}
}
async function loadGrants(mySession=session,myLoad=loadEpoch){const {db,dbApi:d}=cloud;const docs=await d.getDocsFromServer(d.collection(db,'accessGrants'));if(mySession!==session||myLoad!==loadEpoch||access?.role!=='admin')return;grants=docs.docs.map(doc=>({...doc.data(),id:doc.id})).sort((a,b)=>a.id.localeCompare(b.id));drawGrants();}
function drawGrants(){
  $('grantRows').replaceChildren();
  for(const grant of grants){const tr=el('tr');tr.append(el('td',grant.email||grant.id),el('td',roles[grant.role]||grant.role),el('td',grant.active?'Autorisé':'Retiré'));const td=el('td'),b=el('button',grant.active?'Retirer l’accès':'Réautoriser','secondary');b.addEventListener('click',async()=>{b.disabled=true;try{const {db,dbApi:d}=cloud;await d.updateDoc(d.doc(db,'accessGrants',grant.id),{active:!grant.active,updatedAt:d.serverTimestamp(),updatedBy:user.uid});$('grantStatus').textContent='Autorisation mise à jour. Aucun message envoyé.';await loadData();}catch(e){denied(e);}});td.append(b);const edit=el('button','Modifier le rôle','secondary');edit.addEventListener('click',()=>{$('grantEmail').value=grant.email||grant.id;$('grantRole').value=grant.role;$('grantEmail').focus();});td.append(document.createTextNode(' '),edit);tr.append(td);$('grantRows').append(tr);}
}
function showTab(which){$('studentsPanel').hidden=which!=='students';$('accessPanel').hidden=which!=='access';$('studentsTab').setAttribute('aria-pressed',String(which==='students'));$('accessTab').setAttribute('aria-pressed',String(which==='access'));}
$('studentsTab').addEventListener('click',()=>showTab('students'));$('accessTab').addEventListener('click',()=>{if(access?.role==='admin')showTab('access');});
$('searchInput').addEventListener('input',draw);$('groupFilter').addEventListener('change',draw);
$('refreshButton').addEventListener('click',()=>loadData().catch(denied));
$('logoutButton').addEventListener('click',async()=>{++session;clearPrivate();await cloud.authApi.signOut(cloud.auth);});
$('loginForm').addEventListener('submit',async event=>{event.preventDefault();const b=event.submitter;b.disabled=true;try{await cloud.authApi.signInWithEmailAndPassword(cloud.auth,$('adminEmail').value.trim().toLowerCase(),$('adminPassword').value);$('adminPassword').value='';}catch(e){status('Connexion impossible. Vérifie tes identifiants et la disponibilité du service.');}finally{b.disabled=false;}});
$('grantForm').addEventListener('submit',async event=>{
  event.preventDefault();if(access?.role!=='admin')return;
  const email=$('grantEmail').value.trim().toLowerCase(),role=$('grantRole').value,b=event.submitter;
  if(!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email)||!roles[role])return;
  b.disabled=true;
  try{const {db,dbApi:d}=cloud;const ref=d.doc(db,'accessGrants',email),existing=await d.getDocFromServer(ref);const grant={email,role,active:true,updatedAt:d.serverTimestamp(),updatedBy:user.uid};if(!existing.exists())grant.createdAt=d.serverTimestamp();await d.setDoc(ref,grant,{merge:true});$('grantStatus').textContent='Accès autorisé. Aucun e-mail ni invitation envoyé. La personne pourra utiliser le lien d’inscription.';await loadData();}catch(e){denied(e);}finally{b.disabled=false;}
});
$('copyLink').addEventListener('click',async()=>{const url=new URL('index.html#accountPanel',location.href).href;try{await navigator.clipboard.writeText(url);$('grantStatus').textContent='Lien copié. Aucun message envoyé.';}catch(e){$('grantStatus').textContent='Lien à copier : '+url;}});
$('exportButton').addEventListener('click',()=>{
  const rows=[['Nom','E-mail','Groupe','Sujets terminés','Cours corrigés','Moyenne cours /10','Tentatives','Moyenne dernière /50','Meilleure moyenne /50','Progression points','Dernière tentative'],...filtered().map(s=>[s.displayName,s.email,s.group,s.completed,s.courseSummary.completed,fmt(s.courseSummary.average),s.attemptCount,fmt(s.average),fmt(s.bestAverage),fmt(s.improvement),date(s.lastWhen)])];
  const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download='CEPROC_suivi_'+new Date().toISOString().slice(0,10)+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
try{
  cloud=await connectCloud();
  if(!cloud)throw Object.assign(new Error('not-configured'),{code:'not-configured'});
  const banks=await loadProgressBanks();bank=banks.examBank;courseBank=banks.courseBank;
  cloud.authApi.onAuthStateChanged(cloud.auth,async next=>{
    const authSession=++session;++loadEpoch;stopGrant?.();stopGrant=undefined;clearPrivate();user=next;access=null;
    if(!user){$('loginPanel').hidden=false;status('Connecte-toi pour consulter les données auxquelles tu es autorisé.');return;}
    if(!user.emailVerified){$('loginPanel').hidden=false;status('Vérifie ton adresse e-mail depuis l’espace élève avant de consulter le suivi.');return;}
    try{
      if(!await loadData()||authSession!==session||user?.uid!==next.uid)return;
      const {db,dbApi:d}=cloud;
      stopGrant=d.onSnapshot(d.doc(db,'accessGrants',user.email.trim().toLowerCase()),snap=>{
        if(authSession!==session||user?.uid!==next.uid)return;
        const grant=snap.exists()?snap.data():null;
        if(!grant?.active || !['admin','trainer'].includes(grant.role) || (grant.bootstrapUid && grant.bootstrapUid!==user.uid)){
          ++session;++loadEpoch;stopGrant?.();stopGrant=undefined;access=null;clearPrivate();$('loginPanel').hidden=false;status('Ton autorisation de suivi a été retirée. Les données privées ont été fermées.');
        }else if(grant.role!==access?.role){loadData().catch(denied);}
      },error=>{if(authSession===session&&user?.uid===next.uid)denied(error);});
    }catch(e){if(authSession===session&&user?.uid===next.uid)denied(e);}
  });
}catch(e){clearPrivate();$('loginPanel').hidden=true;status(e?.code==='ceproc/cloud-disabled'?'Le service de connexion n’est pas configuré. Contacte le responsable du site.':'Le suivi ne peut pas être chargé pour le moment. Vérifie la connexion puis recharge la page.');}
