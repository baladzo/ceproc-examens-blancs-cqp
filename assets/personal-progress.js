import {connectCloud,getAccess,isPermissionDenied} from './cloud.js';
import {summarizeStudent} from './stats.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fmt = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('fr-FR',{maximumFractionDigits:2});
const date = value => value ? new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}) : '—';
const denied = () => Object.assign(new Error('Accès refusé'),{code:'permission-denied'});
let bankRequest;

export async function loadProgressBanks() {
  if (!bankRequest) bankRequest=Promise.all(['assets/exam-bank.json','assets/course-bank.json'].map(async url => {
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error('Banque indisponible');
    return response.json();
  })).then(([examBank,courseBank])=>{
    if(!Array.isArray(examBank.exams)||!Array.isArray(courseBank.chapters))throw new Error('Banque invalide');
    return {examBank,courseBank};
  }).catch(error=>{bankRequest=undefined;throw error;});
  return bankRequest;
}

function moment(value,fallback=0) {
  try {if(typeof value?.toMillis==='function')return value.toMillis();} catch {}
  return typeof fallback==='number'&&Number.isFinite(fallback)?fallback:0;
}

function answeredCourse(chapter,answers) {
  return chapter.exercises.filter(q=>{
    const answer=answers[q.id];
    if(q.type==='single')return typeof answer==='string'&&q.options.some(o=>o.id===answer);
    if(q.type==='multi')return Array.isArray(answer)&&answer.length>0;
    return object(answer)&&q.fields.every(field=>Object.hasOwn(answer,field.id)&&String(answer[field.id]).trim()!=='');
  }).length;
}

export function summarizeCourseProgress(bank,records,gradeQuestion,uid) {
  const byId=new Map();
  for(const record of records||[]) {
    if(!object(record)||(uid&&record.uid!==uid)||!Number.isInteger(record.chapterId))continue;
    byId.set(record.chapterId,record);
  }
  const weak=new Map();
  const rows=(bank.chapters||[]).map(chapter=>{
    const record=byId.get(chapter.id);
    const base={id:chapter.id,title:chapter.title,total:chapter.exercises.length,answered:0,
      state:'unstarted',score:null,fullyCorrect:null,updatedAt:0};
    if(!record)return base;
    if(record.exerciseVersion!==chapter.exerciseVersion)return {...base,state:'old-version'};
    if(!object(record.answers))return base;
    const answered=answeredCourse(chapter,record.answers);
    const updatedAt=moment(record.updatedAt,record.clientUpdatedAt);
    if(record.submitted!==true)return {...base,answered,updatedAt,state:answered?'in-progress':'unstarted'};
    const details=chapter.exercises.map(q=>gradeQuestion(q,record.answers[q.id]));
    const rawScore=details.reduce((sum,result)=>sum+result.score,0);
    chapter.exercises.forEach((q,index)=>{
      const section=q.lessonSection||q.title,key=chapter.id+':'+section;
      const item=weak.get(key)||{chapterId:chapter.id,title:chapter.title,section,score:0,max:0};
      item.score+=details[index].score;item.max+=q.points;weak.set(key,item);
    });
    return {...base,answered,updatedAt,state:'completed',score:Math.round((rawScore+Number.EPSILON)*100)/100,
      fullyCorrect:details.filter(result=>result.fullyCorrect).length};
  });
  const completed=rows.filter(row=>row.state==='completed');
  return {rows,total:rows.length,completed:completed.length,
    started:rows.filter(row=>row.state==='in-progress'||row.state==='completed').length,
    average:completed.length?completed.reduce((sum,row)=>sum+row.score,0)/completed.length:null,
    weak:[...weak.values()].filter(row=>row.max>0&&row.score<row.max)
      .map(row=>({...row,percent:100*row.score/row.max})).sort((a,b)=>a.percent-b.percent)};
}

export async function readOwnProgress(connection,user) {
  if(!user?.uid||connection.auth?.currentUser?.uid!==user.uid)throw denied();
  const {db,dbApi:d}=connection,uid=user.uid;
  const [attempts,progress,courses]=await Promise.all([
    d.getDocsFromServer(d.collection(db,'students',uid,'attempts')),
    d.getDocFromServer(d.doc(db,'students',uid,'progress','current')),
    d.getDocsFromServer(d.collection(db,'students',uid,'courseProgress')),
  ]);
  if(connection.auth?.currentUser?.uid!==uid)throw denied();
  return {
    attempts:attempts.docs.map(item=>({...item.data(),id:item.id})).filter(item=>item.uid===uid),
    progress:progress.exists()&&progress.data().uid===uid?progress.data():null,
    courses:courses.docs.map(item=>({...item.data(),id:item.id})).filter(item=>item.uid===uid),
  };
}

function element(document,tag,text,className) {
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=String(text);
  if(className)node.className=className;
  return node;
}

function table(document,title,headers) {
  const wrap=element(document,'div',undefined,'pp-table-wrap'),node=element(document,'table');
  node.append(element(document,'caption',title));
  const head=element(document,'thead'),row=element(document,'tr');
  headers.forEach(text=>{const cell=element(document,'th',text);cell.scope='col';row.append(cell);});
  head.append(row);node.append(head);
  const body=element(document,'tbody');node.append(body);wrap.append(node);
  return {wrap,body};
}

const courseState = row => ({completed:'Corrigé','in-progress':'En cours','unstarted':'À commencer','old-version':'Nouvelle version à reprendre'}[row.state]);

export function renderCourseProgress(parent,summary,{title='Les exercices de mes cours',showWeak=true}={}) {
  const doc=parent.ownerDocument||document;
  const section=element(doc,'section',undefined,'pp-course-progress');
  section.append(element(doc,'h3',title),element(doc,'p',summary.completed+' / '+summary.total+' cours avec exercices corrigés · moyenne '+fmt(summary.average)+' / 10.','pp-note'));
  const grid=table(doc,'Suivi des exercices de chaque cours',['Cours','État','Questions renseignées','Note / 10']);
  for(const row of summary.rows) {
    const tr=element(doc,'tr'),name=element(doc,'td'),link=element(doc,'a',String(row.id).padStart(2,'0')+' · '+row.title);
    link.href='cours.html#chapitre-'+String(row.id).padStart(2,'0');name.append(link);
    tr.append(name,element(doc,'td',courseState(row)),element(doc,'td',row.answered+' / '+row.total),element(doc,'td',fmt(row.score)));
    grid.body.append(tr);
  }
  section.append(grid.wrap);
  if(showWeak&&summary.weak.length) {
    section.append(element(doc,'h4','Passages de cours à reprendre'));
    const list=element(doc,'ul');
    summary.weak.slice(0,8).forEach(row=>list.append(element(doc,'li','Cours '+String(row.chapterId).padStart(2,'0')+' · '+row.section+' : '+fmt(row.percent)+' % des points acquis.')));
    section.append(list);
  }
  parent.append(section);
}

function renderPersonal(panel,banks,data,gradeExam,gradeQuestion,refresh) {
  const doc=panel.ownerDocument||document;
  const exam=summarizeStudent(banks.examBank,{},data.attempts,gradeExam);
  const courses=summarizeCourseProgress(banks.courseBank,data.courses,gradeQuestion);
  const header=element(doc,'div',undefined,'pp-header'),heading=element(doc,'h2','Ma progression');
  heading.id='personalProgressTitle';heading.tabIndex=-1;
  const button=element(doc,'button','Actualiser');button.type='button';
  button.addEventListener('click',()=>void refresh(true));header.append(heading,button);
  panel.replaceChildren(header);
  panel.append(element(doc,'p','Les notes sont recalculées à partir de tes réponses enregistrées dans ton compte.','pp-note'));
  panel.append(element(doc,'p','Tes résultats sont consultables par les formateurs et administrateurs autorisés de l’école.','pp-note'));
  const cards=element(doc,'div',undefined,'pp-kpis');
  for(const [value,label] of [
    [exam.completed+' / '+banks.examBank.exams.length,'sujets terminés'],
    [fmt(exam.average)+' / 50','moyenne des dernières notes'],
    [fmt(exam.bestAverage)+' / 50','moyenne des meilleures notes'],
    [exam.passed+' / '+exam.completed,'sujets reçus à la dernière tentative'],
  ]){const card=element(doc,'div');card.append(element(doc,'strong',value),element(doc,'span',label));cards.append(card);}
  panel.append(cards);
  const exams=table(doc,'Mes dix examens blancs',['Sujet','État','Dernière / 50','Meilleure / 50','Résultat']);
  const progress=data.progress?.bankVersion===banks.examBank.bankVersion?data.progress?.state?.exams||{}:{};
  for(const subject of banks.examBank.exams) {
    const id=String(subject.id),last=exam.last.get(id),best=exam.best.get(id),pending=progress[id];
    const tr=element(doc,'tr');tr.dataset.examId=id;
    const result=element(doc,'td',last?(last.grade.passed?'REÇU':'NON REÇU'):'—');
    if(last)result.className=last.grade.passed?'pp-pass':'pp-retry';
    tr.append(element(doc,'td',subject.title),element(doc,'td',last?'Corrigé':Object.keys(pending?.answers||{}).length?'En cours':'À commencer'),
      element(doc,'td',last?fmt(last.grade.score):'—'),element(doc,'td',best?fmt(best.grade.score):'—'),result);
    exams.body.append(tr);
  }
  panel.append(exams.wrap,element(doc,'p','Objectif de l’examen blanc : au moins '+banks.examBank.threshold+' points sur 50.','pp-note'));
  const domains=exam.domains.filter(row=>row.percent<100);
  if(domains.length) {
    panel.append(element(doc,'h3','Thèmes des examens à revoir'));
    const list=element(doc,'ul',undefined,'pp-themes');
    domains.forEach(row=>list.append(element(doc,'li',row.label+' : '+fmt(row.percent)+' % des points acquis sur les dernières tentatives.')));
    panel.append(list);
  }
  const history=element(doc,'details',undefined,'pp-history');
  history.append(element(doc,'summary','Historique de mes tentatives ('+exam.attemptCount+')'));
  const attempts=table(doc,'Historique des examens',['Date','Sujet','Note / 50','Questions justes','Résultat']);
  for(const attempt of [...exam.scored].reverse()) {
    const row=element(doc,'tr');
    [date(attempt.when),attempt.exam.title,fmt(attempt.grade.score),attempt.grade.fullyCorrect+' / '+attempt.grade.totalQuestions,attempt.grade.passed?'REÇU':'NON REÇU']
      .forEach(text=>row.append(element(doc,'td',text)));
    attempts.body.append(row);
  }
  if(!exam.scored.length){const row=element(doc,'tr'),cell=element(doc,'td','Aucune tentative enregistrée pour cette version.');cell.colSpan=5;row.append(cell);attempts.body.append(row);}
  history.append(attempts.wrap);panel.append(history);
  renderCourseProgress(panel,courses);
}

export function createPersonalProgressPanel(panel,dependencies={}) {
  const doc=panel.ownerDocument||document;
  const connect=dependencies.connect||connectCloud,authorize=dependencies.authorize||getAccess;
  const banks=dependencies.banks||loadProgressBanks,read=dependencies.read||readOwnProgress;
  const gradeExam=dependencies.gradeExam||((...args)=>window.gradeExam(...args));
  const gradeQuestion=dependencies.gradeQuestion||((...args)=>window.gradeQuestion(...args));
  const onDenied=dependencies.onDenied||(uid=>window.dispatchEvent(new CustomEvent('ceproc:access-denied',{detail:{uid}})));
  let identity={user:null,access:null},epoch=0,destroyed=false;
  panel.classList.add('personal-progress');panel.setAttribute('aria-labelledby','personalProgressTitle');

  function message(text,retry=false) {
    const heading=element(doc,'h2','Ma progression');heading.id='personalProgressTitle';heading.tabIndex=-1;
    const status=element(doc,'p',text,'pp-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    panel.replaceChildren(heading,status);
    if(retry){const button=element(doc,'button','Réessayer');button.type='button';button.addEventListener('click',()=>void refresh(true));panel.append(button);}
    panel.hidden=false;
  }
  const valid=()=>identity.user?.uid&&identity.user.emailVerified&&identity.access?.active===true;
  const current=(ticket,uid)=>!destroyed&&ticket===epoch&&identity.user?.uid===uid&&valid();

  async function refresh(focus=false) {
    const ticket=++epoch,actor=identity.user;
    if(!valid()){message('Connecte-toi à ton espace pour retrouver ta progression personnelle.');return;}
    const uid=actor.uid;message('Chargement de ta progression…');
    try {
      const permission=await authorize(actor);
      if(!current(ticket,uid))return;
      if(!permission?.active)throw denied();
      const connection=await connect();
      if(!current(ticket,uid))return;
      if(connection.auth?.currentUser?.uid!==uid)throw denied();
      const publicBanks=await banks();
      if(!current(ticket,uid))return;
      if(connection.auth?.currentUser?.uid!==uid)throw denied();
      const data=await read(connection,actor);
      if(!current(ticket,uid))return;
      if(connection.auth?.currentUser?.uid!==uid)throw denied();
      renderPersonal(panel,publicBanks,data,gradeExam,gradeQuestion,refresh);
      panel.hidden=false;
      if(focus)doc.getElementById('personalProgressTitle')?.focus({preventScroll:true});
    } catch(error) {
      if(!current(ticket,uid))return;
      message(isPermissionDenied(error)?'Ton accès aux données a été refusé. Vérifie ton autorisation auprès de l’administrateur.':'Ta progression ne peut pas être chargée pour le moment. Réessaie quand la connexion est disponible.',!isPermissionDenied(error));
      if(isPermissionDenied(error))onDenied(uid);
    }
  }

  function setIdentity(next) {
    ++epoch;identity={user:next?.user||null,access:next?.access||null};
    message(valid()?'Chargement de ta progression…':'Connecte-toi à ton espace pour retrouver ta progression personnelle.');
    return valid()?refresh():Promise.resolve();
  }
  function show() {
    panel.hidden=false;
    const heading=doc.getElementById('personalProgressTitle');heading?.focus({preventScroll:true});
    panel.scrollIntoView({block:'start',behavior:'auto'});
  }
  function destroy(){destroyed=true;++epoch;identity={user:null,access:null};panel.replaceChildren();panel.hidden=true;}
  return {refresh,setIdentity,show,destroy};
}

if(typeof document!=='undefined'&&typeof window!=='undefined') {
  const panel=document.getElementById('personalProgressPanel');
  if(panel) {
    const controller=createPersonalProgressPanel(panel);
    const identity=()=>window.CeprocAccount?.getIdentity?.()||{user:null,access:null};
    window.addEventListener('ceproc:identity',event=>void controller.setIdentity(event.detail));
    for(const name of ['ceproc:exam-synced','ceproc:course-synced'])window.addEventListener(name,event=>{
      if(event.detail?.uid===identity().user?.uid)void controller.refresh();
    });
    window.addEventListener('ceproc:show-personal-progress',()=>controller.show());
    window.addEventListener('online',()=>void controller.refresh());
    void controller.setIdentity(identity());
  }
}
