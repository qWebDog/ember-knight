/* Shared starter silhouettes and independent clothing colors. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberLoadouts=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const colors=[
    {id:'sand',name:'Песочный',swatch:'#c3a574'},
    {id:'forest',name:'Лесной',swatch:'#557b48'},
    {id:'blue',name:'Синий',swatch:'#526eaa'},
    {id:'red',name:'Бордовый',swatch:'#98525a'},
    {id:'purple',name:'Фиолетовый',swatch:'#946ab4'},
    {id:'gray',name:'Серый',swatch:'#8b8d96'}
  ];
  const weapons=[
    {id:'sword',name:'Меч и щит',short:'Меч и щит',icon:'shield',description:'Надёжное начало для ближнего боя.',projectile:'melee',defaultColor:'sand',walk:{tile:64,origin:0,frames:9},attack:{tile:128,origin:32,frames:6},outfits:[{id:'militia',name:'Ополченец',description:'Льняная рубаха, простые штаны и кожаные сапоги.'}]},
    {id:'bow',name:'Лук',short:'Лук',icon:'bow',description:'Держи врага на расстоянии.',projectile:'arrow',defaultColor:'forest',walk:{tile:128,origin:32,frames:9},attack:{tile:64,origin:0,frames:13},outfits:[{id:'wanderer',name:'Странник',description:'Дорожный плащ с капюшоном, лёгкая рубаха и сапоги.'}]},
    {id:'wand',name:'Волшебная палочка',short:'Палочка',icon:'magic',description:'Первый шаг к тайнам магии.',projectile:'magic',defaultColor:'purple',walk:{tile:64,origin:0,frames:9},attack:{tile:64,origin:0,frames:6},outfits:[{id:'acolyte',name:'Послушник',description:'Капюшон, длинное одеяние и пояс.'}]}
  ];
  const legacy={sword:{militia:'sand',watchman:'blue',guard:'red'},bow:{scout:'forest',hunter:'sand',ranger:'forest'},wand:{apprentice:'blue',acolyte:'purple',adept:'blue'}};
  function weapon(id){return weapons.find(item=>item.id===id)||null;}
  function color(id){return colors.find(item=>item.id===id)||null;}
  function outfit(weaponId,id){const item=weapon(weaponId);return item&&(item.outfits[0].id===id||Object.prototype.hasOwnProperty.call(legacy[weaponId],id))?item.outfits[0]:null;}
  function selection(saved){
    const item=weapon(saved?.weapon),base=item&&outfit(item.id,saved.outfit);
    if(!base)return null;
    return {weapon:item.id,outfit:base.id,outfitColor:color(saved.outfitColor)?.id||legacy[item.id][saved.outfit]||item.defaultColor};
  }
  function path(choice,skin,animation='walk'){
    const normalized=selection(choice);
    if(!normalized||!['light','amber','olive','bronze','brown','black'].includes(skin)||!['walk','attack','preview'].includes(animation))throw new Error('Invalid starter appearance');
    return `assets/characters/loadouts/${normalized.weapon}/${normalized.outfit}/${normalized.outfitColor}/${skin}-${animation}.png`;
  }
  return {weapons,colors,weapon,outfit,color,selection,path};
});
