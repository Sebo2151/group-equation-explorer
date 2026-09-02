'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChallengeBriefing } from './challenge-briefing.tsx';
import { FieldPreview, mathHtml, Typeset } from './math-view.tsx';
import { HelpText } from './help-text.tsx';
import { LAW_PURPOSES } from './law-purposes.ts';
import {
  benchmarkSteps,
  CHALLENGES,
  COURSE_CHAPTERS,
  challengeById,
  challengeSetup,
  FREE_CHALLENGE_ID,
  freeSetup,
  grantedBy,
  introducedBy,
  type Challenge,
} from './challenges.ts';
import { MAX_HINT_LEVEL, hintFor, referenceLines, rejoinDepth, type Hint } from './hints.ts';
import { arrivalFragment } from './arrival.ts';
import {
  MENU,
  isProofDestination,
  isReadingDestination,
  locationHash,
  parseLocation,
  type Destination,
} from './navigation.ts';
import {
  bestFor,
  completedCount,
  earnedRules,
  emptyProgress,
  introducedRules,
  isChallengeComplete,
  isUnlocked,
  nextChallenge,
  progressToJson,
  recordProof,
  requiredChallenge,
  standing,
  type Progress,
} from './progress.ts';
import { clearProgress, loadProgress, saveProgress } from './storage.ts';
import { exactGoal, goalProse, goalSpeech, goalTex } from './goal.ts';
import { parseSubject, tryParseSubject } from './parse.ts';
import { type RuleArgument } from './rules.ts';
import {
  applyRule,
  canRedo,
  canUndo,
  createProof,
  currentLine,
  isComplete,
  redo,
  restart,
  ruleAllowed,
  stepCount,
  undo,
  visibleLines,
  type ProofState,
} from './proof.ts';
import {
  layoutSubject,
  placeAddresses,
  subjectColumnCount,
  tokenColumn,
  tokensInAddress,
  type SubjectLayout,
} from './render.ts';
import {
  ALL_RULES,
  anyRuleById,
  findAddresses,
  type AnyRuleDefinition,
  type AnyRuleId,
} from './catalogue.ts';
import {
  importProof,
  importProofRecord,
  proofFromHash,
  proofToHash,
  proofToJson,
  proofToLatex,
} from './serialize.ts';
import {
  sideTerm,
  subjectSpeech,
  type Address,
  type Subject,
} from './subject.ts';
import {
  getNode,
  hostFactors,
  isGap,
  spanSpeech,
  spanTerms,
  termSpeech,
  type Target,
  type Term,
} from './term.ts';

/**
 * The tokens of an expression, laid out on the shared column grid.
 *
 * Every line of the proof draws its expression through this, whether or not it
 * is the line being worked on, so a letter sits at the same width on every
 * line. Spacing that changed as soon as a line stopped being current — or as
 * soon as an insertion law reserved room between the factors — read as the
 * mathematics moving about, which it never does.
 */
function FactorRow({
  layout,
  candidates,
  highlighted,
}: {
  layout: SubjectLayout;
  candidates?: Set<number>;
  highlighted?: Set<number>;
}) {
  return (
    <>
      {layout.tokens.map((token, index) => (
        <span
          aria-hidden="true"
          className={[
            'factor',
            `is-${token.kind}`,
            candidates?.has(index) ? 'is-candidate' : '',
            highlighted?.has(index) ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          key={index}
          style={{ gridColumn: tokenColumn(index) }}
          dangerouslySetInnerHTML={mathHtml(token.tex)}
        />
      ))}
    </>
  );
}

/** A settled line: the same grid as the current one, without any controls. */
function StaticStage({ subject }: { subject: Subject }) {
  const layout = useMemo(() => layoutSubject(subject), [subject]);

  return (
    <span
      className="expression-stage"
      role="math"
      aria-label={subjectSpeech(subject)}
      style={{ gridTemplateColumns: gridColumns(layout) }}
    >
      <span className="factor-row">
        <FactorRow layout={layout} />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The interactive line                                                */
/* ------------------------------------------------------------------ */

type ApplyRequest = { address: Address };

/**
 * The expression and its candidate controls share one grid, so a bracket spans
 * exactly the columns of the sub-expression it applies to without measuring
 * anything. Each candidate gets its own control: overlapping spans, and
 * insertion points that fall at the same place at different depths, are
 * stacked onto separate rows rather than collapsed together.
 */
function InteractiveSubject({
  subject,
  layout,
  rule,
  addresses,
  onApply,
  blocked,
  firstTargetRef,
}: {
  subject: Subject;
  layout: SubjectLayout;
  rule: AnyRuleDefinition;
  addresses: Address[];
  onApply: (request: ApplyRequest) => void;
  blocked: string | null;
  firstTargetRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [active, setActive] = useState<Address | null>(null);
  const stageRef = useRef<HTMLSpanElement | null>(null);

  const placements = useMemo(() => placeAddresses(layout, addresses), [layout, addresses]);
  const highlighted = useMemo(
    () => (active ? tokensInAddress(layout, active) : new Set<number>()),
    [active, layout],
  );
  const candidates = useMemo(() => {
    const inside = new Set<number>();
    for (const { address } of placements) {
      for (const token of tokensInAddress(layout, address)) inside.add(token);
    }
    return inside;
  }, [layout, placements]);

  /**
   * A law that acts on the line as a whole gets one control on the line, not a
   * bracket under part of it. It has no span to cover and no position to be
   * chosen among, so offering it through the candidate machinery would claim a
   * choice of place that does not exist.
   */
  const wholeLine = rule.scope === 'equation' && addresses.some((a) => a.kind === 'equation');

  /**
   * Arrow keys move between candidates and a digit picks one directly, so a
   * keyboard user is not required to tab through every control to reach the
   * one they want.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const controls = Array.from(
      stageRef.current?.querySelectorAll<HTMLButtonElement>('button.target') ?? [],
    );
    if (controls.length === 0) return;

    const here = controls.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = here === -1 ? 0 : (here + step + controls.length) % controls.length;
      controls[next].focus();
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      const chosen = controls[Number(event.key) - 1];
      if (chosen) {
        event.preventDefault();
        chosen.focus();
        chosen.click();
      }
    }
  };

  return (
    <>
      <span
        className="expression-stage"
        onKeyDown={onKeyDown}
        ref={stageRef}
        style={{ gridTemplateColumns: gridColumns(layout) }}
      >
        <span className="factor-row" role="math" aria-label={subjectSpeech(subject)}>
          <FactorRow layout={layout} candidates={candidates} highlighted={highlighted} />
        </span>

        {placements.map(({ address, columns, ordinal, layer }) => (
          <button
            aria-label={describeAddress(subject, rule, address, ordinal, placements.length)}
            className={`target ${isGapAddress(address) ? 'is-insertion' : ''} ${
              active && sameAddress(active, address) ? 'is-active' : ''
            }`}
            disabled={blocked !== null}
            key={addressKey(address)}
            onBlur={() => setActive(null)}
            onClick={() => onApply({ address })}
            onFocus={() => setActive(address)}
            onMouseEnter={() => setActive(address)}
            onMouseLeave={() => setActive(null)}
            ref={ordinal === 1 ? firstTargetRef : undefined}
            style={{ gridColumn: `${columns[0]} / ${columns[1] + 1}`, gridRow: layer + 2 }}
            title={blocked ?? undefined}
            type="button"
          >
            <span aria-hidden="true" className="target-bracket" />
            <span aria-hidden="true" className="target-label">
              {ordinal}
            </span>
          </button>
        ))}
      </span>

      {wholeLine && (
        <button
          aria-label={`${rule.name}. Applies to the whole equation.`}
          className="whole-line"
          disabled={blocked !== null}
          onClick={() => onApply({ address: { kind: 'equation' } })}
          ref={firstTargetRef}
          title={blocked ?? undefined}
          type="button"
        >
          <span aria-hidden="true">{rule.name} — whole equation</span>
        </button>
      )}
    </>
  );
}

function addressKey(address: Address): string {
  if (address.kind === 'equation') return 'equation';
  const { path, start, end } = address.target;
  const where = address.kind === 'side' ? address.side : 'expression';
  return `${where}:${path.join('.')}:${start}:${end}`;
}

function isGapAddress(address: Address): boolean {
  return address.kind !== 'equation' && isGap(address.target);
}

function sameAddress(left: Address, right: Address): boolean {
  return addressKey(left) === addressKey(right);
}

/**
 * The insertion columns keep the same width on every line and under every law.
 * They are narrower than the insertion bracket, which is centred and allowed to
 * overhang into the padding either side of its column; reserving the bracket's
 * full width instead would push the factors apart for no reason.
 */
function gridColumns(layout: SubjectLayout): string {
  const total = subjectColumnCount(layout);
  return Array.from({ length: total }, (_, index) =>
    index % 2 === 0 ? 'var(--insert-column)' : 'auto',
  ).join(' ');
}

/**
 * What a candidate control announces.
 *
 * On an equation the side is part of the description, and not for politeness:
 * `a a^-1 = a a^-1` offers structurally identical spans on either side, and
 * without the side their names would be identical. Two candidates that cannot
 * be told apart is exactly what the one-control-per-candidate invariant exists
 * to prevent. An expression has no sides, so its wording is unchanged.
 */
function describeAddress(
  subject: Subject,
  rule: AnyRuleDefinition,
  address: Address,
  ordinal: number,
  total: number,
): string {
  if (address.kind === 'equation') return `${rule.name}. Applies to the whole equation.`;

  const term =
    address.kind === 'side' && subject.kind === 'equation'
      ? sideTerm(subject, address.side)
      : (subject as { term: Term }).term;

  const where = isGap(address.target)
    ? describeGap(term, address.target)
    : `at ${spanSpeech(spanTerms(term, address.target))}`;
  const onSide = address.kind === 'side' ? `, on the ${address.side}` : '';

  return `${rule.name} ${where}${onSide}. Option ${ordinal} of ${total}.`;
}

function describeGap(term: Term, target: Target): string {
  const host = hostFactors(getNode(term, target.path));
  const before = target.start === 0 ? null : host[target.start - 1];
  const after = host[target.start] ?? null;

  if (before && after) return `between ${termSpeech(before)} and ${termSpeech(after)}`;
  if (after) return `before ${termSpeech(after)}`;
  if (before) return `after ${termSpeech(before)}`;
  return 'here';
}

/* ------------------------------------------------------------------ */
/* Committed lines                                                     */
/* ------------------------------------------------------------------ */

function ProofLineView({
  subject,
  detail,
  reason,
  interactive,
}: {
  subject: Subject;
  detail?: string;
  reason?: string;
  interactive: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="expression-slot">{interactive ?? <StaticStage subject={subject} />}</div>
      {reason && (
        <div className="reason-slot">
          <button
            aria-expanded={open}
            className="reason"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {reason}
            <span aria-hidden="true" className="reason-caret">
              {open ? '−' : '+'}
            </span>
          </button>
          {open && <p className="reason-detail">{detail}</p>}
        </div>
      )}
    </>
  );
}

/**
 * A proof read back rather than worked: every line, every reason, no controls.
 *
 * Used for two things that are the same thing seen twice — the worked route a
 * hint offers to show, and a finished proof of your own reopened from the menu.
 * Nothing here is interactive, so no brackets are drawn and no law is
 * selectable; the reasons still open, because a proof you cannot ask "why" of
 * is a list rather than an argument.
 */
function RecordedProof({ state }: { state: ProofState | null }) {
  if (!state) return <p className="recorded-missing">This proof is not available.</p>;

  return (
    <div className="recorded-proof">
      {visibleLines(state).map((entry, index) => (
        <div className="proof-line is-recorded" key={index}>
          <span className="relation" aria-hidden="true">
            {index === 0 ? '' : entry.subject.kind === 'equation' ? '⇔' : '='}
          </span>
          <ProofLineView
            detail={entry.step?.detail}
            interactive={null}
            reason={entry.step?.reason}
            subject={entry.subject}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

/**
 * How a law advertises where it can be used.
 *
 * A law that acts on the line as a whole has no places to count. Reporting it
 * as "1 place" would claim a choice of location that does not exist, and would
 * present it as the same kind of move as a local rewrite — which is exactly the
 * distinction the interface has to keep. When the line is not an equation at
 * all, the law is still shown, because the catalogue is meant to be visible;
 * but it says what it needs rather than reporting zero places, since it is
 * inapplicable in kind rather than merely unmatched here.
 */
function describeReach(rule: AnyRuleDefinition, count: number): string {
  if (rule.scope !== 'equation') return `${count} ${count === 1 ? 'place' : 'places'}`;
  return count > 0 ? 'whole equation' : 'needs an equation';
}

type Notice = { tone: 'ok' | 'error'; text: string } | null;

const DEFAULT_FREE_START = '(ab)^-1 a b';
const DEFAULT_FREE_GOAL = 'e';

function isEditingText(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, textarea, select') !== null);
}

function steps(count: number): string {
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

/**
 * What the length of this proof means.
 *
 * The benchmark is the proof the challenge was authored with, and nothing more
 * than that: a shorter one is "shorter than the one we know", never "the
 * shortest there is". Claiming a global minimum would need an exhaustive search
 * this app does not do, so it is not claimed.
 */
function scoreLine(challenge: Challenge, taken: number, best: number | undefined): string {
  const benchmark = benchmarkSteps(challenge);
  const mine = `${steps(taken)}; the expected proof takes ${steps(benchmark)}`;
  const shorter = taken < benchmark ? ', so yours is shorter' : '';
  const previous =
    best !== undefined && best < taken ? `. Your best here is ${steps(best)}` : '';
  return `${mine}${shorter}${previous}.`;
}

export default function Home() {
  const [proof, setProof] = useState(() => createProof(challengeSetup(CHALLENGES[0])));
  // A challenge should begin with a mathematical choice, not a UI hint. The
  // learner selects the first law after reading the line; only then do its
  // possible applications appear.
  const [selectedRule, setSelectedRule] = useState<AnyRuleId | null>(null);
  const [reasonsOpen, setReasonsOpen] = useState(true);
  const [insertSource, setInsertSource] = useState('a');
  const [inverseFirst, setInverseFirst] = useState(false);
  const [freeStart, setFreeStart] = useState(DEFAULT_FREE_START);
  const [freeGoal, setFreeGoal] = useState(DEFAULT_FREE_GOAL);
  const [importText, setImportText] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  /**
   * Progress starts empty and is filled in after mount. The server has no
   * storage to read, so rendering anything else first would mean the menu
   * changing under the learner on hydration.
   */
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [discarded, setDiscarded] = useState<string[]>([]);
  const [storageFailed, setStorageFailed] = useState(false);
  /** How many times a hint has been asked for on this line. Zero is none. */
  const [hintLevel, setHintLevel] = useState(0);
  const [routeOpen, setRouteOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(true);

  /**
   * The app opens on the menu, so that is what the server renders. There is no
   * fragment on the server, and reading one during the render would make the
   * first paint depend on something the server cannot see.
   */
  const [destination, setDestination] = useState<Destination>(MENU);
  const view = isProofDestination(destination)
    ? 'proof'
    : isReadingDestination(destination)
      ? 'reading'
      : 'menu';

  const dockRef = useRef<HTMLElement | null>(null);
  const currentRef = useRef<HTMLDivElement | null>(null);
  const firstTargetRef = useRef<HTMLButtonElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);
  const lastFreeProof = useRef<ProofState | null>(null);
  const menuRef = useRef<HTMLHeadingElement | null>(null);
  const briefingRef = useRef<HTMLHeadingElement | null>(null);
  // Read by the fragment handler, which must not be torn down and rebuilt on
  // every step just to see the current proof.
  const proofRef = useRef<ProofState | null>(null);
  // Same reason: the handler must be able to see what has been unlocked
  // without being rebuilt every time a challenge is finished.
  const progressRef = useRef<Progress>(emptyProgress());

  // Declared before the fragment handler so that it has already run when that
  // handler first fires, and kept out of the render body: a ref may not be
  // written while rendering.
  useEffect(() => {
    proofRef.current = proof;
  }, [proof]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const line = currentLine(proof);
  const complete = isComplete(proof);
  const rule = selectedRule ? anyRuleById(selectedRule) : null;
  const challenge = challengeById(proof.challenge);
  const challengePosition = challenge
    ? CHALLENGES.findIndex((entry) => entry.id === challenge.id)
    : -1;
  const nextCourseChallenge =
    challengePosition >= 0 ? CHALLENGES[challengePosition + 1] : undefined;
  const challengeChapter = challenge
    ? COURSE_CHAPTERS.find((entry) => entry.id === challenge.chapter)
    : undefined;

  /**
   * Read what this device remembers, once, after mount.
   *
   * Every stored proof is replayed on the way in, so what comes back is
   * progress that has been checked rather than progress that was claimed. A
   * record that no longer holds up is named rather than silently dropped: a
   * learner who finished something and then sees it un-finished deserves to
   * know why.
   */
  useEffect(() => {
    const reading = loadProgress();
    if (!reading) return;
    /*
     * Setting state straight from an effect is normally worth avoiding, and the
     * rule is disabled here deliberately rather than worked around. This is the
     * one case it describes as legitimate: reading an external system the
     * server cannot see. It has to happen after mount — the first render must
     * match the one the server produced, and the server has no storage — and it
     * happens exactly once.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(reading.progress);
    setDiscarded(reading.discarded);
  }, []);


  const hint: Hint | null = hintLevel > 0 ? hintFor(proof, hintLevel) : null;

  /**
   * A finished proof of the learner's own, rebuilt from what was stored.
   *
   * It is replayed rather than displayed from a cached rendering, for the same
   * reason it was replayed on the way in: the only thing that makes a stored
   * proof worth looking at is that it still checks out.
   */
  const readingChallenge =
    destination.view === 'best' ? challengeById(destination.id) : undefined;

  const recordedProof = useMemo(() => {
    if (destination.view !== 'best') return null;
    const record = bestFor(progress, destination.id)?.record;
    if (!record) return null;
    try {
      return importProofRecord(record);
    } catch {
      return null;
    }
  }, [destination, progress]);

  /** The worked route, built only when the learner asks to see it. */
  const referenceProof = useMemo(
    () => (routeOpen && challenge ? referenceLines(challenge) : null),
    [challenge, routeOpen],
  );
  const earned = useMemo(() => new Set(earnedRules(progress)), [progress]);
  const introduced = useMemo(() => new Set(introducedRules(progress)), [progress]);

  /**
   * Every place the selected law applies on this line, in reading order. The
   * counts, the spoken summary and the controls all come from this one list,
   * so they cannot disagree about how many options there are.
   */
  const addresses = useMemo(
    () => (complete || !selectedRule ? [] : findAddresses(line.subject, selectedRule)),
    [complete, line.subject, selectedRule],
  );

  const layout = useMemo(() => layoutSubject(line.subject), [line.subject]);

  const insertParse = useMemo(() => tryParseSubject(insertSource, 'term'), [insertSource]);
  const blocked = rule?.needsTerm
    ? !insertParse.ok
      ? `Name a term first: ${(rule.termPrompt ?? 'Insert this term').toLowerCase()}.`
      : insertParse.subject.kind === 'equation'
        ? 'Name a term, not an equation.'
        : null
    : null;

  /**
   * The sticky dock's height depends on how many laws the challenge permits,
   * so the band reserved for it under the proof sheet cannot be a constant.
   * Measure before scrolling a new proof into view, and repeat if the dock
   * resizes later (for example when an insertion field opens). Updating only
   * the scroll margin after scrolling leaves the line behind the new dock.
   */
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    let previousHeight = -1;
    const sync = () => {
      const height = Math.ceil(dock.getBoundingClientRect().height);
      if (height === previousHeight) return;
      previousHeight = height;
      document.documentElement.style.setProperty(
        '--dock-height',
        `${height}px`,
      );

      // A changing preview must not pull the learner away from their input.
      if (dock.contains(document.activeElement) && isEditingText(document.activeElement)) return;
      (successRef.current ?? currentRef.current)?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [proof, complete]);

  // A committed move unmounts the control that was clicked, which drops focus
  // to <body>. Hand it to the next thing the learner would act on: the first
  // remaining target, the success note, or — when the selected law no longer
  // applies anywhere — the new line itself, so the chain is never lost.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (firstTargetRef.current ?? successRef.current ?? currentRef.current)?.focus({ preventScroll: true });
  }, [proof, addresses]);

  /**
   * Show a new proof state.
   *
   * Everything that changes the proof comes through here, which is what lets
   * two things be said once rather than at every call site: a finished
   * challenge is recorded, and the hints start over, because a new line is a
   * new question and however much was given away about the last one should not
   * carry across to it.
   */
  const commit = useCallback((next: ProofState) => {
    setProof(next);
    setHintLevel(0);
    setRouteOpen(false);

    if (!isComplete(next)) return;

    // Read through the ref, not through render state: two finishing moves in
    // quick succession must both see the progress the first one wrote.
    const updated = recordProof(progressRef.current, next);
    if (updated === progressRef.current) return;
    progressRef.current = updated;
    setProgress(updated);
    if (!saveProgress(updated)) setStorageFailed(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditingText(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      const state = proofRef.current;
      if (state) commit(event.shiftKey ? redo(state) : undo(state));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit]);

  const open = useCallback(
    (next: ProofState, message?: Notice) => {
      commit(next);
      setSelectedRule(null);
      setNotice(message ?? null);
    },
    [commit],
  );

  /**
   * Go where the fragment says, at mount and whenever it changes.
   *
   * Listening for `hashchange` rather than only reading once is what makes the
   * back button work: returning to a challenge is the same event as arriving at
   * it. The fragment is browser-only, so the first run happens after mount.
   */
  useEffect(() => {
    const go = () => {
      const fragment = arrivalFragment();
      const target = parseLocation(fragment);
      setDestination(target);

      // An arrival the router overwrote leaves the address bar disagreeing with
      // the screen, which would make Share copy the wrong link and the back
      // button leave from the wrong place. Put it back.
      if (window.location.hash !== fragment) {
        window.history.replaceState(null, '', locationHash(target));
      }

      const current = proofRef.current;

      if (target.view === 'shared') {
        setBriefingOpen(false);
        try {
          const shared = proofFromHash(target.fragment);
          if (shared) open(shared, { tone: 'ok', text: 'Opened the proof from this link.' });
        } catch (error) {
          setNotice({ tone: 'error', text: `That link did not open: ${(error as Error).message}` });
          // A link that will not open should not strand the learner on an empty
          // proof screen; the menu is somewhere to go from.
          setDestination(MENU);
        }
        return;
      }

      // Leaving a free proof: keep it, so that coming back does not discard
      // work the learner did not ask to throw away.
      if (current && current.challenge === FREE_CHALLENGE_ID && target.view !== 'free') {
        lastFreeProof.current = current;
      }

      if (target.view === 'free') {
        setBriefingOpen(false);
        // Already here: switching views must never restart the proof.
        if (current?.challenge === FREE_CHALLENGE_ID) return;
        open(
          lastFreeProof.current ??
            createProof(
              freeSetup(
                parseSubject(DEFAULT_FREE_START),
                exactGoal(parseSubject(DEFAULT_FREE_GOAL)),
              ),
            ),
        );
        return;
      }

      if (target.view === 'challenge') {
        if (current?.challenge === target.id) return;
        const found = challengeById(target.id);
        if (!found) {
          // A fragment naming a challenge that does not exist — mistyped, or
          // saved from a course that has since been renumbered — must not
          // leave whatever proof happened to be loaded sitting there under a
          // heading it does not belong to. As with a link that will not open,
          // the menu is somewhere to go from.
          setDestination(MENU);
          return;
        }
        setBriefingOpen(true);

        /*
         * A link opens whatever it names, even something the menu still has
         * locked. Somebody meant to send it — a teacher pointing a class at one
         * problem, or a learner returning to a bookmark — and refusing would
         * make challenges unlinkable, which is the one thing the menu shell was
         * built to guarantee. The order is still worth saying out loud, so the
         * learner knows they are ahead of it rather than lost.
         */
        const ahead = !isUnlocked(progressRef.current, target.id);
        const before = found.requires ? challengeById(found.requires) : undefined;
        open(
          createProof(challengeSetup(found)),
          ahead && before
            ? {
                tone: 'ok',
                text: `You have jumped ahead: this one normally opens once "${before.title}" is done.`,
              }
            : null,
        );
      }
    };

    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
    // `open` is stable and the proof is read through a ref, so this subscribes once.
  }, [open]);

  /**
   * Navigate by setting the fragment, so that every arrival — a click, the back
   * button, a pasted link — runs through the same handler. Re-selecting where
   * you already are fires no event, so that case is applied directly.
   */
  const navigate = useCallback((target: Destination) => {
    const hash = locationHash(target);
    if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = hash;
  }, []);

  /**
   * Show a proof the app has just built, without going back through the
   * fragment handler.
   *
   * That handler decides whether to *build* a proof from the destination, and
   * it reads the current one through a ref that is only refreshed after a
   * render. Routing a freshly built proof through it would risk it being
   * rebuilt from the challenge and the new one discarded. The fragment is still
   * updated, so the address bar and the back button stay honest — it simply
   * replaces the current entry rather than announcing a move.
   */
  const showProof = useCallback((target: Destination) => {
    setDestination(target);
    window.history.replaceState(null, '', locationHash(target));
  }, []);

  /**
   * Arriving somewhere should land the learner on it, rather than leaving focus
   * on a control that is no longer rendered.
   *
   * `menuRef` is on the heading of whichever of the two non-proof screens is
   * showing — the menu, or a proof being read back — so one effect covers both
   * arrivals. The proof screen is left alone: it moves focus itself, to the
   * next thing there is to act on. And nothing fires on first load, because
   * focusing a heading for somebody who has not pressed anything would announce
   * a move they did not make.
   */
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view && view !== 'proof') {
      menuRef.current?.focus({ preventScroll: true });
    }
    previousView.current = view;
  }, [view]);

  const previousBriefing = useRef(false);
  useEffect(() => {
    if (view !== 'proof' || !challenge) return;
    if (briefingOpen) briefingRef.current?.focus({ preventScroll: true });
    else if (previousBriefing.current) currentRef.current?.focus({ preventScroll: true });
    previousBriefing.current = briefingOpen;
  }, [briefingOpen, challenge, view]);

  const apply = useCallback(
    ({ address }: ApplyRequest) => {
      if (!selectedRule || !rule) return;
      const argument =
        rule.needsTerm && insertParse.ok && insertParse.subject.kind === 'expression'
          ? { term: insertParse.subject.term, ...(inverseFirst ? { inverseFirst: true } : {}) }
          : undefined;

      try {
        const next = applyRule(proof, selectedRule, address, argument);
        moved.current = true;
        commit(next);
        setNotice(null);
      } catch (error) {
        setNotice({ tone: 'error', text: (error as Error).message });
      }
    },
    [commit, insertParse, inverseFirst, proof, rule, selectedRule],
  );

  /**
   * Take the move a level-three hint is offering. It goes through exactly the
   * same path a clicked bracket does, so a hinted step is an ordinary step: it
   * is recorded, it counts, and it can be undone.
   */
  const takeHint = useCallback(
    (offer: { rule: AnyRuleId; address: Address; argument?: RuleArgument }) => {
      try {
        const next = applyRule(proof, offer.rule, offer.address, offer.argument);
        moved.current = true;
        commit(next);
        setSelectedRule(offer.rule);
        setNotice(null);
      } catch (error) {
        setNotice({ tone: 'error', text: (error as Error).message });
      }
    },
    [commit, proof],
  );

  /** Step back to the last line that is on the route the hints know. */
  const rejoinRoute = useCallback(() => {
    const depth = rejoinDepth(proof);
    if (depth === null || depth === 0) return;
    let back = proof;
    for (let count = 0; count < depth; count += 1) back = undo(back);
    commit(back);
  }, [commit, proof]);

  const resetProgress = useCallback(() => {
    const cleared = emptyProgress();
    setProgress(cleared);
    setDiscarded([]);
    if (clearProgress()) {
      setStorageFailed(false);
      setNotice({ tone: 'ok', text: 'Progress on this device has been cleared.' });
    } else {
      setStorageFailed(true);
      setNotice({
        tone: 'error',
        text: 'The course is reset for now, but this browser would not remove the saved copy. It may return after a reload.',
      });
    }
  }, []);

  const startFree = () => {
    const start = tryParseSubject(freeStart, 'expression');
    if (!start.ok) {
      setNotice({ tone: 'error', text: `Start: ${start.message}` });
      return;
    }
    const trimmedGoal = freeGoal.trim();
    let goal: Subject | null = null;
    if (trimmedGoal.length > 0) {
      const parsedGoal = tryParseSubject(trimmedGoal, 'goal');
      if (!parsedGoal.ok) {
        setNotice({ tone: 'error', text: `Goal: ${parsedGoal.message}` });
        return;
      }
      goal = parsedGoal.subject;
    }
    // An equation may not be proved equal to an expression, and the reverse.
    if (goal && goal.kind !== start.subject.kind) {
      setNotice({
        tone: 'error',
        text: 'Start and goal must both be expressions, or both equations.',
      });
      return;
    }
    open(createProof(freeSetup(start.subject, goal ? exactGoal(goal) : null)), {
      tone: 'ok',
      text: 'Free exploration ready.',
    });
    setBriefingOpen(false);
    showProof({ view: 'free' });
  };

  const copy = async (label: string, makeText: () => string) => {
    let text: string;
    try {
      text = makeText();
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ tone: 'ok', text: `${label} copied to the clipboard.` });
    } catch {
      setNotice({ tone: 'error', text: `Could not copy the ${label.toLowerCase()}.` });
    }
  };

  const copyLink = () => {
    const hash = proofToHash(proof);
    if (!hash) {
      setNotice({
        tone: 'error',
        text: 'This proof is too long for a link. Copy the proof record instead.',
      });
      return;
    }
    void copy('Link', () => `${window.location.origin}${window.location.pathname}${hash}`);
  };

  /**
   * Importing happens on the menu, so a record that checks out has to take the
   * learner to the proof it describes; leaving them on the menu with a success
   * message and nothing to look at would be a dead end. A record that does not
   * check out leaves them where they are, with the reason.
   */
  const runImport = () => {
    let imported: ProofState;
    try {
      imported = importProof(importText);
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
      return;
    }
    open(imported, { tone: 'ok', text: 'Proof imported and replayed.' });
    setBriefingOpen(false);
    setImportText('');
    showProof(
      imported.challenge === FREE_CHALLENGE_ID
        ? { view: 'free' }
        : { view: 'challenge', id: imported.challenge },
    );
  };

  const permitted = ALL_RULES.filter((entry) => ruleAllowed(proof, entry.id));
  const purposeGroups = LAW_PURPOSES.map((purpose) => ({
    ...purpose,
    entries: purpose.rules
      .map((id) => permitted.find((entry) => entry.id === id))
      .filter((entry): entry is AnyRuleDefinition => entry !== undefined),
  })).filter((purpose) => purpose.entries.length > 0);

  return (
    <main className={`app-shell is-${view}`}>
      {view === 'menu' ? (
        <MenuScreen
          discarded={discarded}
          freeGoal={freeGoal}
          freeStart={freeStart}
          helpOpen={destination.view === 'help'}
          importText={importText}
          menuRef={menuRef}
          navigate={navigate}
          notice={notice}
          onCopyProgress={() => copy('Progress', () => progressToJson(progress))}
          onImport={runImport}
          onReset={resetProgress}
          onStartFree={startFree}
          progress={progress}
          setFreeGoal={setFreeGoal}
          setFreeStart={setFreeStart}
          setImportText={setImportText}
          storageFailed={storageFailed}
        />
      ) : view === 'reading' ? (
        <ReadingScreen
          challenge={readingChallenge}
          menuRef={menuRef}
          navigate={navigate}
          state={recordedProof}
        />
      ) : (
      <>
      <header className="topbar">
        <div className="topbar-lead">
          <button
            className="tool-button is-back"
            type="button"
            onClick={() => navigate(MENU)}
          >
            Menu
          </button>
          <div>
            <p className="eyebrow">{challenge ? `Challenge ${challenge.label}` : 'Free exploration'}</p>
            <h1>{challenge?.title ?? 'Your own expression'}</h1>
          </div>
        </div>
        {(!briefingOpen || !challenge) && (
        <div className="top-actions" aria-label="Proof controls">
          <button
            className="tool-button"
            type="button"
            onClick={() => commit(undo(proof))}
            disabled={!canUndo(proof)}
          >
            Undo
          </button>
          <button
            className="tool-button"
            type="button"
            onClick={() => commit(redo(proof))}
            disabled={!canRedo(proof)}
          >
            Redo
          </button>
          <button className="tool-button" type="button" onClick={() => open(restart(proof))}>
            Restart
          </button>
          {/* Only where there is a worked route to draw a hint from. Free
              exploration has no intended answer, so offering a control that
              could only ever decline would be worse than not offering it. */}
          {challenge && !complete && (
            <button
              className="tool-button is-hint"
              type="button"
              aria-expanded={hintLevel > 0}
              onClick={() => setHintLevel((level) => (level === 0 ? 1 : 0))}
            >
              {hintLevel > 0 ? 'Hide hint' : 'Hint'}
            </button>
          )}
          <button
            aria-expanded={shareOpen}
            className="tool-button"
            type="button"
            onClick={() => setShareOpen((value) => !value)}
          >
            Share
          </button>
          {challenge && !complete && (
            <button className="tool-button" type="button" onClick={() => setBriefingOpen(true)}>
              Briefing
            </button>
          )}
        </div>
        )}
      </header>

      {notice && (
        <p className={`notice is-${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}

      {briefingOpen && challenge ? (
        <ChallengeBriefing
          challenge={challenge}
          chapter={challengeChapter}
          goal={proof.goal}
          headingRef={briefingRef}
          onBegin={() => setBriefingOpen(false)}
          start={proof.start}
        />
      ) : (
      <>
      <section className="challenge-banner" aria-labelledby="challenge-title">
        <div className="challenge-number">{challenge?.label ?? '··'}</div>
        <div className="challenge-copy">
          <h2 id="challenge-title">
            {proof.goal?.kind === 'exact' ? (
              <>
                Reach <Typeset tex={goalTex(proof.goal)} speech={goalSpeech(proof.goal)} />
              </>
            ) : (
              goalProse(proof.goal ?? null)
            )}
          </h2>
        </div>
        <div className={`status-pill ${complete ? 'is-complete' : ''}`} role="status">
          <span className="status-dot" />
          {complete ? `Complete in ${steps(stepCount(proof))}` : steps(stepCount(proof))}
        </div>
      </section>

      {shareOpen && (
        <section className="share-card" aria-label="Export this proof">
          <div className="share-actions">
            <button className="tool-button" type="button" onClick={() => copy('Proof record', () => proofToJson(proof))}>
              Copy proof record
            </button>
            <button className="tool-button" type="button" onClick={() => copy('LaTeX', () => proofToLatex(proof))}>
              Copy LaTeX
            </button>
            <button className="tool-button" type="button" onClick={copyLink}>
              Copy link
            </button>
          </div>
          <p className="share-note">
            The record and the link contain every step, so anyone opening them sees the same proof.
          </p>
        </section>
      )}

      {hint && challenge && (
        <section className="hint-card" aria-labelledby="hint-heading">
          <p className="eyebrow" id="hint-heading">
            {hint.kind === 'step' ? `Hint ${hint.level} of ${MAX_HINT_LEVEL}` : 'Hint'}
          </p>
          {/* Polite rather than assertive: a hint is something the learner
              asked for and is already looking at, not an interruption. */}
          <p className="hint-text" aria-live="polite">
            {hint.text}
          </p>

          {hint.kind === 'diverged' && routeOpen && (
            <div className="hint-route">
              <p className="hint-route-lead">
                The route this app knows, from the beginning. Yours may still be shorter.
              </p>
              <RecordedProof state={referenceProof} />
            </div>
          )}

          <div className="hint-actions">
            {hint.kind === 'step' && hint.more && (
              <button
                className="tool-button"
                type="button"
                onClick={() => setHintLevel((level) => level + 1)}
              >
                Tell me more
              </button>
            )}
            {hint.kind === 'step' && hint.offer && (
              <button className="tool-button" type="button" onClick={() => takeHint(hint.offer!)}>
                Take this step
              </button>
            )}
            {hint.kind === 'diverged' && (
              <>
                <button
                  aria-expanded={routeOpen}
                  className="tool-button"
                  type="button"
                  onClick={() => setRouteOpen((open) => !open)}
                >
                  {routeOpen ? 'Hide the route I know' : 'Show the route I know'}
                </button>
                {hint.canRejoin && rejoinDepth(proof) !== null && (
                  <button className="tool-button" type="button" onClick={rejoinRoute}>
                    Step back onto it
                  </button>
                )}
              </>
            )}
            <button className="tool-button" type="button" onClick={() => setHintLevel(0)}>
              Hide
            </button>
          </div>
        </section>
      )}

      <div className="workspace">
        <section className="proof-card" aria-labelledby="proof-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Proof sheet</p>
              {/* An expression chain is joined by equality; an equation chain
                  by equivalence. The heading says which is being built. */}
              <h2 id="proof-heading">
                {proof.start.kind === 'equation'
                  ? 'Build a chain of equivalences'
                  : 'Build an equality chain'}
              </h2>
            </div>
            <button
              className="reason-toggle"
              type="button"
              aria-pressed={reasonsOpen}
              onClick={() => setReasonsOpen((value) => !value)}
            >
              {reasonsOpen ? 'Hide reasons' : 'Show reasons'}
            </button>
          </div>

          <div className="proof-paper">
            <div className="proof-lines">
              {visibleLines(proof).map((entry, index) => {
                const isCurrent = index === stepCount(proof);
                return (
                  <div
                    className={`proof-line ${isCurrent ? 'is-current' : ''}`}
                    key={index}
                    ref={isCurrent ? currentRef : undefined}
                    tabIndex={isCurrent ? -1 : undefined}
                  >
                    <span className="relation" aria-hidden="true">
                      {/* A chain of expressions is joined by equality; a chain
                          of equations by equivalence, because each line is a
                          statement rather than a quantity. */}
                      {index === 0 ? '' : entry.subject.kind === 'equation' ? '\u21d4' : '='}
                    </span>
                    <ProofLineView
                      subject={entry.subject}
                      detail={entry.step?.detail}
                      reason={reasonsOpen ? entry.step?.reason : undefined}
                      interactive={
                        isCurrent && !complete && rule ? (
                          <InteractiveSubject
                            addresses={addresses}
                            blocked={blocked}
                            firstTargetRef={firstTargetRef}
                            key={`${stepCount(proof)}-${selectedRule}`}
                            layout={layout}
                            onApply={apply}
                            rule={rule}
                            subject={entry.subject}
                          />
                        ) : null
                      }
                    />
                  </div>
                );
              })}
            </div>

            <p aria-live="polite" className="sr-only">
              {complete
                ? `Complete. ${subjectSpeech(line.subject)} in ${steps(stepCount(proof))}.`
                : rule
                  ? `${subjectSpeech(line.subject)}. ${addresses.length} ${
                      addresses.length === 1 ? 'place' : 'places'
                    } for ${rule.name}.`
                  : `${subjectSpeech(line.subject)}. No law selected.`}
            </p>

            {/* Carries the ruling on below the last written line. */}
            <div className="paper-rest">
              {complete ? (
                <div className="success-note" ref={successRef} tabIndex={-1}>
                  <span className="success-mark" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <strong>
                      {line.subject.kind === 'equation' ? 'Equation solved' : 'Expression simplified'}
                    </strong>
                    <span>Every step was justified by a law.</span>
                    {challenge && (
                      <span className="success-score">
                        {scoreLine(challenge, stepCount(proof), bestFor(progress, challenge.id)?.steps)}
                      </span>
                    )}
                    {/* The distinction is mathematical, not cosmetic: a
                        theorem was proved, while notation received a
                        definition chosen to make the surrounding laws work. */}
                    {challenge?.grants?.length ? (
                      <span className="success-earned">
                        Theorem proved:{' '}
                        {challenge.grants.map((granted) => anyRuleById(granted).name).join(' and ')}.
                        {' '}
                        {challenge.grants.length === 1 ? 'It is' : 'They are'} yours to use from here
                        on.
                      </span>
                    ) : null}
                    {challenge?.introduces?.length ? (
                      <span className="success-defined">
                        Definition introduced:{' '}
                        {challenge.introduces
                          .map((introducedRule) => anyRuleById(introducedRule).name)
                          .join(' and ')}.
                      </span>
                    ) : null}
                    {challenge && (
                      <span className="success-takeaway">
                        <strong>Takeaway:</strong> {challenge.takeaway}
                      </span>
                    )}
                    {challenge && (
                      <span className="success-actions">
                        {nextCourseChallenge && (
                          <button
                            className="tool-button is-primary"
                            type="button"
                            onClick={() =>
                              navigate({ view: 'challenge', id: nextCourseChallenge.id })
                            }
                          >
                            Next challenge
                          </button>
                        )}
                        <button
                          className="tool-button"
                          type="button"
                          onClick={() => {
                            setBriefingOpen(false);
                            open(restart(proof));
                          }}
                        >
                          Try a different proof
                        </button>
                        <button className="tool-button" type="button" onClick={() => navigate(MENU)}>
                          Course overview
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className={`selection-note ${rule ? '' : 'is-empty'}`}>
                  <span className="selection-swatch" aria-hidden="true" />
                  <div>
                    {rule ? (
                      <>
                        <strong>{rule.name}</strong>
                        <span>
                          {addresses.length
                            ? rule.scope === 'equation'
                              ? `${rule.description} It acts on the whole equation, not on a part of it.`
                              : `${rule.description} ${addresses.length} ${
                                  addresses.length === 1 ? 'place' : 'places'
                                } marked ${
                                  rule.attachesToGaps
                                    ? 'between the factors'
                                    : 'below the expression'
                                }.`
                            : rule.scope === 'equation'
                              ? `${rule.description} This line is an expression, not an equation, so there is nothing for it to act on.`
                              : `${rule.description} It is still a true law — there is just nowhere to use it here. Try another law.`}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>No law selected</strong>
                        <span>Choose the law that should move the proof forward. Its possible applications will then be marked on the current line.</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="rules-card" aria-labelledby="rules-heading" ref={dockRef}>
          <div className="rules-heading">
            <p className="eyebrow">Laws you may use here</p>
            <h2 id="rules-heading">Group laws</h2>
            <p>Choose a law. Every place it can be used is then marked.</p>
          </div>

          {rule?.needsTerm && (
            <div className="instantiation" aria-label="Term for this law">
              {/* Insertion asks for a term to place; multiplication asks for a
                  term to multiply by. The law says which, rather than the
                  interface assuming one of them. */}
              <label htmlFor="insert-field">{rule.termPrompt ?? 'Insert this term'}</label>
              <input
                id="insert-field"
                onChange={(event) => setInsertSource(event.target.value)}
                spellCheck={false}
                value={insertSource}
              />
              <FieldPreview source={insertSource} />
              {/* Only insertion has two orders to choose between. Multiplying an
                  equation already says which side it acts on, in the law. */}
              {rule.scope === 'term' && rule.usesOrder && (
                <label className="order-toggle">
                  <input
                    checked={inverseFirst}
                    onChange={(event) => setInverseFirst(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Inverse first (
                    <Typeset tex="x^{-1}x" speech="x inverse times x" />)
                  </span>
                </label>
              )}
            </div>
          )}

          {purposeGroups.map((purpose) => (
            <details
              className="rule-family purpose-group"
              key={purpose.id}
              open={selectedRule && purpose.rules.includes(selectedRule) ? true : undefined}
            >
              <summary>
                <span>
                  <strong>{purpose.label}</strong>
                  <span>{purpose.description}</span>
                </span>
                <span className="purpose-count">{purpose.entries.length}</span>
              </summary>
              <div className="rule-list">
                {purpose.entries.map((entry) => {
                    const count = complete ? 0 : findAddresses(line.subject, entry.id).length;
                    const active = selectedRule === entry.id;
                    // Where a derived law came from, so it never reads as
                    // something that was simply always true by decree.
                    const from = grantedBy(entry.id);
                    const definition = introducedBy(entry.id);
                    const provenance =
                      from && earned.has(entry.id)
                        ? `proved in challenge ${from.label}`
                        : definition && introduced.has(entry.id)
                          ? `defined in challenge ${definition.label}`
                          : null;
                    return (
                      <button
                        aria-label={`${entry.name}, ${describeReach(entry, count)}${
                          provenance ? `, ${provenance}` : ''
                        }`}
                        aria-pressed={active}
                        className={`rule-card ${active ? 'is-active' : ''}`}
                        key={entry.id}
                        onClick={() => setSelectedRule(entry.id)}
                        type="button"
                      >
                        <span className="rule-topline">
                          <span className="rule-name">{entry.name}</span>
                          <span className={`candidate-count ${count ? '' : 'is-zero'}`}>
                            {describeReach(entry, count)}
                          </span>
                        </span>
                        <span className="rule-formula">
                          <Typeset tex={entry.formula} speech={entry.spokenFormula} />
                        </span>
                        <span className="rule-description">{entry.description}</span>
                        {provenance && (
                          <span aria-hidden="true" className="rule-provenance">
                            {provenance}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </details>
          ))}

        </aside>
      </div>
      </>
      )}
      </>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Reading a proof back                                                */
/* ------------------------------------------------------------------ */

/**
 * A finished proof of your own, reopened.
 *
 * Deliberately a third screen rather than the workbench with its controls
 * hidden. There is nothing here to choose and nothing to apply, and a law dock
 * that could not be used would only invite the question of why not.
 */
function ReadingScreen({
  challenge,
  menuRef,
  navigate,
  state,
}: {
  challenge: Challenge | undefined;
  menuRef: React.RefObject<HTMLHeadingElement | null>;
  navigate: (destination: Destination) => void;
  state: ProofState | null;
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-lead">
          <button className="tool-button is-back" type="button" onClick={() => navigate(MENU)}>
            Menu
          </button>
          <div>
            <p className="eyebrow">
              {challenge ? `Your proof of challenge ${challenge.label}` : 'Your proof'}
            </p>
            <h1 ref={menuRef} tabIndex={-1}>
              {challenge?.title ?? 'A finished proof'}
            </h1>
          </div>
        </div>
        {challenge && (
          <div className="top-actions">
            <button
              className="tool-button"
              type="button"
              onClick={() => navigate({ view: 'challenge', id: challenge.id })}
            >
              Work it again
            </button>
          </div>
        )}
      </header>

      <section className="menu-card" aria-label="The proof you recorded">
        <p className="menu-lead">
          {state
            ? `Every step here was checked again just now, against the same laws that were available when you wrote it. ${steps(stepCount(state))}.`
            : 'There is no recorded proof of this challenge on this device.'}
        </p>
        <div className="proof-paper is-reading">
          <RecordedProof state={state} />
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The menu                                                            */
/* ------------------------------------------------------------------ */

/**
 * Where the app opens.
 *
 * Choosing what to work on, starting something of your own, replaying a proof
 * someone sent, and finding out how any of it works are all things you do
 * *before* a proof rather than during one. Keeping them here is what leaves the
 * proof sheet with only the proof, the laws, and the controls that act on it.
 */
function MenuScreen({
  discarded,
  freeGoal,
  freeStart,
  helpOpen,
  importText,
  menuRef,
  navigate,
  notice,
  onCopyProgress,
  onImport,
  onReset,
  onStartFree,
  progress,
  setFreeGoal,
  setFreeStart,
  setImportText,
  storageFailed,
}: {
  discarded: string[];
  freeGoal: string;
  freeStart: string;
  helpOpen: boolean;
  importText: string;
  menuRef: React.RefObject<HTMLHeadingElement | null>;
  navigate: (destination: Destination) => void;
  notice: Notice;
  onCopyProgress: () => void;
  onImport: () => void;
  onReset: () => void;
  onStartFree: () => void;
  progress: Progress;
  setFreeGoal: (value: string) => void;
  setFreeStart: (value: string) => void;
  setImportText: (value: string) => void;
  storageFailed: boolean;
}) {
  const done = completedCount(progress);
  const next = nextChallenge(progress);
  const laws = earnedRules(progress);
  const definitions = introducedRules(progress);
  const percent = Math.round((done / CHALLENGES.length) * 100);
  const activeChapter = COURSE_CHAPTERS.find((chapter) => chapter.id === next?.chapter);

  return (
    <>
      <header className="topbar is-menu">
        <div>
          <p className="eyebrow">Group Equation Explorer</p>
          <h1 ref={menuRef} tabIndex={-1}>
            Choose something to prove
          </h1>
          <p className="subtitle">
            Rewrite expressions and solve equations using nothing but the group laws.
          </p>
        </div>
      </header>

      {notice && (
        <p className={`notice is-${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}

      {discarded.length > 0 && (
        <p className="notice is-error" role="status">
          {discarded.length === 1 ? 'One saved proof' : `${discarded.length} saved proofs`} on this
          device no longer check out against the current laws, so they are no longer counted. You can
          work {discarded.length === 1 ? 'it' : 'them'} again.
        </p>
      )}

      <section className="course-spotlight" aria-labelledby="course-next-title">
        <div className="course-spotlight-copy">
          <p className="eyebrow">{next ? activeChapter?.label : 'Course complete'}</p>
          <h2 id="course-next-title">{next?.title ?? 'Every challenge proved'}</h2>
          <p>
            {next?.objective ??
              'You have built every proof in the course. Revisit a proof, beat one of the reference routes, or explore an equation of your own.'}
          </p>
          {next && (
            <button
              className="tool-button is-primary"
              type="button"
              onClick={() => navigate({ view: 'challenge', id: next.id })}
            >
              {done === 0 ? 'Start the course' : 'Continue the course'}
            </button>
          )}
        </div>
        <div className="course-progress" aria-label={`${done} of ${CHALLENGES.length} challenges proved`}>
          <div className="course-progress-number">
            <strong>{done}</strong>
            <span>of {CHALLENGES.length}</span>
          </div>
          <div className="course-progress-track" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p>{percent}% of the proof path complete</p>
        </div>
      </section>

      <section className="menu-card" aria-labelledby="challenges-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Course path</p>
            <h2 id="challenges-heading">Five chapters of group reasoning</h2>
          </div>
        </div>
        <p className="menu-lead">
          Each chapter moves from recognition to construction and then mixed practice. A locked
          problem always takes you to the earliest prerequisite still waiting.
        </p>
        <div className="chapter-list">
          {COURSE_CHAPTERS.map((chapter) => {
            const entries = CHALLENGES.filter((entry) => entry.chapter === chapter.id);
            const chapterDone = entries.filter((entry) =>
              isChallengeComplete(progress, entry.id),
            ).length;
            const current = activeChapter?.id === chapter.id;

            return (
              <details
                className="chapter-card"
                open={current || chapterDone === entries.length ? true : undefined}
                key={chapter.id}
              >
                <summary>
                  <span className="chapter-index" aria-hidden="true">
                    {chapterDone === entries.length ? '✓' : chapter.label.replace('Chapter ', '')}
                  </span>
                  <span className="chapter-copy">
                    <strong>{chapter.title}</strong>
                    <span>{chapter.description}</span>
                  </span>
                  <span className="chapter-count">{chapterDone}/{entries.length}</span>
                </summary>
                <p className="chapter-outcome">
                  <strong>By the end:</strong> {chapter.outcome}
                </p>
                <ul className="challenge-list">
                  {entries.map((entry) => {
                    const finished = isChallengeComplete(progress, entry.id);
                    const unlocked = isUnlocked(progress, entry.id);
                    const record = bestFor(progress, entry.id);
                    const rank = standing(progress, entry);
                    const needs = entry.requires ? challengeById(entry.requires) : undefined;
                    const required = requiredChallenge(progress, entry.id);
                    const state = finished
                      ? `Proved in ${steps(record!.steps)}.`
                      : unlocked
                        ? 'Not yet proved.'
                        : `Locked until "${needs?.title ?? 'the one before it'}" is proved.`;

                    return (
                      <li key={entry.id}>
                        <button
                          aria-label={`Challenge ${entry.label}: ${entry.title}. ${state} ${entry.blurb}`}
                          className={`challenge-entry ${finished ? 'is-done' : ''} ${
                            unlocked ? '' : 'is-locked'
                          }`}
                          type="button"
                          onClick={() =>
                            navigate({
                              view: 'challenge',
                              id: unlocked ? entry.id : (required?.id ?? entry.id),
                            })
                          }
                        >
                          <span className="challenge-entry-number" aria-hidden="true">
                            {finished ? '✓' : unlocked ? entry.label : '·'}
                          </span>
                          <span className="challenge-entry-copy">
                            <strong>{entry.title}</strong>
                            <span>{unlocked ? entry.objective : `Finish "${needs?.title}" first.`}</span>
                            {finished && (
                              <span className="challenge-entry-score" aria-hidden="true">
                                {steps(record!.steps)}
                                {rank === 'beaten'
                                  ? ' — shorter than expected'
                                  : rank === 'matched'
                                    ? ' — matches the expected length'
                                    : ` — expected ${benchmarkSteps(entry)}`}
                              </span>
                            )}
                          </span>
                        </button>
                        {finished && (
                          <button
                            className="challenge-entry-review"
                            type="button"
                            onClick={() => navigate({ view: 'best', id: entry.id })}
                          >
                            Read your proof
                            <span className="sr-only"> of {entry.title}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </section>

      <section className="menu-card" aria-labelledby="progress-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">This device</p>
            <h2 id="progress-heading">What you have established</h2>
          </div>
        </div>
        <p className="menu-lead">
          Progress is kept in this browser and nowhere else — not on a server, and not on your
          other devices. What is stored is the proofs themselves, so every one of them is checked
          again each time the app opens.
        </p>
        {laws.length === 0 && definitions.length === 0 ? (
          <p className="menu-lead">
            No laws earned yet. The first is the identity inverting to itself, in challenge 05.
          </p>
        ) : null}
        {definitions.length > 0 && (
          <>
            <h3 className="progress-subheading">Definitions introduced</h3>
            <ul className="earned-list">
              {definitions.map((law) => {
                const from = introducedBy(law);
                return (
                  <li className="earned-law is-definition" key={law}>
                    <strong>{anyRuleById(law).name}</strong>
                    <span>{from ? `defined in challenge ${from.label}` : 'introduced'}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {laws.length > 0 && (
          <>
            <h3 className="progress-subheading">Theorems proved</h3>
            <ul className="earned-list">
              {laws.map((law) => {
                const from = grantedBy(law);
                return (
                  <li className="earned-law" key={law}>
                    <strong>{anyRuleById(law).name}</strong>
                    <span>{from ? `proved in challenge ${from.label}` : 'proved'}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {storageFailed && (
          <p className="notice is-error" role="status">
            This browser would not let the app save. Your proof still works, but it will not be here
            when you come back — copy your progress if you need to keep it.
          </p>
        )}
        <div className="share-actions">
          <button
            className="tool-button"
            type="button"
            onClick={onCopyProgress}
            disabled={done === 0}
          >
            Copy progress
          </button>
          <button className="tool-button" type="button" onClick={onReset} disabled={done === 0}>
            Clear progress
          </button>
        </div>
      </section>

      <section className="menu-card" aria-labelledby="free-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Free exploration</p>
            {/* Deliberately not "Start from …": that is the field's label just
                below, and the two would be indistinguishable by name. */}
            <h2 id="free-heading">Your own expression</h2>
          </div>
        </div>
        <p className="menu-lead">Every law is available here, and a target is optional.</p>
        <div className="free-fields">
          <div className="free-field">
            <label htmlFor="free-start">Start from</label>
            <input
              id="free-start"
              onChange={(event) => setFreeStart(event.target.value)}
              spellCheck={false}
              value={freeStart}
            />
            <FieldPreview source={freeStart} />
          </div>
          <div className="free-field">
            <label htmlFor="free-goal">Goal (optional)</label>
            <input
              id="free-goal"
              onChange={(event) => setFreeGoal(event.target.value)}
              spellCheck={false}
              value={freeGoal}
            />
            <FieldPreview source={freeGoal} allowEmpty />
          </div>
        </div>
        <button className="tool-button" type="button" onClick={onStartFree}>
          Start
        </button>
        <p className="free-note">
          Write products by juxtaposition: <code>ab</code>, <code>(ab)^-1 c</code>,{' '}
          <code>a^3</code>, <code>r2 s</code>. A generator is one letter and any digits;{' '}
          <code>e</code> is the identity. One <code>=</code> makes it an equation.
        </p>
      </section>

      <section className="menu-card" aria-labelledby="replay-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">From someone else</p>
            <h2 id="replay-heading">Replay a shared proof</h2>
          </div>
        </div>
        <p className="menu-lead">
          Paste a proof record. Every step is checked before you see it, so a record that does not
          hold up is refused rather than shown.
        </p>
        <div className="share-import">
          <label className="sr-only" htmlFor="import-field">
            Paste a proof record to replay it
          </label>
          <textarea
            id="import-field"
            onChange={(event) => setImportText(event.target.value)}
            placeholder="Paste the exported proof record here"
            rows={3}
            value={importText}
          />
          <button
            className="tool-button"
            type="button"
            onClick={onImport}
            disabled={!importText.trim()}
          >
            Import and check
          </button>
        </div>
      </section>

      <section className="menu-card" aria-labelledby="help-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Help</p>
            <h2 id="help-heading">How this works</h2>
          </div>
          <button
            aria-expanded={helpOpen}
            className="tool-button"
            type="button"
            onClick={() => navigate(helpOpen ? MENU : { view: 'help' })}
          >
            {helpOpen ? 'Hide' : 'Read it'}
          </button>
        </div>
        {helpOpen && <HelpText />}
      </section>
    </>
  );
}
