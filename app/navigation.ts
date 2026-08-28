/**
 * Where the app is, encoded in the URL fragment.
 *
 * The fragment rather than a route, for three reasons. Sharing a proof already
 * puts it in the fragment, so this is the mechanism that exists rather than a
 * second one beside it. Static hosting stays trivial: there is one document,
 * whatever the learner is looking at. And the back button and a linkable
 * challenge come along without a router.
 *
 * Nothing here reads or writes `window`; it is a pure translation, so it can be
 * tested without a browser and used on the server, where there is no fragment
 * at all.
 */

export type Destination =
  | { view: 'menu' }
  | { view: 'help' }
  | { view: 'free' }
  | { view: 'challenge'; id: string }
  /** A proof someone shared. The payload is left to `serialize.ts` to read. */
  | { view: 'shared'; fragment: string };

export const MENU: Destination = { view: 'menu' };

/**
 * Challenge ids come from a URL, so they are matched against a narrow pattern
 * before being looked up. An id that does not match is not a challenge that
 * exists, and lands on the menu rather than raising anything.
 */
const CHALLENGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseLocation(fragment: unknown): Destination {
  if (typeof fragment !== 'string') return MENU;

  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (text.length === 0 || text === 'menu') return MENU;
  if (text === 'help') return { view: 'help' };
  if (text === 'free') return { view: 'free' };

  // A shared proof carries its own payload; it is validated when it is read.
  if (/^proof=/.test(text)) return { view: 'shared', fragment: `#${text}` };

  const challenge = /^challenge=(.*)$/.exec(text);
  if (challenge) {
    const id = challenge[1];
    return CHALLENGE_ID.test(id) ? { view: 'challenge', id } : MENU;
  }

  return MENU;
}

export function locationHash(destination: Destination): string {
  switch (destination.view) {
    case 'menu':
      return '#menu';
    case 'help':
      return '#help';
    case 'free':
      return '#free';
    case 'challenge':
      return `#challenge=${destination.id}`;
    case 'shared':
      return destination.fragment;
  }
}

/** Whether this destination puts the learner on the proof sheet. */
export function isProofDestination(destination: Destination): boolean {
  return destination.view !== 'menu' && destination.view !== 'help';
}
