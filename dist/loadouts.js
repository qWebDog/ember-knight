/* Starter equipment appearance catalogue, shared by creation and battle screens. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberLoadouts=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const weapons = [
    {id:'sword',name:'Меч и щит',short:'Меч и щит',icon:'shield',description:'Надёжное начало для ближнего боя.',projectile:'melee',walk:{tile:64,origin:0,frames:9},attack:{tile:128,origin:32,frames:6},outfits:[
      {id:'militia',name:'Ополченец',description:'Льняная рубаха, простые штаны и кожаные сапоги.',accent:'#c1a475'},
      {id:'watchman',name:'Дозорный',description:'Сине-серый комплект, кольчуга и стальной шлем.',accent:'#839baf'},
      {id:'guard',name:'Страж',description:'Красная накидка и лёгкая защита поверх дорожной одежды.',accent:'#ba7668'}]},
    {id:'bow',name:'Лук',short:'Лук',icon:'bow',description:'Держи врага на расстоянии.',projectile:'arrow',walk:{tile:128,origin:32,frames:9},attack:{tile:64,origin:0,frames:13},outfits:[
      {id:'scout',name:'Разведчик',description:'Зелёный капюшон, лёгкая рубаха и коричневые штаны.',accent:'#90a67a'},
      {id:'hunter',name:'Охотник',description:'Кожаный жилет, серые штаны и походные сапоги.',accent:'#b1946b'},
      {id:'ranger',name:'Следопыт',description:'Лесной плащ поверх тёмной одежды для дальних дорог.',accent:'#749789'}]},
    {id:'wand',name:'Волшебная палочка',short:'Палочка',icon:'magic',description:'Первый шаг к тайнам магии.',projectile:'magic',walk:{tile:64,origin:0,frames:9},attack:{tile:64,origin:0,frames:6},outfits:[
      {id:'apprentice',name:'Ученик',description:'Светлая рубаха, синий жилет и простые тёмные штаны.',accent:'#9ab2c7'},
      {id:'acolyte',name:'Послушник',description:'Фиолетовый капюшон, длинное одеяние и пояс.',accent:'#a68abe'},
      {id:'adept',name:'Чародей',description:'Тёмно-синий комплект и островерхая шляпа с золотой отделкой.',accent:'#b1a274'}]}
  ];
  function weapon(id){return weapons.find(item=>item.id===id)||null;}
  function outfit(weaponId,id){return weapon(weaponId)?.outfits.find(item=>item.id===id)||null;}
  function selection(saved){return weapon(saved?.weapon)&&outfit(saved.weapon,saved.outfit)?{weapon:saved.weapon,outfit:saved.outfit}:null;}
  function path(choice,skin,animation='walk'){
    if(!selection(choice)||!['light','amber','olive','bronze','brown','black'].includes(skin)||!['walk','attack','preview'].includes(animation))throw new Error('Invalid starter appearance');
    return `assets/characters/loadouts/${choice.weapon}/${choice.outfit}/${skin}-${animation}.png`;
  }
  return {weapons,weapon,outfit,selection,path};
});
