/**
 * The curriculum.
 *
 * A challenge names its permitted rules explicitly, and that list is frozen
 * into any proof built from it. That is the mechanism against circular proofs:
 * a challenge whose point is a lemma must not list that lemma among its tools,
 * and a later change to the catalogue cannot silently re-interpret an old
 * record.
 *
 * Phase 4 adds progression and teaching metadata to each entry.
 *
 * `grants` is the law this challenge earns. Every law in the catalogue is
 * either primitive — an axiom, or the definition of a piece of notation — or
 * derived, and a derived law may not appear in any challenge's ruleset until an
 * earlier challenge has proved it. That is checked by test, and it is why the
 * lemmas now come in pairs: one challenge establishes `(a^-1)^-1 = a` from the
 * axioms, and the next is allowed to use it in one step.
 *
 * `requires` is the challenge that must be finished before this one opens. It
 * is the linear order of the list, written down rather than inferred, so the
 * dependency check has something to check.
 *
 * `solution` is a reference proof, replayed by test against exactly these
 * tools. It is what the plan means by authoring and checking an actual proof
 * before shipping a challenge, it supplies the benchmark length a personal best
 * is compared against, and it is what the hints walk through.
 *
 * `chapter`, `objective`, `prompt`, and `takeaway` make the pedagogical arc
 * explicit in data rather than scattering curriculum copy through the page.
 */

import { parseSubject, parseTerm } from './parse.ts';
import { ALL_RULE_IDS, findAddresses, type AnyRuleId } from './catalogue.ts';
import { exactGoal, isolatedGoal, type Goal } from './goal.ts';
import type { Address, Side, Subject } from './subject.ts';
import type { RuleArgument } from './rules.ts';

/**
 * One move of a reference proof, written the way a person would say it: this
 * law, at the nth place it offers, optionally with this term.
 *
 * The index is into the candidates the interface itself marks, in the order it
 * numbers them, so a hint built from a move can name a control the learner can
 * see. Storing a raw path and span instead would be unreadable here and would
 * have to be re-derived to say anything useful.
 */
export type Move = {
  rule: AnyRuleId;
  /** Which marked place, counting from 1 in reading order. Defaults to 1. */
  at?: number;
  /** Source text of the term this law needs, for the ones that need one. */
  term?: string;
  inverseFirst?: boolean;
};

export type Challenge = {
  id: string;
  label: string;
  title: string;
  blurb: string;
  chapter: CourseChapterId;
  /** The specific capability this problem is meant to build. */
  objective: string;
  /** A question shown before the first move, to encourage prediction. */
  prompt: string;
  /** The idea named back to the learner after the proof is complete. */
  takeaway: string;
  /** Source text, parsed on demand so the data stays readable and diffable. */
  start: string;
  goal: GoalSource;
  rules: AnyRuleId[];
  /** Laws this challenge earns for later ones. */
  grants?: AnyRuleId[];
  /** The challenge that unlocks this one. Absent on the first. */
  requires?: string;
  solution: Move[];
};

export type CourseChapterId =
  | 'foundations'
  | 'inverse-theorems'
  | 'powers'
  | 'equations'
  | 'fluency';

export type CourseChapter = {
  id: CourseChapterId;
  label: string;
  title: string;
  description: string;
  outcome: string;
};

export const COURSE_CHAPTERS: CourseChapter[] = [
  {
    id: 'foundations',
    label: 'Chapter 1',
    title: 'Identity and inverse moves',
    description: 'Learn what may be removed, what may be inserted, and why both preserve a term.',
    outcome: 'Recognize inverse pairs and deliberately create useful ones.',
  },
  {
    id: 'inverse-theorems',
    label: 'Chapter 2',
    title: 'Earn the inverse laws',
    description: 'First show why an inverse is unique, then turn that fact and the axioms into reusable theorems.',
    outcome: 'Prove inverse uniqueness and apply it to the identity, double-inverse, and socks-and-shoes laws.',
  },
  {
    id: 'powers',
    label: 'Chapter 3',
    title: 'Powers as notation',
    description: 'Connect exponent notation to repeated products, inverses, and cancellation.',
    outcome: 'Move fluently between powers and the products they abbreviate.',
  },
  {
    id: 'equations',
    label: 'Chapter 4',
    title: 'Solve without commuting',
    description: 'Keep track of which side you multiply on when order matters.',
    outcome: 'Solve group equations and derive left and right cancellation.',
  },
  {
    id: 'fluency',
    label: 'Chapter 5',
    title: 'Mixed proof fluency',
    description: 'Choose among the laws without being told which family the next move belongs to.',
    outcome: 'Combine inverse laws and solve equations with factors on both ends.',
  },
];

/** A goal in challenge data: source text for an exact one, or a shape. */
export type GoalSource = string | { isolate: string; side: Side };

export const FREE_CHALLENGE_ID = 'free';

/** Everything in the catalogue. Free exploration is not a graded challenge. */
export const FREE_RULES: AnyRuleId[] = ALL_RULE_IDS;

/**
 * The laws a learner may use before earning anything.
 *
 * Two kinds sit here. The axioms — cancelling and inserting an inverse pair,
 * removing and inserting the identity, and the whole-equation moves — are what
 * the group axioms directly say, and everything else in the app is built out of
 * them. The power laws are the *definition* of the notation `x^n` rather than
 * theorems about it: writing a power out, adding exponents, `x^0 = e`, and the
 * two readings of a negative exponent are all statements about what the
 * shorthand abbreviates. Making a learner derive a definition would teach the
 * wrong thing about where notation comes from.
 *
 * `invert-both-sides` is the one judgement call. It rests on inverses being
 * unique, which is a theorem — but it is a theorem about equations, and this
 * app proves things about equations by transforming them, so there is no
 * sequence of moves here that could establish it. It is taken as given, and
 * said to be taken as given, rather than pretended to be earned.
 */
export const PRIMITIVE_RULES: AnyRuleId[] = [
  'cancel-inverse',
  'insert-inverse-pair',
  'remove-identity',
  'insert-identity',
  'expand-power',
  'combine-powers',
  'zero-power',
  'inverse-of-power',
  'negative-power',
  'symmetry',
  'left-multiply',
  'right-multiply',
  'invert-both-sides',
];

export const CHALLENGES: Challenge[] = [
  {
    id: 'cancel-pairs',
    label: '01',
    title: 'Cancel what undoes itself',
    blurb: 'Two inverse pairs are hiding in this product. Take them out one at a time.',
    chapter: 'foundations',
    objective: 'Recognize adjacent inverse pairs and clean up the identity they leave behind.',
    prompt: 'Which adjacent factors multiply to the identity?',
    takeaway: 'An inverse pair may be replaced by the identity, but the identity remains visible until it is removed.',
    start: 'a a^-1 b c^-1 c',
    goal: 'b',
    rules: ['cancel-inverse', 'remove-identity'],
    solution: [
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'insert-a-pair',
    label: '02',
    title: 'Put something in',
    blurb:
      'Every step so far removed something. Multiplying by a term and its inverse changes nothing, so it is a way to bring in whatever a proof needs.',
    chapter: 'foundations',
    objective: 'Use the inverse law in reverse to create a strategically useful pair.',
    prompt: 'What pair can you insert, and in which order, to produce the target?',
    takeaway: 'A proof can move forward by inserting structure, not only by simplifying it away.',
    start: 'b',
    goal: 'a^-1 a b',
    rules: ['insert-inverse-pair', 'insert-identity', 'remove-identity', 'cancel-inverse'],
    requires: 'cancel-pairs',
    solution: [{ rule: 'insert-inverse-pair', at: 1, term: 'a', inverseFirst: true }],
  },

  {
    id: 'unique-right-inverse',
    label: '03',
    title: 'Why a right inverse is unique',
    blurb:
      'Suppose x behaves like a right inverse of a: ax = e. Solve the equation to show that x has no freedom at all — it must be a^-1. That is exactly what uniqueness means here.',
    chapter: 'inverse-theorems',
    objective: 'Prove that any right inverse of a must equal the named inverse a^-1.',
    prompt: 'What can multiply both sides on the left so that a and x separate?',
    takeaway: 'If ax = e, then x = a^-1. Therefore a cannot have two different right inverses.',
    start: 'a x = e',
    goal: 'x = a^-1',
    rules: ['left-multiply', 'cancel-inverse', 'remove-identity'],
    requires: 'insert-a-pair',
    solution: [
      { rule: 'left-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'unique-left-inverse',
    label: '04',
    title: 'Why a left inverse is unique',
    blurb:
      'Now suppose x works on the other side: xa = e. Prove again that x must be a^-1. Together, these two challenges say that the inverse of a is unique, whichever side reveals it.',
    chapter: 'inverse-theorems',
    objective: 'Prove that any left inverse of a must equal the named inverse a^-1.',
    prompt: 'On which side should a^-1 multiply so that it meets a?',
    takeaway: 'If xa = e, then x = a^-1. Left inverses are unique as well as right inverses.',
    start: 'x a = e',
    goal: 'x = a^-1',
    rules: ['right-multiply', 'cancel-inverse', 'remove-identity'],
    requires: 'unique-right-inverse',
    solution: [
      { rule: 'right-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },

  /*
   * The first reusable lemma. The preceding equation challenges established
   * that an element satisfying either inverse equation must be the named
   * inverse. Here e itself satisfies e e = e, so uniqueness identifies it with
   * e^-1; the permitted rewrite route expresses the same argument directly.
   */
  {
    id: 'prove-identity-inverse',
    label: '05',
    title: 'Prove: the identity inverts to itself',
    blurb:
      'The last two challenges showed that inverses are unique. Since e multiplied by e is e, the identity already behaves as its own inverse. Now turn that observation into the reusable law e^-1 = e.',
    chapter: 'inverse-theorems',
    objective: 'Use inverse uniqueness to explain why the identity is its own inverse.',
    prompt: 'What identity factor makes e^-1 meet the element whose inverse it is?',
    takeaway: 'The identity is its own inverse: e already satisfies the inverse equation, and the inverse is unique.',
    start: 'e^-1',
    goal: 'e',
    rules: ['insert-identity', 'cancel-inverse', 'remove-identity'],
    grants: ['inverse-of-identity'],
    requires: 'unique-left-inverse',
    solution: [
      { rule: 'insert-identity', at: 2 },
      { rule: 'cancel-inverse', at: 1 },
    ],
  },

  {
    id: 'prove-double-inverse',
    label: '06',
    title: 'Prove: an inverse of an inverse',
    blurb:
      'You have been told that undoing an undoing puts you back where you started. Nobody has shown it. Write in a pair that lets the outer inverse meet the inner one.',
    chapter: 'inverse-theorems',
    objective: 'Construct a proof of the double-inverse law from the axioms.',
    prompt: 'Which inverse pair would let the two inverse operations meet?',
    takeaway: 'Double inverse is a theorem earned by inserting the right pair and then cancelling.',
    start: '(a^-1)^-1',
    goal: 'a',
    rules: ['insert-inverse-pair', 'insert-identity', 'cancel-inverse', 'remove-identity'],
    grants: ['double-inverse', 'wrap-double-inverse'],
    requires: 'prove-identity-inverse',
    solution: [
      { rule: 'insert-inverse-pair', at: 2, term: 'a', inverseFirst: true },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'double-inverse',
    label: '07',
    title: 'Undo an undoing',
    blurb:
      'Now that the last challenge proved it, undoing a double inverse is a single step. Then the rest cancels.',
    chapter: 'inverse-theorems',
    objective: 'Apply an earned theorem inside a longer expression.',
    prompt: 'Which newly earned law exposes the remaining inverse pair?',
    takeaway: 'A derived law becomes a reusable shortcut after you have proved it.',
    start: '(a^-1)^-1 b^-1 b',
    goal: 'a',
    rules: ['double-inverse', 'cancel-inverse', 'remove-identity'],
    requires: 'prove-double-inverse',
    solution: [
      { rule: 'double-inverse', at: 1 },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },

  {
    id: 'prove-socks-and-shoes',
    label: '08',
    title: 'Prove: socks and shoes',
    blurb:
      'Inverting a product reverses it — but why? Write the product in beside its own inverse so the two annihilate, and see what is left standing.',
    chapter: 'inverse-theorems',
    objective: 'Derive the inverse-of-a-product law by constructing cancellable structure.',
    prompt: 'What must appear beside the inverse of ab so that the whole product cancels?',
    takeaway: 'The order reverses because the factors that cancel a product must arrive in reverse order.',
    start: '(ab)^-1',
    goal: 'b^-1 a^-1',
    rules: ['insert-inverse-pair', 'insert-identity', 'cancel-inverse', 'remove-identity'],
    grants: ['inverse-of-product', 'combine-inverses'],
    requires: 'double-inverse',
    solution: [
      { rule: 'insert-inverse-pair', at: 2, term: 'a' },
      { rule: 'insert-inverse-pair', at: 3, term: 'b' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'socks-and-shoes',
    label: '09',
    title: 'Socks and shoes',
    blurb: 'Distribute the inverse you just earned, and the middle collapses.',
    chapter: 'inverse-theorems',
    objective: 'Use socks-and-shoes to expose a cancellation.',
    prompt: 'What does distributing the inverse reveal in the middle?',
    takeaway: 'Distributing an inverse reverses factor order and can expose local inverse pairs.',
    start: '(ab)^-1 a',
    goal: 'b^-1',
    rules: ['inverse-of-product', 'cancel-inverse', 'remove-identity'],
    requires: 'prove-socks-and-shoes',
    solution: [
      { rule: 'inverse-of-product', at: 1 },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'nested-inverse',
    label: '10',
    title: 'Reach inside',
    blurb: 'The target is nested. Distribute first, then clean up what that exposes.',
    chapter: 'inverse-theorems',
    objective: 'Rewrite inside a nested inverse expression.',
    prompt: 'Which outer rewrite makes an inner theorem applicable?',
    takeaway: 'Proof steps can expose new targets inside the structure of a term.',
    start: '(a b^-1)^-1',
    goal: 'b a^-1',
    rules: ['inverse-of-product', 'double-inverse', 'combine-inverses'],
    requires: 'socks-and-shoes',
    solution: [
      { rule: 'inverse-of-product', at: 1 },
      { rule: 'double-inverse', at: 1 },
    ],
  },
  {
    id: 'powers',
    label: '11',
    title: 'Powers are shorthand',
    blurb:
      'A power abbreviates a repeated product. Add the exponents, or write them out and cancel — both are proofs.',
    chapter: 'powers',
    objective: 'Interpret powers as compact notation for products and inverses.',
    prompt: 'Can the adjacent powers be combined before anything is expanded?',
    takeaway: 'Power laws record what repeated-product notation means; combining exponents can compress several elementary steps.',
    start: 'a^3 a^-2',
    goal: 'a',
    rules: [
      'combine-powers',
      'expand-power',
      'cancel-inverse',
      'remove-identity',
      'zero-power',
      'negative-power',
      'inverse-of-power',
    ],
    requires: 'nested-inverse',
    solution: [{ rule: 'combine-powers', at: 1 }],
  },
  {
    id: 'power-workout',
    label: '12',
    title: 'Power workout',
    blurb: 'One exponent calculation exposes an inverse pair. Finish the cleanup without expanding the powers.',
    chapter: 'powers',
    objective: 'Combine power notation with inverse and identity cleanup.',
    prompt: 'What is the exponent left after the first two factors combine?',
    takeaway: 'Power notation and the inverse law describe the same group structure at different levels of compression.',
    start: 'a^2 a^-3 b^-1 b',
    goal: 'a^-1',
    rules: ['combine-powers', 'cancel-inverse', 'remove-identity'],
    requires: 'powers',
    solution: [
      { rule: 'combine-powers', at: 1 },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },

  /*
   * From here the line is an equation rather than an expression. The rules that
   * act on the statement as a whole arrive one at a time, so each challenge
   * introduces a single new move.
   *
   * These are also where goal shapes earn their place: solving for x means
   * getting x by itself, not landing on one particular arrangement of the other
   * side, so a learner who clears the a by a different route still finishes.
   */
  {
    id: 'solve-left',
    label: '13',
    title: 'Solve for x',
    blurb:
      'x is trapped behind an a. Multiplying both sides by the same term keeps the equation true — choose the term that clears it.',
    chapter: 'equations',
    objective: 'Solve an equation by multiplying on the correct side.',
    prompt: 'What must multiply on the left to cancel the a before x?',
    takeaway: 'To clear a factor on the left of x, multiply both sides on the left by its inverse.',
    start: 'a x = b',
    goal: { isolate: 'x', side: 'left' },
    rules: ['left-multiply', 'cancel-inverse', 'remove-identity'],
    requires: 'power-workout',
    solution: [
      { rule: 'left-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'solve-right',
    label: '14',
    title: 'The other side',
    blurb:
      'The same problem with the a on the right. The group is not assumed commutative, so the side you multiply on matters.',
    chapter: 'equations',
    objective: 'Contrast right multiplication with the previous left-multiplication proof.',
    prompt: 'On which side must a^-1 be placed to meet the a?',
    takeaway: 'In a noncommutative group, the obstructing factor determines which side to multiply on.',
    start: 'x a = b',
    goal: { isolate: 'x', side: 'left' },
    rules: ['right-multiply', 'cancel-inverse', 'remove-identity'],
    requires: 'solve-left',
    solution: [
      { rule: 'right-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'read-it-backwards',
    label: '15',
    title: 'Read it the other way',
    blurb:
      'An equation says the same thing in either direction — but saying it the other way round is still a step.',
    chapter: 'equations',
    objective: 'Use symmetry as a deliberate proof step before solving.',
    prompt: 'Which side must contain x before the previous solving strategy applies?',
    takeaway: 'Symmetry preserves an equation but changes which solving moves are visually available.',
    start: 'b = a x',
    goal: { isolate: 'x', side: 'left' },
    rules: ['symmetry', 'left-multiply', 'cancel-inverse', 'remove-identity'],
    requires: 'solve-right',
    solution: [
      { rule: 'symmetry' },
      { rule: 'left-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'inverses-of-equals',
    label: '16',
    title: 'Inverses of equals',
    blurb:
      'Equal terms have equal inverses. Invert both sides, then remember what inverting a product does to the order.',
    chapter: 'equations',
    objective: 'Combine a whole-equation operation with a local term rewrite.',
    prompt: 'Which move acts on the entire equation before one side is simplified?',
    takeaway: 'Whole-equation operations and local rewrites play different roles in the same proof.',
    start: 'x = a b',
    goal: 'x^-1 = b^-1 a^-1',
    rules: ['invert-both-sides', 'inverse-of-product'],
    requires: 'read-it-backwards',
    solution: [{ rule: 'invert-both-sides' }, { rule: 'inverse-of-product', at: 1 }],
  },
  {
    id: 'cancellation',
    label: '17',
    title: 'Prove: cancel a common factor',
    blurb:
      'If a x and a y are equal, then x and y are. That is the cancellation law, and it is a theorem rather than an axiom — so here it is proved, from multiplying both sides.',
    chapter: 'equations',
    objective: 'Derive left cancellation rather than assuming it.',
    prompt: 'What can multiply both sides so the common leading a becomes an inverse pair?',
    takeaway: 'Cancellation is justified by multiplying both sides by an inverse and simplifying each side.',
    start: 'a x = a y',
    goal: 'x = y',
    rules: ['left-multiply', 'cancel-inverse', 'remove-identity'],
    grants: ['cancel-left', 'cancel-right'],
    requires: 'inverses-of-equals',
    solution: [
      { rule: 'left-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'use-cancellation',
    label: '18',
    title: 'Cancel from both ends',
    blurb:
      'Cancellation is yours now, and it comes in two directions. Nothing here needs the long way round any more.',
    chapter: 'equations',
    objective: 'Choose left and right cancellation by inspecting factor position.',
    prompt: 'Which common factor should be removed first, and does the order matter?',
    takeaway: 'Left and right cancellation are distinct laws because factor order still matters.',
    start: 'a x b = a y b',
    goal: 'x = y',
    rules: ['cancel-left', 'cancel-right'],
    requires: 'cancellation',
    solution: [{ rule: 'cancel-left' }, { rule: 'cancel-right' }],
  },
  {
    id: 'mixed-inverses',
    label: '19',
    title: 'Inverse fluency',
    blurb: 'Several inverse ideas are nested together. Choose the order that exposes the simplest next move.',
    chapter: 'fluency',
    objective: 'Combine socks-and-shoes with double inverse without being told the law family.',
    prompt: 'Which outer operation should be resolved before simplifying the middle factor?',
    takeaway: 'A useful strategy is to rewrite the outermost structure first, then simplify what it exposes.',
    start: '(a b^-1 c)^-1',
    goal: 'c^-1 b a^-1',
    rules: ['inverse-of-product', 'double-inverse', 'combine-inverses'],
    requires: 'use-cancellation',
    solution: [
      { rule: 'inverse-of-product', at: 1 },
      { rule: 'double-inverse', at: 1 },
    ],
  },
  {
    id: 'solve-both-ends',
    label: '20',
    title: 'Free x from both ends',
    blurb: 'x has a factor on each side. Remove them in an order that preserves every factor you still need.',
    chapter: 'fluency',
    objective: 'Coordinate left and right multiplication in one equation proof.',
    prompt: 'Which side of x can you clear first, and what must happen afterward?',
    takeaway: 'Solving a noncommutative equation may require inverse multiplications on both sides.',
    start: 'a x b = c',
    goal: { isolate: 'x', side: 'left' },
    rules: ['left-multiply', 'right-multiply', 'cancel-inverse', 'remove-identity'],
    requires: 'mixed-inverses',
    solution: [
      { rule: 'left-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
      { rule: 'right-multiply', term: 'b^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
  {
    id: 'solve-where-it-stands',
    label: '21',
    title: 'Solve it where it stands',
    blurb: 'This time x begins on the right side of the equation. Leave it there and still solve efficiently.',
    chapter: 'fluency',
    objective: 'Solve for a variable on the right side without spending a symmetry step.',
    prompt: 'Can the same two-sided strategy work without swapping the equation?',
    takeaway: 'A solved variable may stand on either side; symmetry is useful, but it is not always necessary.',
    start: 'c = a x b',
    goal: { isolate: 'x', side: 'right' },
    rules: ['left-multiply', 'right-multiply', 'cancel-inverse', 'remove-identity', 'symmetry'],
    requires: 'solve-both-ends',
    solution: [
      { rule: 'left-multiply', term: 'a^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
      { rule: 'right-multiply', term: 'b^-1' },
      { rule: 'cancel-inverse', at: 1 },
      { rule: 'remove-identity', at: 1 },
    ],
  },
];

export function challengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}

/** Position in the curriculum, or `-1` for anything not in it. */
export function challengeIndex(id: string): number {
  return CHALLENGES.findIndex((challenge) => challenge.id === id);
}

/** The challenge that earned this law, if any law did. */
export function grantedBy(rule: AnyRuleId): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.grants?.includes(rule));
}

export function isPrimitiveRule(rule: AnyRuleId): boolean {
  return PRIMITIVE_RULES.includes(rule);
}

export type ChallengeSetup = {
  challenge: string;
  start: Subject;
  goal: Goal | null;
  ruleset: AnyRuleId[];
};

export function parseGoalSource(source: GoalSource, where: string): Goal {
  return typeof source === 'string'
    ? exactGoal(parseSubject(source, where))
    : isolatedGoal(source.isolate, source.side);
}

export function challengeSetup(challenge: Challenge): ChallengeSetup {
  return {
    challenge: challenge.id,
    start: parseSubject(challenge.start, `challenge ${challenge.id} start`),
    goal: parseGoalSource(challenge.goal, `challenge ${challenge.id} goal`),
    ruleset: challenge.rules,
  };
}

export function freeSetup(start: Subject, goal: Goal | null = null): ChallengeSetup {
  return { challenge: FREE_CHALLENGE_ID, start, goal, ruleset: FREE_RULES };
}

/* ------------------------------------------------------------------ */
/* Reference proofs                                                    */
/* ------------------------------------------------------------------ */

/**
 * Turn one written move into the address and argument the proof reducer wants,
 * by asking the catalogue where the law applies on this line and taking the
 * numbered one. Returns `null` when the move does not fit — which is what a
 * hint needs to know, and what the reference-proof test fails on.
 */
export function resolveMove(
  subject: Subject,
  move: Move,
): { address: Address; argument?: RuleArgument } | null {
  const addresses = findAddresses(subject, move.rule);
  const address = addresses[(move.at ?? 1) - 1];
  if (!address) return null;

  if (move.term === undefined) return { address };
  const term = parseTerm(move.term, `reference move for ${move.rule}`);
  return {
    address,
    argument: { term, ...(move.inverseFirst ? { inverseFirst: true } : {}) },
  };
}

/** How many steps the authored proof takes. The benchmark a best is read against. */
export function benchmarkSteps(challenge: Challenge): number {
  return challenge.solution.length;
}
