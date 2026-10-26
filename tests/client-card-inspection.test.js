import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectableCard, readableCard } from '../apps/web/card-inspection.js';
import { fixture, put } from '../packages/engine/test/helpers.js';

test('inspection includes public permanents and zones, not concealed cards', () => {
  const s = fixture();
  for (const zone of ['battlefield', 'graveyard', 'exile']) {
    const object = put(s, 'Grizzly Bears', 1, zone);
    assert.equal(inspectableCard(s, object.id, 0), object);
  }
  const own = put(s, 'Shock', 0, 'hand');
  const enemy = put(s, 'Counterspell', 1, 'hand');
  const library = put(s, 'Island', 0, 'library');
  assert.equal(inspectableCard(s, own.id, 0), own);
  assert.equal(inspectableCard(s, enemy.id, 0), null);
  assert.equal(inspectableCard(s, library.id, 0), null);
  assert.equal(inspectableCard(s, 'missing', 0), null);
  own.zone = 'library';
  assert.equal(inspectableCard(s, own.id, 0), null);
});
test('a concealed stale selection cannot hide a valid public inspection', () => {
  const s = fixture();
  const enemy = put(s, 'Counterspell', 1, 'hand');
  const publicCard = put(s, 'Grizzly Bears', 1);
  assert.equal(
    readableCard(s, { selected: enemy.id, inspectObject: publicCard.id }, 0),
    publicCard.id,
  );
  assert.equal(readableCard(s, { selected: enemy.id }, 0), null);
});
