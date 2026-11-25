/* Mage talent loadout. The store owns unlocks and persistence; the engine owns active wave effects. */
(function(root){'use strict';function mount({root:panel,store,battle}){
 const $=id=>panel.querySelector('#'+id),catalog=root.EmberProgression.talentCatalog;
 let selected=null,message='',confirmReset=false;
 function open(){selected=null;message='';confirmReset=false;render();}
 function render(){
 const data=store.getTalents(),state=store.getState(),active=battle.getState().activeTalents||[],item=catalog.find(t=>t.id===selected),learned=data.learned.includes(selected),equipped=data.equipped.includes(selected);
 $('talent-points').textContent='Ур. '+data.level+' · '+data.points+' очк. · '+data.xpToNext+' XP до уровня';
 $('talent-slots').innerHTML=[0,1,2].map(i=>{const t=catalog.find(t=>t.id===data.equipped[i]);return '<button type="button" data-slot="'+i+'" class="'+(t?'filled':'')+'" data-talent="'+(t?.id||'')+'">'+(t?'<svg><use href="#'+t.icon+'"/></svg><span>'+t.name+'</span>':'<span>+</span><small>Свободно</small>')+'</button>'}).join('');
 for(const button of $('talent-slots').querySelectorAll('button'))button.onclick=()=>{const id=data.equipped[Number(button.dataset.slot)];if(id){selected=id;message='';confirmReset=false;render();}};
 $('talent-pending').textContent=JSON.stringify(active)===JSON.stringify(data.equipped)?'В бою: '+active.length+' / 3':'Изменения вступят в силу со следующей волны.';
 $('talent-grid').innerHTML=['Ур.','Стихии','Аркана','Мастерство'].map(t=>'<small class="talent-column">'+t+'</small>').join('')+[0,1,2,3,4].map(i=>'<small>'+((i+1)*5)+'</small>'+catalog.slice(i*3,i*3+3).map(t=>'<button type="button" data-id="'+t.id+'" class="'+(data.equipped.includes(t.id)?'equipped ':'')+(data.learned.includes(t.id)?'learned ':'')+(data.level<t.level?'locked ':'')+(t.id===selected?'selected':'')+'" aria-pressed="'+(t.id===selected)+'"><svg><use href="#'+t.icon+'"/></svg><span>'+t.name+'</span><small>'+(data.equipped.includes(t.id)?'Выбран':data.learned.includes(t.id)?'Изучен':data.level<t.level?'Закрыто':'1 очко')+'</small></button>').join('')).join('');
 for(const button of $('talent-grid').querySelectorAll('button'))button.onclick=()=>{selected=button.dataset.id;message='';confirmReset=false;render();};
 $('talent-name').textContent=item?.name||'';$('talent-description').textContent=item?.description||'';
 $('talent-name').hidden=!item;$('talent-description').hidden=!item;
 const req=item?store.catalog.find(t=>t.id===item.requires):null;
 $('talent-warning').textContent=message||(req&&!(state.mageLevels?.[req.id]>0)?'Не действует без навыка «'+req.name+'».':'');
 $('talent-warning').hidden=!$('talent-warning').textContent;
 const action=$('talent-action');action.textContent=equipped?'Снять':learned?'Активировать':'Изучить · 1 очко';
 action.hidden=!item;action.disabled=!item||(learned?!equipped&&data.equipped.length>=3:data.level<item.level||data.points<1);
 $('talent-reset').disabled=!data.learned.length||state.gold<data.resetCost;$('talent-reset').textContent=confirmReset?'Подтвердить сброс':'Сброс · '+data.resetCost+' зол.';
 }
 $('talent-action').onclick=()=>{if(!selected)return;const data=store.getTalents(),r=store.changeTalent(data.learned.includes(selected)?'toggle':'learn',selected);message=r.ok?'': 'Не удалось сохранить изменение.';confirmReset=false;render();};
 $('talent-reset').onclick=()=>{if(!confirmReset){confirmReset=true;render();return;}const r=store.changeTalent('reset');confirmReset=false;message=r.ok?'Таланты сброшены.':'Не удалось сбросить таланты.';render();};
 store.subscribe(render);render();return {render,open};
 }root.EmberTalentPanel={mount};})(window);
