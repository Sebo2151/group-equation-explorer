import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MENU,
  isProofDestination,
  locationHash,
  parseLocation,
  type Destination,
} from '../app/navigation.ts';

test('an empty or absent fragment is the menu, because the app opens there', () => {
  assert.deepEqual(parseLocation(''), MENU);
  assert.deepEqual(parseLocation('#'), MENU);
  assert.deepEqual(parseLocation('#menu'), MENU);
  assert.deepEqual(parseLocation(undefined), MENU);
  assert.deepEqual(parseLocation(null), MENU);
});

test('the named destinations parse with or without the hash', () => {
  assert.deepEqual(parseLocation('#help'), { view: 'help' });
  assert.deepEqual(parseLocation('help'), { view: 'help' });
  assert.deepEqual(parseLocation('#free'), { view: 'free' });
  assert.deepEqual(parseLocation('#challenge=solve-left'), {
    view: 'challenge',
    id: 'solve-left',
  });
});

/**
 * A shared proof keeps its whole fragment, because reading the payload is
 * `serialize.ts`'s job and it expects the fragment it was given.
 */
test('a shared proof is recognised without being read here', () => {
  const shared = parseLocation('#proof=abc123');
  assert.deepEqual(shared, { view: 'shared', fragment: '#proof=abc123' });
  assert.equal(isProofDestination(shared), true);
});

test('a challenge id that could not name a challenge lands on the menu', () => {
  assert.deepEqual(parseLocation('#challenge='), MENU);
  assert.deepEqual(parseLocation('#challenge=../etc'), MENU);
  assert.deepEqual(parseLocation('#challenge=Solve Left'), MENU);
  assert.deepEqual(parseLocation(`#challenge=${'a'.repeat(200)}`), MENU);
  assert.deepEqual(parseLocation('#something-else'), MENU);
});

test('a destination round trips through its fragment', () => {
  const destinations: Destination[] = [
    MENU,
    { view: 'help' },
    { view: 'free' },
    { view: 'challenge', id: 'cancel-pairs' },
    { view: 'shared', fragment: '#proof=abc123' },
  ];
  for (const destination of destinations) {
    assert.deepEqual(parseLocation(locationHash(destination)), destination);
  }
});

test('the menu and help are not the proof sheet; everything else is', () => {
  assert.equal(isProofDestination(MENU), false);
  assert.equal(isProofDestination({ view: 'help' }), false);
  assert.equal(isProofDestination({ view: 'free' }), true);
  assert.equal(isProofDestination({ view: 'challenge', id: 'powers' }), true);
});
