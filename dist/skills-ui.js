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
    tempo:{name:'Натиск',branch:'control',category:'Контроль',icon:'bolt',benefit:'+5% к скорости атаки',total:level=>`+${level*5}% к скорости атаки`}
  };
  const mageDetails={
    sorcery:{name:'Сила стихий',branch:'attack',category:'Пиромантия',icon:'flame',benefit:'+2 к урону заклинаний',total:level=>`+${level*2} к урону заклинаний`},
    barrier:{name:'Магический барьер',branch:'defense',category:'Аркана',icon:'skill-shield',benefit:'+20 к максимуму здоровья',total:level=>`+${level*20} к максимуму здоровья`},
    channel:{name:'Поток маны',branch:'control',category:'Криомантия',icon:'bolt',benefit:'+5% к скорости заклинаний',total:level=>`+${level*5}% к скорости заклинаний`}
  };
  const archerDetails={
    marksmanship:{name:'Меткий выстрел',branch:'attack',category:'Атака',icon:'skill-bow',benefit:'+2 к урону стрел',total:level=>`+${level*2} к урону стрел`},
    endurance:{name:'Выносливость',branch:'defense',category:'Защита',icon:'skill-shield',benefit:'+20 к максимуму здоровья',total:level=>`+${level*20} к максимуму здоровья`},
    quickdraw:{name:'Быстрая тетива',branch:'control',category:'Контроль',icon:'bolt',benefit:'+5% к скорости стрельбы',total:level=>`+${level*5}% к скорости стрельбы`}
  };
  const futureArcher={
    attack:['Пробивающая стрела','Град стрел'],
    defense:['Уклонение','Ловушка'],
    control:['Замедляющая стрела','Прицельный залп']
  };
  const futureMage={
    attack:['Сильный ожог','Огненный шквал'],
    defense:['Защитная сфера','Эхо заклинаний'],
    control:['Ледяные осколки','Глубокая заморозка']
  };
  function mount({root,store,heroLevel=1,classId=store?.classId||'sword'}={}) {
    if(!root||!store||typeof store.getState!=='function'||typeof store.purchase!=='function')throw new TypeError('A skill panel root and progression store are required.');
    const $=selector=>root.querySelector(selector);
    const mage=classId==='wand', archer=classId==='bow';
    const activeDetails=mage?mageDetails:archer?archerDetails:details;
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
      if(mage)branch.querySelector('h3').textContent={
        attack:'Пиромантия',defense:'Аркана',control:'Криомантия'
      }[branch.dataset.branch];
      node.dataset.skillId=activeIds[index];
      node.querySelector('use').setAttribute('href',`#${activeDetails[activeIds[index]].icon}`);
      branch.querySelectorAll('[data-skill-future]').forEach((future,i)=>{
        const name=(mage?futureMage:futureArcher)[branch.dataset.branch][i];
        future.setAttribute('aria-label',`${name} — скоро`);
        future.setAttribute('title',`${name}: будет доступно позже`);
      });
    }
    const upgrade=$('#skill-upgrade');
    let selected=activeIds[0],destroyed=false;
    const removers=[];
    function render() {
      if(destroyed)return;
      const state=store.getState(),entry=activeDetails[selected],quote=store.quote(selected);
      $('[data-skill-gold]').textContent=String(state.gold);
      $('[data-skill-hero-level]').textContent=String(Number.isInteger(heroLevel)&&heroLevel>0?heroLevel:1);
      root.dataset.selected=selected;root.dataset.ready='true';
      for(const node of nodes){
        const id=node.dataset.skillId,item=activeDetails[id];if(!item)continue;
        const rank=store.quote(id),active=id===selected;
        node.classList.toggle('is-selected',active);
        node.classList.toggle('is-learned',rank.level>0);
        node.classList.toggle('is-max',rank.level===rank.maxLevel);
        node.setAttribute('aria-pressed',String(active));
        node.setAttribute('aria-label',`${item.name}, уровень ${rank.level} из ${rank.maxLevel}`);
        node.dataset.level=String(rank.level);
        node.querySelector('[data-skill-node-rank]').textContent=`${rank.level}/${rank.maxLevel}`;
      }
      $('#skill-detail').dataset.branch=entry.branch;
      $('[data-skill-category]').textContent=entry.category;
      $('[data-skill-name]').textContent=entry.name;
      $('[data-skill-rank]').textContent=`Уровень ${quote.level}/${quote.maxLevel}`;
      $('[data-skill-benefit]').textContent=quote.reason==='max'?`${entry.total(quote.level)} · Максимум`:`Следующий уровень: ${entry.benefit}`;
      $('[data-skill-benefit]').dataset.feedback='';
      $('[data-skill-icon-use]').setAttribute('href',`#${entry.icon}`);
      upgrade.dataset.upgrade=selected;upgrade.disabled=!quote.canBuy;
      upgrade.dataset.state=quote.canBuy?'available':quote.reason==='max'?'max':'insufficient';
      $('[data-skill-upgrade-label]').textContent=quote.reason==='max'?'Максимум':quote.canBuy?'Улучшить':'Не хватает монет';
      $('[data-skill-price-wrap]').hidden=quote.cost===null;
      $('[data-skill-price]').textContent=quote.cost===null?'':String(quote.cost);
      upgrade.setAttribute('aria-label',quote.reason==='max'?`${entry.name}: максимальный уровень`:`Улучшить ${entry.name} за ${quote.cost} монет${quote.canBuy?'':', не хватает монет'}`);
    }
    function select(id) {
      if(!Object.prototype.hasOwnProperty.call(activeDetails,id)||destroyed)return false;
      selected=id;render();return true;
    }
    function listen(element,event,handler){element.addEventListener(event,handler);removers.push(()=>element.removeEventListener(event,handler));}
    for(const node of nodes)listen(node,'click',()=>select(node.dataset.skillId));
    listen(upgrade,'click',()=>{
      if(destroyed)return;
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
    return {render,select,destroy(){if(destroyed)return;destroyed=true;for(const remove of removers)remove();if(typeof unsubscribe==='function')unsubscribe();}};
  }
  return Object.freeze({mount});
});
