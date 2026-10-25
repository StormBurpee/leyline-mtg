import {createGame,dispatch} from '../src/index.js';
import {addObject,move} from '../src/model.js';
export function fixture(){const s=createGame({mulligan:false});s.step='main1';s.turn=3;for(const p of s.players)for(const id of [...p.hand])move(s,s.objects[id],'library');return s;}
export function put(s,name,player=0,zone='battlefield',{ready=true}={}){const o=addObject(s,name,player,zone);if(ready)o.controlledSince=s.turn-1;return o;}
export function lands(s,color,count,p=0){return Array.from({length:count},()=>put(s,color,p));}
export function act(s,type,extra={},player=s.choice?.player??s.priority){const r=dispatch(s,{type,player,...extra});if(!r.ok)throw new Error(`${r.error.code}: ${r.error.message}`);return r.state;}
export function resolve(s){s=act(s,'pass');return act(s,'pass');}
