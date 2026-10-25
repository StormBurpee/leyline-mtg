/**
 * Hand-authored executable card definitions. Oracle prose is presentation data,
 * never executable code. Only definitions in this registry can enter a match.
 * Adding a card requires a rules regression test and a support-manifest entry.
 */
const land = (name, color) => ({ name, type: 'land', subtypes: [name], basic: true, mana: color, cost: {}, text: `Tap: Add ${color}.` });
const creature = (name, cost, power, toughness, keywords = [], extra = {}) => ({ name, type: 'creature', cost, power, toughness, keywords, ...extra });
const spell = (name, type, cost, effects, target, text) => ({ name, type, cost, effects, target, text });
const defs = [
  land('Plains','W'), land('Island','U'), land('Swamp','B'), land('Mountain','R'), land('Forest','G'),
  creature('Llanowar Elves',{G:1},1,1,[],{mana:'G',text:'Tap: Add G.'}),
  creature('Grizzly Bears',{generic:1,G:1},2,2),
  creature('Centaur Courser',{generic:2,G:1},3,3),
  creature('Colossal Dreadmaw',{generic:4,G:2},6,6,['trample']),
  creature('Giant Spider',{generic:3,G:1},2,4,['reach']),
  creature('Elvish Visionary',{generic:1,G:1},1,1,[],{etb:[{op:'draw',count:1}],text:'When this creature enters, draw a card.'}),
  creature('Savannah Lions',{W:1},2,1),
  creature('Silvercoat Lion',{generic:1,W:1},2,2),
  creature('Youthful Knight',{generic:1,W:1},2,1,['first strike']),
  creature('Serra Angel',{generic:3,W:2},4,4,['flying','vigilance']),
  creature('Soul Warden',{W:1},1,1,[],{triggers:[{event:'otherCreatureEnters',effects:[{op:'gainLife',amount:1}]}],text:'Whenever another creature enters, you gain 1 life.'}),
  creature('Raging Goblin',{R:1},1,1,['haste']),
  creature('Goblin Piker',{generic:1,R:1},2,1),
  creature('Hill Giant',{generic:3,R:1},3,3),
  creature('Goblin Instigator',{generic:1,R:1},1,1,[],{etb:[{op:'token',definition:'Goblin Token',count:1}],text:'When this creature enters, create a 1/1 red Goblin creature token.'}),
  creature('Goblin Token',{},1,1,[],{token:true,color:['R']}),
  creature('Wind Drake',{generic:2,U:1},2,2,['flying']),
  creature('Air Elemental',{generic:3,U:2},4,4,['flying']),
  creature('Typhoid Rats',{B:1},1,1,['deathtouch']),
  creature('Vampire Nighthawk',{generic:1,B:2},2,3,['flying','deathtouch','lifelink']),
  creature('Fencing Ace',{generic:1,W:1},1,1,['double strike']),
  spell('Lightning Bolt','instant',{R:1},[{op:'damage',amount:3}],'any','Deal 3 damage to any target.'),
  spell('Shock','instant',{R:1},[{op:'damage',amount:2}],'any','Deal 2 damage to any target.'),
  spell('Counterspell','instant',{U:2},[{op:'counter'}],'spell','Counter target spell.'),
  spell('Negate','instant',{generic:1,U:1},[{op:'counter'}],'noncreatureSpell','Counter target noncreature spell.'),
  spell('Unsummon','instant',{U:1},[{op:'bounce'}],'creature','Return target creature to its owner’s hand.'),
  spell('Giant Growth','instant',{G:1},[{op:'modify',power:3,toughness:3}],'creature','Target creature gets +3/+3 until end of turn.'),
  spell('Titanic Growth','instant',{generic:1,G:1},[{op:'modify',power:4,toughness:4}],'creature','Target creature gets +4/+4 until end of turn.'),
  spell('Murder','instant',{generic:1,B:2},[{op:'destroy'}],'creature','Destroy target creature.'),
  spell('Doom Blade','instant',{generic:1,B:1},[{op:'destroy'}],'nonblackCreature','Destroy target nonblack creature.'),
  spell('Divination','sorcery',{generic:2,U:1},[{op:'draw',count:2}],null,'Draw two cards.'),
  spell('Lava Axe','sorcery',{generic:4,R:1},[{op:'damage',amount:5}],'opponent','Deal 5 damage to target player or planeswalker. (This kernel supports players.)'),
  spell('Raise the Alarm','instant',{generic:1,W:1},[{op:'token',definition:'Soldier Token',count:2}],null,'Create two 1/1 white Soldier creature tokens.'),
  creature('Soldier Token',{},1,1,[],{token:true,color:['W']}),
  {name:'Glorious Anthem',type:'enchantment',cost:{generic:1,W:2},static:{kind:'anthem',power:1,toughness:1},text:'Creatures you control get +1/+1.'},
  {name:'Pacifism',type:'enchantment',subtypes:['Aura'],cost:{generic:1,W:1},target:'creature',aura:'pacifism',text:'Enchant creature. Enchanted creature can’t attack or block.'},
];
export const CARDS = Object.freeze(Object.fromEntries(defs.map(d => [d.name, Object.freeze({...d, keywords:d.keywords ?? [], subtypes:d.subtypes ?? [], text:d.text ?? (d.keywords?.join(', ') || 'No abilities.'), color:d.color ?? Object.keys(d.cost).filter(k=>k!=='generic')})])));
export function cardDefinition(name) { const d=CARDS[name]; if(!d) throw new Error(`Unsupported card: ${name}`); return d; }
export const DECKS = Object.freeze({
  ember: {name:'Ember & Echo',colors:['R','U'],description:'Make them answer the threat. Then answer their answer.',cards:{Mountain:12,Island:12,'Raging Goblin':4,'Goblin Piker':4,'Goblin Instigator':4,'Wind Drake':3,'Air Elemental':2,'Lightning Bolt':4,Shock:3,Counterspell:4,Unsummon:4,Divination:4}},
  grove: {name:'The Living Grove',colors:['G','W'],description:'A small beginning. An overwhelming board.',cards:{Forest:13,Plains:11,'Llanowar Elves':4,'Elvish Visionary':4,'Grizzly Bears':4,'Soul Warden':3,'Youthful Knight':3,'Giant Spider':2,'Serra Angel':2,'Colossal Dreadmaw':2,'Giant Growth':4,'Raise the Alarm':3,'Glorious Anthem':2,Pacifism:3}},
});
export function expandDeck(list) { return Object.entries(list).flatMap(([name,count])=>Array.from({length:count},()=>name)); }
export function validateDeck(names,{minimum=60}={}) {
  const errors=[]; const counts={};
  if(!Array.isArray(names)) return ['Deck must be an array of card names.'];
  if(names.length<minimum) errors.push(`Deck needs at least ${minimum} cards; got ${names.length}.`);
  if(names.length>250) errors.push('This release caps decks at 250 cards.');
  for(const name of names){const d=CARDS[name]; if(!d){errors.push(`Unsupported card: ${name}`);continue;} if(d.token)errors.push(`Tokens cannot be in a deck: ${name}`);counts[name]=(counts[name]??0)+1;}
  for(const [name,count] of Object.entries(counts))if(count>4&&!CARDS[name].basic)errors.push(`More than four copies: ${name}`);
  return [...new Set(errors)];
}
export function parseDeck(text) {
  const names=[];const errors=[];
  for(const [i,raw] of text.split(/\r?\n/).entries()){
    const line=raw.trim();if(!line||line==='Deck'||line.startsWith('//'))continue;
    if(/^(Sideboard|Commander|Companion)$/i.test(line)){errors.push(`Line ${i+1}: only a main deck is supported.`);break;}
    const match=line.match(/^(\d+)\s+(.+?)(?:\s+\([A-Za-z0-9]+\)\s+\d+)?$/);
    if(!match){errors.push(`Line ${i+1}: expected quantity and card name.`);continue;}
    const n=Number(match[1]);if(n<1||n>250){errors.push(`Line ${i+1}: invalid quantity.`);continue;}
    names.push(...Array(n).fill(match[2]));
  }
  return {names,errors:[...errors,...validateDeck(names)]};
}
