// All marks are recomputed from answers and the matching published bank.
// No mark sent by a pupil is used by this dashboard.
export function scoreAttempts(bank, attempts, gradeExam) {
  const exams=new Map(bank.exams.map(e=>[String(e.id),e]));
  return attempts.flatMap(a=>{
    const ex=exams.get(String(a.examId));
    if(!ex || a.bankVersion!==bank.bankVersion || !a.answers || typeof a.answers!=='object' || Array.isArray(a.answers)) return [];
    const grade=gradeExam({...ex,threshold:bank.threshold},a.answers);
    const when=a.createdAt?.toMillis?.() || a.submittedAt?.toMillis?.() || a.completedAt || 0;
    return [{...a,exam:ex,grade,when:typeof when==='number'?when:0}];
  }).sort((a,b)=>a.when-b.when);
}
export function summarizeStudent(bank, profile, attempts, gradeExam) {
  const scored=scoreAttempts(bank,attempts,gradeExam), first=new Map(),last=new Map(),best=new Map();
  for(const a of scored){
    const id=String(a.examId);
    if(!first.has(id))first.set(id,a);
    last.set(id,a);
    if(!best.has(id)||best.get(id).grade.rawScore<a.grade.rawScore)best.set(id,a);
  }
  const mean=rows=>rows.length?rows.reduce((n,a)=>n+a.grade.rawScore,0)/rows.length:null;
  const latest=[...last.values()],bestRows=[...best.values()];
  const comparable=[...last.keys()].filter(id=>first.get(id)!==last.get(id));
  const improvement=comparable.length?comparable.reduce((n,id)=>n+last.get(id).grade.rawScore-first.get(id).grade.rawScore,0)/comparable.length:null;
  const domains=new Map();
  for(const a of latest)for(let i=0;i<a.exam.questions.length;i++){
    const q=a.exam.questions[i],key=q.domain||q.topic||'Autres compétences';
    const d=domains.get(key)||{label:key,score:0,max:0,questions:0};
    d.score+=a.grade.details[i].score;d.max+=q.points;d.questions++;domains.set(key,d);
  }
  return {...profile,scored,first,last,best,completed:last.size,attemptCount:scored.length,
    firstAverage:mean([...first.values()]),average:mean(latest),bestAverage:mean(bestRows),improvement,
    passed:latest.filter(a=>a.grade.passed).length,lastWhen:scored.at(-1)?.when||0,
    domains:[...domains.values()].map(d=>({...d,percent:100*d.score/d.max})).sort((a,b)=>a.percent-b.percent)};
}
export function schoolStats(students) {
  const latest=students.flatMap(s=>[...s.last.values()]);
  return {students:students.length,active:students.filter(s=>s.attemptCount>0).length,
    attempts:students.reduce((n,s)=>n+s.attemptCount,0),completed:latest.length,
    passRate:latest.length?100*latest.filter(a=>a.grade.passed).length/latest.length:null,
    average:latest.length?latest.reduce((n,a)=>n+a.grade.rawScore,0)/latest.length:null};
}
export function csvCell(value){
  let text=String(value??'');
  if(/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
