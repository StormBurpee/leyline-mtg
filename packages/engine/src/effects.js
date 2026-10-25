import {CARDS} from './cards.js';
import {addObject,battlefield,creatures,definition,draw,emit,hasKeyword,move,opponent,ref,stats} from './model.js';
export function legalTarget(s,kind,target,controller){
 if(!kind)return target==null;
 if(!target)return false;
 if(target.kind==='player')return (target.id===0||target.id===1)&&['any','player','opponent'].includes(kind)&&(kind!=='opponent'||target.id!==controller);
 if(target.kind==='stack'){
  const entry=s.stack.find(e=>e.id===target.id);
  return !!entry&&entry.kind==='spell'&&(kind==='spell'||(kind==='noncreatureSpell'&&CARDS[entry.name].type!=='creature'));
 }
 if(target.kind!=='object')return false;
 const o=s.objects[target.id];if(!o||o.zone!=='battlefield'||o.incarnation!==target.incarnation)return false;
 const d=definition(o);if(d.type!=='creature')return false;
 if(hasKeyword(s,o,'shroud')||(hasKeyword(s,o,'hexproof')&&o.controller!==controller))return false;
 return ['any','creature'].includes(kind)||(kind==='nonblackCreature'&&!d.color.includes('B'));
}
export function targetsFor(s,kind,p){
 if(!kind)return [];
 return [...s.players.map(p=>({kind:'player',id:p.id})),...creatures(s).map(ref),...s.stack.map(e=>({kind:'stack',id:e.id}))].filter(t=>legalTarget(s,kind,t,p));
}
export function queueTrigger(s,source,effects,label){
 s.pendingTriggers.push({id:`s${++s.nextId}`,kind:'ability',name:source.name,source:ref(source),controller:source.controller,effects:structuredClone(effects),label});
 emit(s,'triggered',{objectId:source.id,name:source.name,player:source.controller});
}
export function enterBattlefield(s,o,controller=o.owner,attachment=null){
 move(s,o,'battlefield');o.controller=controller;o.attachedTo=attachment;
 const d=definition(o);if(d.etb)queueTrigger(s,o,d.etb,`${o.name} · enters`);
 if(d.type==='creature')for(const watcher of battlefield(s)){
  if(watcher.id===o.id)continue;
  for(const trigger of definition(watcher).triggers??[])if(trigger.event==='otherCreatureEnters')queueTrigger(s,watcher,trigger.effects,`${watcher.name} · life`);
 }
}
/** Damage is marked before state-based actions. Caller batches combat packets. */
export function dealDamage(s,source,target,amount){
 if(amount<=0)return;
 if(target.kind==='player')s.players[target.id].life-=amount;
 else {const o=s.objects[target.id];if(!o||o.zone!=='battlefield'||o.incarnation!==target.incarnation)return;o.damage+=amount;if(source.keywords?.includes('deathtouch'))o.deathtouchDamage=true;}
 if(source.keywords?.includes('lifelink'))s.players[source.controller].life+=amount;
 emit(s,'damage',{source:source.id,target,amount,controller:source.controller});
}
export function resolveEffects(s,entry){
 for(const e of entry.effects??[]){
  const o=entry.target?.kind==='object'?s.objects[entry.target.id]:null;
  switch(e.op){
   case 'damage':dealDamage(s,{id:entry.source?.id,controller:entry.controller,keywords:entry.sourceKeywords??[]},entry.target,e.amount);break;
   case 'draw':draw(s,entry.controller,e.count);break;
   case 'gainLife':s.players[entry.controller].life+=e.amount;emit(s,'lifeGain',{player:entry.controller,amount:e.amount});break;
   case 'bounce':if(o)move(s,o,'hand');break;
   case 'destroy':if(o&&!hasKeyword(s,o,'indestructible'))move(s,o,'graveyard');break;
   case 'modify':if(o)s.modifiers.push({objectId:o.id,incarnation:o.incarnation,power:e.power,toughness:e.toughness,keywords:e.keywords??[],expires:s.turn});break;
   case 'counter':{const i=s.stack.findIndex(x=>x.id===entry.target.id);if(i>=0){const [countered]=s.stack.splice(i,1);const card=s.objects[countered.source.id];if(card?.zone==='stack')move(s,card,'graveyard');emit(s,'countered',{name:countered.name,stackId:countered.id});}break;}
   case 'token':for(let i=0;i<e.count;i++){const token=addObject(s,e.definition,entry.controller,'void');enterBattlefield(s,token,entry.controller);}break;
   default:throw new Error(`Unimplemented effect opcode: ${e.op}`);
  }
 }
}
export function resolveTop(s){
 const entry=s.stack.pop();if(!entry)return;
 const d=CARDS[entry.name],o=s.objects[entry.source?.id];
 if(entry.targetKind&&!legalTarget(s,entry.targetKind,entry.target,entry.controller)){
  emit(s,'fizzled',{name:entry.name,stackId:entry.id});if(entry.kind==='spell'&&o?.zone==='stack')move(s,o,'graveyard');return;
 }
 emit(s,'resolved',{name:entry.name,stackId:entry.id});
 if(entry.kind==='spell'&&['creature','enchantment','artifact'].includes(d.type))enterBattlefield(s,o,entry.controller,entry.target??null);
 else {resolveEffects(s,entry);if(entry.kind==='spell'&&o?.zone==='stack')move(s,o,'graveyard');}
}
/** All supported state-based actions are computed from one pre-action state. */
export function stateBasedActions(s){
 let changed=false;
 const losers=s.players.filter(p=>p.life<=0||p.failedDraw).map(p=>p.id);
 if(losers.length){s.status='finished';s.winner=losers.length===2?null:opponent(losers[0]);s.choice=null;emit(s,'gameOver',{winner:s.winner,reason:losers.some(p=>s.players[p].failedDraw)?'emptyLibrary':'life'});return true;}
 const toGrave=[];
 for(const o of battlefield(s)){
  const d=definition(o);
  if(d.type==='creature'){const {toughness}=stats(s,o);if(toughness<=0||(!hasKeyword(s,o,'indestructible')&&(o.damage>=toughness||o.deathtouchDamage)))toGrave.push(o);}
  if(d.aura){const target=s.objects[o.attachedTo?.id];if(!target||target.zone!=='battlefield'||target.incarnation!==o.attachedTo.incarnation||definition(target).type!=='creature')toGrave.push(o);}
 }
 for(const o of toGrave){move(s,o,'graveyard');changed=true;}
 for(const o of Object.values(s.objects))if(o.token&&o.zone!=='battlefield'){for(const p of s.players)for(const zone of ['hand','graveyard','exile','library'])p[zone]=p[zone].filter(id=>id!==o.id);delete s.objects[o.id];changed=true;}
 return changed;
}
/** Stabilize before priority (CR 117.5). Trigger ordering remains an explicit choice. */
export function stabilize(s){
 let iterations=0;
 while(s.status==='playing'&&stateBasedActions(s)){if(++iterations>100)throw new Error('State-based action fixed point did not converge.');}
 if(s.status!=='playing'||!s.pendingTriggers.length)return;
 // Each player's simultaneous triggers must be ordered by that player, APNAP.
 const groups=[s.active,opponent(s.active)].map(p=>({player:p,entries:s.pendingTriggers.filter(t=>t.controller===p)})).filter(g=>g.entries.length);
 s.pendingTriggers=[];
 for(const g of groups){
  if(g.entries.length===1){s.stack.push(g.entries[0]);continue;}
  s.choice={kind:'orderTriggers',player:g.player,entries:g.entries,remaining:groups.slice(groups.indexOf(g)+1)};return;
 }
}
export function finishTriggerOrder(s,ids){
 const choice=s.choice,byId=Object.fromEntries(choice.entries.map(e=>[e.id,e]));
 for(const id of ids)s.stack.push(byId[id]);
 s.choice=null;
 for(const g of choice.remaining){if(g.entries.length===1)s.stack.push(g.entries[0]);else{s.choice={kind:'orderTriggers',player:g.player,entries:g.entries,remaining:choice.remaining.slice(choice.remaining.indexOf(g)+1)};return;}}
}
