/* A view of the shared progression store. Currency is owned by EmberProgression. */
(function (root, factory) {
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.EmberSkillPanel=api;
})(typeof window!=='undefined'?window:null,function () {
  'use strict';
  const details={
    power:{name:'Сила удара',branch:'attack',category:'Атака',icon:'swords',benefit:'+2 к урону',total:level=>`+${level*2} к урону`},
    vitality:{name:'Стойкость',branch:'defense',category:'Защита',icon:'skill-shield',benefit:'+20 к максимуму здоровья',total:level=>`+${level*20} к максимуму здоровья`},
    tempo:{name:'Натиск',branch:'control',category:'Ярость',icon:'bolt',benefit:'+5% к скорости атаки',total:level=>`+${level*5}% к скорости атаки`},
    shieldBash:{name:'Удар щитом',branch:'defense',category:'Защита',icon:'skill-shield',benefit:'Каждый третий блок: удар щитом и оглушение',total:level=>`${50+10*level}% базового урона, оглушение ${(0.4+.2*level).toFixed(1).replace('.',',')} с`}
  };
  Object.assign(details,{
    frenzy:{name:'Неистовство',branch:'control',category:'Ярость',icon:'warrior-frenzy',total:l=>`При HP ниже 50%: +${5+5*l}% скорости атаки и +${5*l}% урона.`},
    bloodlust:{name:'Жажда крови',branch:'control',category:'Ярость',icon:'warrior-bloodlust',total:l=>`+${1+l}% урона мечом за заряд (до +${5*(1+l)}%). Урон без блока: −1. Контратака и удар щитом: +1. Между волнами заряды сохраняются.`},
    strongShield:{name:'Крепкий щит',branch:'defense',category:'Защита',icon:'warrior-strong-shield',total:l=>`Блок поглощает ${50+5*l}% урона ближнего боя`},
    bastion:{name:'Оплот',branch:'defense',category:'Защита',icon:'warrior-bastion',total:l=>`Каждое второе попадание стрелой или магией: блок ${10+10*l}% урона`},
    swordThrust:{name:'Колющий удар',branch:'attack',category:'Атака',icon:'swords',total:l=>`150% урона, пробитие ${10+10*l}% брони`},
    swordOverhead:{name:'Удар сверху',branch:'attack',category:'Атака',icon:'swords',total:l=>`${150+10*l}% базового урона`},
    swordDouble:{name:'Двойной удар',branch:'attack',category:'Атака',icon:'swords',total:l=>`Два удара: 90% и ${30+10*l}% урона`},
    swordCleave:{name:'Круговое рассечение',branch:'attack',category:'Атака',icon:'swords',total:l=>`150% цели, ${10+10*l}% базового урона соседям`},
    swordMaster:{name:'Мастер меча',branch:'attack',category:'Атака',icon:'swords',total:l=>`+${20*l}% урона завершающего удара и всех техник меча`}
  });
  const mageDetails={
    sorcery:{name:'Сила стихий',branch:'attack',category:'Стихии',icon:'mage-elements',benefit:'+2 к урону заклинаний',total:level=>`+${level*2} к урону заклинаний`},
    barrier:{name:'Магический барьер',branch:'defense',category:'Аркана',icon:'skill-shield',benefit:'+20 к максимуму здоровья',total:level=>`+${level*20} к максимуму здоровья`},
    channel:{name:'Поток маны',branch:'control',category:'Мастерство',icon:'mage-mana',benefit:'+5% к скорости заклинаний',total:level=>`+${level*5}% к скорости заклинаний`}
  };
  Object.assign(mageDetails,{
    strongBurn:{name:'Сильный ожог',branch:'attack',category:'Стихии',icon:'flame',benefit:'+0,25 с горения и +1 урона за тик',total:level=>`+${level*.25} с, +${level} урона за тик`,requires:'Сила стихий'},
    protectiveSphere:{name:'Защитная сфера',branch:'defense',category:'Аркана',icon:'mage-sphere',benefit:'20 прочности на I уровне, затем +10',total:level=>`${10+level*10} прочности`,requires:'Магический барьер'},
    iceShards:{name:'Ледяные осколки',branch:'attack',category:'Стихии',icon:'mage-ice',benefit:'+3 урона дополнительного залпа',total:level=>`${level*3} урона залпа`,requires:'Сила стихий'}
  });
  Object.assign(mageDetails,{
    fusion:{name:"Слияние стихий",branch:'attack',category:'Стихии',icon:'mage-fusion',benefit:"+4 урона реакции",total:level=>level*4+' урона реакции',requires:"Сильный ожог III + Ледяные осколки"},
    chaos:{name:"Стихийный хаос",branch:'attack',category:'Стихии',icon:'mage-chaos',benefit:"+5 урона всем врагам при каждой 3-й реакции",total:level=>level*5+' урона хаоса',requires:"Слияние стихий"},
    absorption:{name:"Поглощение",branch:'defense',category:'Аркана',icon:'mage-absorb',benefit:"+4 прочности за убийство",total:level=>level*4+' прочности за убийство',requires:"Защитная сфера"},
    rebirth:{name:"Перерождение",branch:'defense',category:'Аркана',icon:'mage-rebirth',benefit:"+10% здоровья при спасении, раз за бой",total:level=>level*10+'% здоровья, раз за бой',requires:"Поглощение"},
    echo:{name:"Эхо заклинаний",branch:'control',category:'Мастерство',icon:'mage-echo',benefit:"+1 резонанс за каст (10 = эхо, 50% урона)",total:level=>level*10+'% частоты эха',requires:"Поток маны"},
    overload:{name:"Перегрузка",branch:'control',category:'Мастерство',icon:'mage-overload',benefit:"+8% частоты усиленного удара (+50% урона)",total:level=>level*8+'% частоты перегрузки',requires:"Эхо заклинаний"},
    archmage:{name:"Архимаг",branch:'control',category:'Мастерство',icon:'mage-archmage',benefit:"+5% ускорения 3 кастов после каждых 6",total:level=>(10+level*5)+'% сокращения интервала',requires:"Перегрузка"}
  });
  const archerDetails={marksmanship:{name:"Меткий выстрел",branch:'attack',category:"Стрелы",icon:'skill-bow',benefit:"+2 к урону стрел",total:level=>`+${2*level} к урону стрел`},
wolfBond:{name:"Связь со зверем",branch:'defense',category:"Звери",icon:'skill-shield',benefit:"+15% здоровья и +10% урона волка",total:level=>`+${15*level}% здоровья, +${10*level}% урона волка`},
quickdraw:{name:"Быстрый выстрел",branch:'control',category:"Тактика",icon:'bolt',benefit:"+5% к скорости стрельбы",total:level=>`+${5*level}% к скорости стрельбы`},
piercing:{name:"Пробивная стрела",branch:'attack',category:"Стрелы",icon:'skill-bow',benefit:"20–60% пробития брони, до 3 целей",total:level=>`${10+10*level}% пробития брони, до 3 целей; готова через ${12-2*level} атак`},
poison:{name:"Ядовитая стрела",branch:'attack',category:"Стрелы",icon:'mage-absorb',benefit:"10–30% урона в секунду, 5 с, до 3 эффектов",total:level=>`${5+5*level}% урона/с, 5 с, до 3 эффектов; готова через ${12-2*level} атак`},
explosive:{name:"Взрывная стрела",branch:'attack',category:"Стрелы",icon:'flame',benefit:"40–80% урона ближайшим врагам",total:level=>`${30+10*level}% урона соседям; готова через ${12-2*level} атак`},
barbed:{name:"Зазубренная стрела",branch:'attack',category:"Стрелы",icon:'swords',benefit:"0,5–1,5% здоровья цели в секунду, 4 с",total:level=>`${((level+1)*.25).toFixed(2).replace(/0$/,'').replace('.',',')}% макс. HP/с, 4 с; готова через ${12-2*level} атак`},
doubleShot:{name:"Двойной выстрел",branch:'attack',category:"Стрелы",icon:'mage-echo',benefit:"Вторая стрела: 60% урона, каждая 12–4-я атака",total:level=>`Вторая стрела: 60% базового урона, каждая ${14-2*level}-я атака`},
arrowRain:{name:"Град стрел",branch:'attack',category:"Стрелы",icon:'mage-chaos',benefit:"5–9 стрел, восстановление 30–18 с",total:level=>`${4+level} стрел, восстановление ${33-3*level} с`},
rendingBite:{name:"Раздирающий укус",branch:'defense',category:"Звери",icon:'swords',benefit:"Каждый третий укус: кровотечение 4 с",total:level=>`Каждый 3-й укус: ${20+10*level}% урона/с, 4 с`},
guardian:{name:"Звериная ярость",branch:'defense',category:"Звери",icon:'flame',benefit:"При здоровье ниже 50% ускоряет укусы",total:level=>`+${15*level}% к скорости укусов при HP ниже 50%`},
alpha:{name:"Альфа-хищник",branch:'defense',category:"Звери",icon:'mage-overload',benefit:"Рык ослабляет врагов, ускоряет укусы; волк возвращается после гибели",total:level=>`Рык 5 с: −${5*level}% урона врагов, +${10*level}% скорости укусов; возврат ${24-2*level} с`},
evasion:{name:"Уклонение",branch:'control',category:"Тактика",icon:'mage-echo',benefit:"5–25% уклонения от прямых атак",total:level=>`${5*level}% прямых атак без урона`},
retreat:{name:"Отступающий выстрел",branch:'control',category:"Тактика",icon:'skill-bow',benefit:"Отступление и выстрел при сближении, 12–4 с",total:level=>`Отступление с выстрелом, восстановление ${14-2*level} с`},
arrowDance:{name:"Танец стрел",branch:'control',category:"Тактика",icon:'mage-chaos',benefit:"На 5 с ускоряет стрельбу, уклонение и восстановление отступления",total:level=>`5 с: +${5*level}% скорости стрельбы, +10 п.п. уклонения, −50% восстановления отступления`}};
  const archerPaths={attack:['piercing','poison','explosive','barbed','doubleShot','arrowRain'],defense:['rendingBite','guardian','alpha'],control:['evasion','retreat','arrowDance']};
  const magePaths={attack:['strongBurn','iceShards','fusion','chaos'],defense:['protectiveSphere','absorption','rebirth'],control:['echo','overload','archmage']};
  function mount({root,store,heroLevel=1,classId=store?.classId||'sword'}={}) {
    if(!root||!store||typeof store.getState!=='function'||typeof store.purchase!=='function')throw new TypeError('A skill panel root and progression store are required.');
    const $=selector=>root.querySelector(selector);
    const mage=classId==='wand', archer=classId==='bow';
    const activeDetails=mage?mageDetails:archer?archerDetails:details;
    const catalogById=Object.fromEntries(store.catalog.map(item=>[item.id,item]));
    const requirements=id=>[].concat(catalogById[id]?.requires||[]);
    const requirementLabel=id=>catalogById[id]?.requiredCount===2?(id==='swordMaster'?'Любые две техники меча III уровня':'Любые две стрелы III уровня'):requirements(id).map(key=>`${activeDetails[key].name} ${catalogById[id]?.requiredRank===5?'V':'III'}`).join(' + ');
    const depth=id=>requirements(id).length?1+Math.max(...requirements(id).map(depth)):0;
    const labels={sword:'ВОИН',bow:'ЛУЧНИК',wand:'МАГ'};
    root.dataset.heroClass=classId;
    root.setAttribute('aria-label',`Древо навыков: ${labels[classId]||labels.sword}`);
    $('.skills-title p').textContent=labels[classId]||labels.sword;
    const nodes=Array.from(root.querySelectorAll('[data-skill-id]'));
    const activeIds=Object.keys(activeDetails);
    // Each branch retains its existing HTML layout, but the actual ability,
    // icon and future path are determined by the permanently chosen class.
    if(mage||archer)for(const branch of root.querySelectorAll('.skill-branch')){
      const index=['attack','defense','control'].indexOf(branch.dataset.branch);
      if(index<0)continue;
      const node=branch.querySelector('[data-skill-id]');
      if(archer)branch.querySelector('h3').textContent={attack:'Стрелы',defense:'Звери',control:'Тактика'}[branch.dataset.branch];
      if(mage)branch.querySelector('h3').textContent={
        attack:'Стихии',defense:'Аркана',control:'Мастерство'
      }[branch.dataset.branch];
      node.dataset.skillId=activeIds[index];
      node.dataset.skillDepth='0';
      node.querySelector('use').setAttribute('href',`#${activeDetails[activeIds[index]].icon}`);
      if(mage||archer){
        const slots=[...branch.querySelectorAll('[data-skill-future]'),...branch.querySelectorAll('[data-mage-slot]'),...(archer?branch.querySelectorAll('[data-archer-slot]'):[])];
        slots.forEach((future,i)=>{
          const id=(mage?magePaths:archerPaths)[branch.dataset.branch][i];if(!id)return;
          future.hidden=false;future.disabled=false;future.dataset.skillId=id;future.dataset.mageAdvanced='true';future.dataset.skillDepth=String(depth(id));future.dataset.skillRequires=requirements(id).join(' ');if(catalogById[id]?.requiredCount)future.dataset.skillRequiredCount=String(catalogById[id].requiredCount);if(archer&&branch.dataset.branch==='attack')future.dataset.arrowSlot=String(i+1);
          future.querySelector('use').setAttribute('href',`#${activeDetails[id].icon}`);
          future.querySelector('span').setAttribute('data-skill-node-rank','');
          future.setAttribute('title',activeDetails[id].name);nodes.push(future);
        });
      }
    }
    if(!mage&&!archer){
      const attack=Array.from(root.querySelectorAll('.skill-branch')).find(branch=>branch.dataset.branch==='attack');
      if(attack){
        const slots=[...attack.querySelectorAll('[data-skill-future]'),...attack.querySelectorAll('[data-mage-slot]'),...attack.querySelectorAll('[data-archer-slot]')];
        ['swordThrust','swordOverhead','swordDouble','swordCleave','swordMaster'].forEach((id,i)=>{
          const node=slots[i];if(!node)return;
          node.hidden=false;node.disabled=false;node.removeAttribute?.('hidden');node.removeAttribute?.('disabled');node.dataset.skillId=id;node.dataset.mageAdvanced='true';node.dataset.skillDepth=String(depth(id));node.dataset.skillRequires=requirements(id).join(' ');node.dataset.swordSlot=String(i+1);if(catalogById[id]?.requiredCount)node.dataset.skillRequiredCount=String(catalogById[id].requiredCount);
          node.querySelector('use').setAttribute('href','#swords');node.querySelector('span').setAttribute('data-skill-node-rank','');node.setAttribute('title',details[id].name);nodes.push(node);
        });
      }
      const defense=Array.from(root.querySelectorAll('.skill-branch')).find(branch=>branch.dataset.branch==='defense');
      const defenseSlots=defense?[...defense.querySelectorAll('[data-skill-future]'),...defense.querySelectorAll('[data-mage-slot]')]:[];
      ['shieldBash','strongShield','bastion'].forEach((id,i)=>{
        const node=defenseSlots[i];if(!node)return;
        node.hidden=false;node.disabled=false;node.removeAttribute?.('hidden');node.removeAttribute?.('disabled');
        node.dataset.skillId=id;node.dataset.mageAdvanced='true';node.dataset.skillDepth=String(depth(id));node.dataset.skillRequires=requirements(id).join(' ');node.dataset.defenseSlot=String(i+1);
        node.querySelector('use').setAttribute('href','#'+details[id].icon);node.querySelector('span').setAttribute('data-skill-node-rank','');node.setAttribute('title',details[id].name);nodes.push(node);
      });
      const rage=root.querySelector('[data-branch="control"]');
      if(rage){
        rage.querySelector('h3').textContent='Ярость';
        ['bloodlust','frenzy'].forEach((id,i)=>{
          const slot=rage.querySelector('[data-skill-future="control-'+(i+1)+'"]');if(!slot)return;
          slot.hidden=false;slot.disabled=false;slot.dataset.skillId=id;slot.dataset.mageAdvanced='true';slot.dataset.skillDepth=String(depth(id));slot.dataset.skillRequires=requirements(id).join(' ');slot.dataset.rageSlot=String(i+1);slot.querySelector('use').setAttribute('href','#'+details[id].icon);slot.querySelector('span').setAttribute('data-skill-node-rank','');slot.setAttribute('title',details[id].name);nodes.push(slot);
        });
      }
    }
    const upgrade=$('#skill-upgrade');
    let selected=null,destroyed=false;
    const removers=[];
    function render() {
      if(destroyed)return;
      const state=store.getState(),entry=selected?activeDetails[selected]:null;
      $('[data-skill-gold]').textContent=String(state.gold);
      $('[data-skill-hero-level]').textContent=String(mage&&store.getTalents?store.getTalents().level:Number.isInteger(heroLevel)&&heroLevel>0?heroLevel:1);
      root.dataset.selected=selected||'';root.dataset.ready='true';
      for(const node of nodes){
        const id=node.dataset.skillId,item=activeDetails[id];if(!item)continue;
        const rank=store.quote(id),active=id===selected;
        node.classList.toggle('is-selected',active);
        node.classList.toggle('is-learned',rank.level>0);
        node.classList.toggle('is-max',rank.level===rank.maxLevel);
        node.classList.toggle('is-locked',rank.reason==='locked');
        node.setAttribute('aria-pressed',String(active));
        node.setAttribute('aria-label',`${item.name}, уровень ${rank.level} из ${rank.maxLevel}${rank.reason==='locked'?', требуется '+requirementLabel(id):''}`);
        node.dataset.level=String(rank.level);
        node.querySelector('[data-skill-node-rank]').textContent=`${rank.level}/${rank.maxLevel}`;
      }
      $('#skill-detail').hidden=!entry;
      if(!entry){upgrade.disabled=true;upgrade.dataset.upgrade='';return;}
      const quote=store.quote(selected);
      $('#skill-detail').dataset.branch=entry.branch;
      $('[data-skill-category]').textContent=entry.category;
      $('[data-skill-name]').textContent=entry.name;
      $('[data-skill-rank]').textContent=`Уровень ${quote.level}/${quote.maxLevel}`;
      $('[data-skill-benefit]').textContent=quote.reason==='locked'?`Требуется: ${requirementLabel(selected)}`:quote.reason==='max'?`${entry.total(quote.level)} · Максимум`:`Следующий уровень: ${archer||['shieldBash','strongShield','bastion','bloodlust','frenzy'].includes(selected)||selected.startsWith('sword')?entry.total(quote.level+1):entry.benefit}`;
      $('[data-skill-benefit]').dataset.feedback='';
      $('[data-skill-icon-use]').setAttribute('href',`#${entry.icon}`);
      upgrade.dataset.upgrade=selected;upgrade.disabled=!quote.canBuy;
      upgrade.dataset.state=quote.canBuy?'available':quote.reason==='max'?'max':quote.reason==='locked'?'locked':'insufficient';
      $('[data-skill-upgrade-label]').textContent=quote.reason==='locked'?'Закрыто':quote.reason==='max'?'Максимум':quote.canBuy?'Улучшить':'Не хватает монет';
      $('[data-skill-price-wrap]').hidden=quote.cost===null;
      $('[data-skill-price]').textContent=quote.cost===null?'':String(quote.cost);
      upgrade.setAttribute('aria-label',quote.reason==='locked'?`Требуется ${requirementLabel(selected)}`:quote.reason==='max'?`${entry.name}: максимальный уровень`:`Улучшить ${entry.name} за ${quote.cost} монет${quote.canBuy?'':', не хватает монет'}`);
    }
    function open(){if(destroyed)return;selected=null;$('[data-skill-message]').textContent='';render();}
    function select(id) {
      if(!Object.prototype.hasOwnProperty.call(activeDetails,id)||destroyed)return false;
      selected=id;render();return true;
    }
    function listen(element,event,handler){element.addEventListener(event,handler);removers.push(()=>element.removeEventListener(event,handler));}
    for(const node of nodes)listen(node,'click',()=>select(node.dataset.skillId));
    listen(upgrade,'click',()=>{
      if(destroyed||!selected)return;
      const result=store.purchase(selected);
      render();
      $('[data-skill-message]').textContent=result.ok?`${activeDetails[selected].name}: уровень ${store.quote(selected).level}. Потрачено ${result.spent} монет.`:result.reason==='storage'?'Не удалось сохранить улучшение. Попробуй ещё раз.':result.reason==='max'?'Навык уже улучшен до максимума.':'Недостаточно монет.';
      if(result.reason==='storage'){
        $('[data-skill-benefit]').textContent='Не удалось сохранить. Попробуй ещё раз.';
        $('[data-skill-benefit]').dataset.feedback='error';
      }
    });
    const unsubscribe=store.subscribe(render);
    render();
    return {render,select,open,destroy(){if(destroyed)return;destroyed=true;for(const remove of removers)remove();if(typeof unsubscribe==='function')unsubscribe();}};
  }
  return Object.freeze({mount});
});
