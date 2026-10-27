import { validateFilter, matchesFilter } from './selectors.js';
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const EVENT_PRESETS = freeze({
  selfEnters: { event: 'enter', object: 'source' },
  selfAttacks: { event: 'attack', object: 'source' },
  selfDies: { event: 'dies', object: 'source' },
  otherCreatureDies: { event: 'dies', filter: { type: 'creature' }, excludeSource: true },
  controllerCreatureDies: { event: 'dies', controller: 'you', filter: { type: 'creature' } },
  otherCreatureEnters: { event: 'enter', filter: { type: 'creature' }, excludeSource: true },
  controllerLandEnters: { event: 'enter', controller: 'you', filter: { type: 'land' } },
  controllerCastsNoncreature: {
    event: 'cast',
    controller: 'you',
    filter: { not: { type: 'creature' } },
  },
  controllerCastsInstantOrSorcery: {
    event: 'cast',
    controller: 'you',
    filter: { any: [{ type: 'instant' }, { type: 'sorcery' }] },
  },
  controllerCastsArtifact: { event: 'cast', controller: 'you', filter: { type: 'artifact' } },
  controllerCastsEnchantment: { event: 'cast', controller: 'you', filter: { type: 'enchantment' } },
  controllerCastsCreature: { event: 'cast', controller: 'you', filter: { type: 'creature' } },
});
const plain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const eventSpec = (value) =>
  typeof value === 'string'
    ? Object.hasOwn(EVENT_PRESETS, value)
      ? EVENT_PRESETS[value]
      : null
    : plain(value)
      ? value
      : null;
export function validateEventSpec(value) {
  const spec = eventSpec(value);
  if (!spec) return ['Unknown event predicate.'];
  const errors = [];
  if (
    Object.keys(spec).some(
      (key) => !['event', 'object', 'controller', 'filter', 'excludeSource', 'step'].includes(key),
    )
  )
    errors.push('Unsupported event predicate field.');
  if (
    ![
      'enter',
      'cast',
      'dies',
      'attack',
      'step',
      'faceUp',
      'attackGroup',
      'noncombatDamageToPlayer',
      'lifeGain',
      'combatDamagePlayer',
    ].includes(spec.event)
  )
    errors.push('Unsupported event family.');
  if (
    spec.object !== undefined &&
    (spec.object !== 'source' ||
      !['enter', 'dies', 'attack', 'faceUp', 'combatDamagePlayer'].includes(spec.event))
  )
    errors.push(
      'Source identity predicates currently apply to enter, dies and attack events only.',
    );
  if (
    spec.event === 'lifeGain' &&
    (spec.object !== undefined || spec.filter !== undefined || spec.excludeSource !== undefined)
  )
    errors.push('Life-gain events identify a player, not an object.');
  if (spec.event === 'step') {
    if (!['upkeep', 'beginCombat', 'end', 'main1', 'main2'].includes(spec.step))
      errors.push('Unsupported beginning-of-step trigger.');
    if (spec.object !== undefined || spec.filter !== undefined || spec.excludeSource !== undefined)
      errors.push('Step events have no object filter.');
  } else if (spec.step !== undefined) errors.push('Only step events take a step.');
  if (spec.controller !== undefined && !['you', 'opponent'].includes(spec.controller))
    errors.push('Unknown event controller relation.');
  if (spec.excludeSource !== undefined && typeof spec.excludeSource !== 'boolean')
    errors.push('excludeSource must be a boolean.');
  if (spec.object === 'source' && spec.excludeSource)
    errors.push('An event cannot both require and exclude its source.');
  if (spec.filter !== undefined) errors.push(...validateFilter(spec.filter));
  return errors;
}
export function matchesEvent(value, event, facts, source) {
  const spec = eventSpec(value);
  if (!spec || spec.event !== event) return false;
  if (event === 'step' && spec.step !== facts.step) return false;
  if (spec.object === 'source' && facts.id !== source.id) return false;
  if (spec.excludeSource && facts.id === source.id) return false;
  if (spec.controller === 'you' && facts.controller !== source.controller) return false;
  if (spec.controller === 'opponent' && facts.controller === source.controller) return false;
  if (event === 'attackGroup')
    return (
      facts.objects?.some((object) => matchesFilter(object, spec.filter, source.controller)) ??
      false
    );
  return matchesFilter(facts, spec.filter, source.controller);
}
