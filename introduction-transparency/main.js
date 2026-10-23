renderMathInElement(document.body,{delimiters:[{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}],throwOnError:false});
const chart=document.querySelector('#functionPlot');
function drawFunction(){
 const rect=chart.getBoundingClientRect(),dpr=devicePixelRatio||1;chart.width=Math.round(rect.width*dpr);chart.height=Math.round(rect.height*dpr);const c=chart.getContext('2d');c.scale(dpr,dpr);const w=rect.width,h=rect.height;
 const x=v=>22+(v+.55)/4.1*(w-38),y=v=>h-26-(v+1.55)/5.65*(h-45);c.clearRect(0,0,w,h);c.strokeStyle='#527ab6';c.lineWidth=1;c.beginPath();c.moveTo(x(-.5),y(0));c.lineTo(x(3.6),y(0));c.moveTo(x(0),y(-1.5));c.lineTo(x(0),y(4));c.stroke();
 c.font='15px Georgia,serif';c.fillStyle='#2357b2';c.fillText('x',x(3.55),y(0)+18);c.fillText('y',x(0)-18,y(3.9));c.fillText('0',x(0)-13,y(0)+20);for(const n of [1,3])c.fillText(String(n),x(n)-3,y(0)+20);c.fillText('−1',x(0)-27,y(-1)+5);
 c.setLineDash([3,4]);c.beginPath();c.moveTo(x(3),y(0));c.lineTo(x(3),y(3));c.moveTo(x(0),y(-1));c.lineTo(x(1),y(-1));c.stroke();c.setLineDash([]);c.strokeStyle='#125aeb';c.lineWidth=2;c.beginPath();for(let i=0;i<=160;i++){const v=-.48+i*3.58/160;i?c.lineTo(x(v),y(v*v-2*v)):c.moveTo(x(v),y(v*v-2*v))}c.stroke();
 c.fillStyle='#d43932';for(const [a,b]of[[1,-1],[3,3]]){c.beginPath();c.arc(x(a),y(b),4,0,Math.PI*2);c.fill()}c.font='14px Georgia,serif';c.fillText('(1, −1)',x(1)-16,y(-1)+25);c.fillText('3',x(3)+8,y(3)+5);
}
new ResizeObserver(drawFunction).observe(chart);document.fonts.ready.then(drawFunction);
const status=document.querySelector('.live-status'),editor=document.querySelector('#inlineEditor'),field=document.querySelector('#editValue');let editingButton=null;
document.querySelectorAll('[data-edit]').forEach(button=>button.addEventListener('click',()=>{editingButton=button;field.value=button.previousElementSibling.textContent;editor.querySelector('label').textContent='编辑演示题的'+button.parentElement.querySelector('dt').textContent;editor.hidden=false;field.focus();field.select()}));
function closeEditor(){editor.hidden=true;editingButton?.focus()}
document.querySelector('#cancelEdit').addEventListener('click',closeEditor);editor.addEventListener('submit',event=>{event.preventDefault();const value=field.value.trim();if(!value){field.setCustomValidity('请输入内容，或取消编辑。');field.reportValidity();return}editingButton.previousElementSibling.textContent=value;status.textContent='演示内容已更新，刷新后恢复。';closeEditor()});field.addEventListener('input',()=>field.setCustomValidity(''));document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!editor.hidden)closeEditor()});
document.querySelector('#answerToggle').addEventListener('click',event=>{const answer=event.currentTarget.parentElement.querySelector('strong');answer.hidden=!answer.hidden;event.currentTarget.textContent=answer.hidden?'显示':'隐藏';event.currentTarget.setAttribute('aria-expanded',String(!answer.hidden))});

const mathOptions={delimiters:[{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}],throwOnError:false};
const problems=[
 {id:'q1',name:'二次函数的值域',subject:'function',tag:'函数 · 基础',html:'已知函数 \\(f(x)=x^2-2x\\)，求它在区间 \\([0,3]\\) 上的值域。'},
 {id:'q2',name:'等差数列的通项',subject:'sequence',tag:'数列 · 基础',html:'已知等差数列 \\(\\{a_n\\}\\) 的首项为 \\(2\\)，公差为 \\(3\\)。求通项公式 \\(a_n\\) 及前十项和 \\(S_{10}\\)。'},
 {id:'q3',name:'导数与单调性',subject:'function',tag:'函数 · 进阶',html:'已知函数 \\(g(x)=x^3-3x\\)。求 \\(g\'(x)\\)，讨论函数的单调性，并求极值。'}
];
let selection=['q1','q2'],filter='all';
const pool=document.querySelector('#questionPool'),order=document.querySelector('#orderedQuestions'),paper=document.querySelector('#paperQuestions');
function announce(message){status.textContent=message}
function renderCollection(focusAction){
 pool.replaceChildren();order.replaceChildren();paper.replaceChildren();
 problems.filter(p=>filter==='all'||p.subject===filter).forEach(problem=>{
  const article=document.createElement('article');article.className='library-question';
  const tag=document.createElement('p');tag.className='question-tag';tag.textContent=problem.tag;
  const stem=document.createElement('div');stem.className='question-stem';stem.innerHTML=problem.html;
  const button=document.createElement('button');button.type='button';const selected=selection.includes(problem.id);button.textContent=selected?'已加入':'加入练习';button.setAttribute('aria-label',(selected?'移出':'加入')+problem.name);button.setAttribute('aria-pressed',String(selected));button.dataset.problem=problem.id;
  button.addEventListener('click',()=>{selection=selected?selection.filter(id=>id!==problem.id):[...selection,problem.id];renderCollection({problem:problem.id});announce((selected?'已移出':'已加入')+problem.name+'，练习共有'+selection.length+'道题。')});article.append(tag,stem,button);pool.append(article);
 });
 selection.forEach((id,index)=>{
  const problem=problems.find(p=>p.id===id),row=document.createElement('li'),name=document.createElement('span'),actions=document.createElement('div');name.textContent=problem.name;row.append(name);actions.className='order-actions';
  for(const [action,label,disabled]of[['up','上移',index===0],['down','下移',index===selection.length-1],['remove','移除',false]]){
   const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled;button.setAttribute('aria-label',label+problem.name);button.dataset.action=action;button.dataset.id=id;
   button.addEventListener('click',()=>{if(action==='remove'){selection=selection.filter(value=>value!==id);renderCollection({fallback:true});announce('已移除'+problem.name+'，题库原题仍保留。')}else{const target=index+(action==='up'?-1:1);[selection[index],selection[target]]=[selection[target],selection[index]];renderCollection({id,action});announce(problem.name+'已移至第'+(target+1)+'题。')}});actions.append(button);
  }
  row.append(actions);order.append(row);const item=document.createElement('li');item.innerHTML=problem.html;paper.append(item);
 });
 if(!selection.length){const empty=document.createElement('li');empty.className='empty-order';empty.textContent='题集还是空的。从左侧选一道题，开始编排。';order.append(empty)}
 document.querySelector('#selectedTotal').textContent=String(selection.length);document.querySelector('#paperEmpty').hidden=selection.length>0;renderMathInElement(pool,mathOptions);renderMathInElement(paper,mathOptions);
 if(focusAction){let target;if(focusAction.problem)target=pool.querySelector('[data-problem="'+focusAction.problem+'"]');else if(focusAction.id)target=order.querySelector('[data-id="'+focusAction.id+'"][data-action="'+focusAction.action+'"]');if(!target||target.disabled)target=order.querySelector('button:not(:disabled)')||pool.querySelector('button');target?.focus({preventScroll:true})}
}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderCollection();announce('已显示'+button.textContent+'题目，已选题目保留。')}));
document.querySelector('#paperTitle').addEventListener('input',event=>{document.querySelector('#paperHeading').textContent=event.target.value.trim()||'我的数学练习'});
document.querySelector('#answerSpace').addEventListener('change',event=>document.querySelector('.exercise-paper').classList.toggle('compact-paper',!event.target.checked));
document.querySelector('#correctionToggle').addEventListener('click',event=>{const visible=event.currentTarget.getAttribute('aria-pressed')!=='true';event.currentTarget.setAttribute('aria-pressed',String(visible));event.currentTarget.textContent=visible?'隐藏修订标记':'显示修订标记';document.body.classList.toggle('hide-corrections',!visible)});
renderCollection();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
if(!reducedMotion.matches){const hero=document.querySelector('.hero');new IntersectionObserver(entries=>{hero.classList.toggle('hero-aligned',entries[0].intersectionRatio<.65)},{threshold:[.4,.65,.9]}).observe(hero)}
