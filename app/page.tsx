'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import {
  CHALLENGES,
  challengeById,
  challengeSetup,
  FREE_CHALLENGE_ID,
  freeSetup,
} from './challenges.ts';
import {
  MENU,
  isProofDestination,
  locationHash,
  parseLocation,
  type Destination,
} from './navigation.ts';
import { parseSubject, tryParseSubject } from './parse.ts';
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
  proofFromHash,
  proofToHash,
  proofToJson,
  proofToLatex,
} from './serialize.ts';
import {
  sideTerm,
  subjectSpeech,
  subjectTex,
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
 * `output: 'html'` emits only KaTeX's visual layer, which KaTeX marks
 * aria-hidden. Every accessible name therefore comes from the spoken forms in
 * `term.ts` rather than from TeX source or duplicated MathML. `trust` and the
 * expansion limits are pinned explicitly so the policy is reviewable in one
 * place: parsed input now reaches this renderer, though only after
 * `GENERATOR_PATTERN` has restricted what a name may contain.
 */
function mathHtml(tex: string) {
  return {
    __html: katex.renderToString(tex, {
      displayMode: false,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      maxSize: 12,
      maxExpand: 100,
      output: 'html',
    }),
  };
}

function Typeset({ tex, speech }: { tex: string; speech: string }) {
  return (
    <>
      <span aria-hidden="true" dangerouslySetInnerHTML={mathHtml(tex)} />
      <span className="sr-only">{speech}</span>
    </>
  );
}

/** A subject typeset as a single run, with no grid and no controls. */
function StaticSubject({ subject }: { subject: Subject }) {
  return (
    <span className="static-math" role="math" aria-label={subjectSpeech(subject)}>
      <span aria-hidden="true" dangerouslySetInnerHTML={mathHtml(subjectTex(subject))} />
    </span>
  );
}

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

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

const FAMILY_LABEL: Record<string, string> = {
  identity: 'Identity',
  inverse: 'Inverses',
  power: 'Powers',
  equation: 'Whole equation',
};

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

export default function Home() {
  const [proof, setProof] = useState(() => createProof(challengeSetup(CHALLENGES[0])));
  const [selectedRule, setSelectedRule] = useState<AnyRuleId>(CHALLENGES[0].rules[0]);
  const [reasonsOpen, setReasonsOpen] = useState(true);
  const [insertSource, setInsertSource] = useState('a');
  const [inverseFirst, setInverseFirst] = useState(false);
  const [freeStart, setFreeStart] = useState(DEFAULT_FREE_START);
  const [freeGoal, setFreeGoal] = useState(DEFAULT_FREE_GOAL);
  const [importText, setImportText] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  /**
   * The app opens on the menu, so that is what the server renders. There is no
   * fragment on the server, and reading one during the render would make the
   * first paint depend on something the server cannot see.
   */
  const [destination, setDestination] = useState<Destination>(MENU);
  const view = isProofDestination(destination) ? 'proof' : 'menu';

  const dockRef = useRef<HTMLElement | null>(null);
  const currentRef = useRef<HTMLDivElement | null>(null);
  const firstTargetRef = useRef<HTMLButtonElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);
  const lastFreeProof = useRef<ProofState | null>(null);
  const menuRef = useRef<HTMLHeadingElement | null>(null);
  // Read by the fragment handler, which must not be torn down and rebuilt on
  // every step just to see the current proof.
  const proofRef = useRef<ProofState | null>(null);

  // Declared before the fragment handler so that it has already run when that
  // handler first fires, and kept out of the render body: a ref may not be
  // written while rendering.
  useEffect(() => {
    proofRef.current = proof;
  }, [proof]);

  const line = currentLine(proof);
  const complete = isComplete(proof);
  const rule = anyRuleById(selectedRule);
  const challenge = challengeById(proof.challenge);

  /**
   * Every place the selected law applies on this line, in reading order. The
   * counts, the spoken summary and the controls all come from this one list,
   * so they cannot disagree about how many options there are.
   */
  const addresses = useMemo(
    () => (complete ? [] : findAddresses(line.subject, selectedRule)),
    [complete, line.subject, selectedRule],
  );

  const layout = useMemo(() => layoutSubject(line.subject), [line.subject]);

  const insertParse = useMemo(() => tryParseSubject(insertSource, 'term'), [insertSource]);
  const blocked = rule.needsTerm
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditingText(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      setProof(event.shiftKey ? redo : undo);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = useCallback((next: ProofState, message?: Notice) => {
    setProof(next);
    setSelectedRule(next.ruleset[0]);
    setNotice(message ?? null);
  }, []);

  /**
   * Go where the fragment says, at mount and whenever it changes.
   *
   * Listening for `hashchange` rather than only reading once is what makes the
   * back button work: returning to a challenge is the same event as arriving at
   * it. The fragment is browser-only, so the first run happens after mount.
   */
  useEffect(() => {
    const go = () => {
      const target = parseLocation(window.location.hash);
      setDestination(target);

      const current = proofRef.current;

      if (target.view === 'shared') {
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
        // Already here: switching views must never restart the proof.
        if (current?.challenge === FREE_CHALLENGE_ID) return;
        open(
          lastFreeProof.current ??
            createProof(
              freeSetup(parseSubject(DEFAULT_FREE_START), parseSubject(DEFAULT_FREE_GOAL)),
            ),
        );
        return;
      }

      if (target.view === 'challenge') {
        if (current?.challenge === target.id) return;
        const found = challengeById(target.id);
        if (found) open(createProof(challengeSetup(found)));
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
   * Coming back to the menu should land the learner on it, rather than leaving
   * focus on a control that is no longer rendered. Only on the way back,
   * though: focusing the heading on first load would ring it for someone who
   * has not pressed anything.
   */
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current === 'proof' && view === 'menu') {
      menuRef.current?.focus({ preventScroll: true });
    }
    previousView.current = view;
  }, [view]);

  const apply = useCallback(
    ({ address }: ApplyRequest) => {
      const argument =
        rule.needsTerm && insertParse.ok && insertParse.subject.kind === 'expression'
          ? { term: insertParse.subject.term, ...(inverseFirst ? { inverseFirst: true } : {}) }
          : undefined;

      try {
        const next = applyRule(proof, selectedRule, address, argument);
        moved.current = true;
        setProof(next);
        setNotice(null);
      } catch (error) {
        setNotice({ tone: 'error', text: (error as Error).message });
      }
    },
    [insertParse, inverseFirst, proof, rule.needsTerm, selectedRule],
  );

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
    open(createProof(freeSetup(start.subject, goal)), {
      tone: 'ok',
      text: 'Free exploration ready.',
    });
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
    setImportText('');
    showProof(
      imported.challenge === FREE_CHALLENGE_ID
        ? { view: 'free' }
        : { view: 'challenge', id: imported.challenge },
    );
  };

  const permitted = ALL_RULES.filter((entry) => ruleAllowed(proof, entry.id));
  const families = [...new Set(permitted.map((entry) => entry.family))];

  return (
    <main className={`app-shell is-${view}`}>
      {view === 'menu' ? (
        <MenuScreen
          freeGoal={freeGoal}
          freeStart={freeStart}
          helpOpen={destination.view === 'help'}
          importText={importText}
          menuRef={menuRef}
          navigate={navigate}
          notice={notice}
          onImport={runImport}
          onStartFree={startFree}
          setFreeGoal={setFreeGoal}
          setFreeStart={setFreeStart}
          setImportText={setImportText}
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
        <div className="top-actions" aria-label="Proof controls">
          <button
            className="tool-button"
            type="button"
            onClick={() => setProof(undo)}
            disabled={!canUndo(proof)}
          >
            Undo
          </button>
          <button
            className="tool-button"
            type="button"
            onClick={() => setProof(redo)}
            disabled={!canRedo(proof)}
          >
            Redo
          </button>
          <button className="tool-button" type="button" onClick={() => open(restart(proof))}>
            Restart
          </button>
          <button
            aria-expanded={shareOpen}
            className="tool-button"
            type="button"
            onClick={() => setShareOpen((value) => !value)}
          >
            Share
          </button>
        </div>
      </header>

      <section className="challenge-banner" aria-labelledby="challenge-title">
        <div className="challenge-number">{challenge?.label ?? '··'}</div>
        <div className="challenge-copy">
          <h2 id="challenge-title">
            {proof.goal ? (
              <>
                Reach <Typeset tex={subjectTex(proof.goal)} speech={subjectSpeech(proof.goal)} />
              </>
            ) : (
              'No target. Rewrite it however you like.'
            )}
          </h2>
          <p>{challenge?.blurb ?? 'Every law is available.'}</p>
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

      {notice && (
        <p className={`notice is-${notice.tone}`} role="status">
          {notice.text}
        </p>
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
                        isCurrent && !complete ? (
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
                : `${subjectSpeech(line.subject)}. ${addresses.length} ${
                    addresses.length === 1 ? 'place' : 'places'
                  } for ${rule.name}.`}
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
                  </div>
                </div>
              ) : (
                <div className="selection-note">
                  <span className="selection-swatch" aria-hidden="true" />
                  <div>
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

          {rule.needsTerm && (
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

          {families.map((family) => (
            <div className="rule-family" key={family}>
              <p className="family-label">{FAMILY_LABEL[family] ?? family}</p>
              <div className="rule-list">
                {permitted
                  .filter((entry) => entry.family === family)
                  .map((entry) => {
                    const count = complete ? 0 : findAddresses(line.subject, entry.id).length;
                    const active = selectedRule === entry.id;
                    return (
                      <button
                        aria-label={`${entry.name}, ${describeReach(entry, count)}`}
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
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}

        </aside>
      </div>
      </>
      )}
    </main>
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
  freeGoal,
  freeStart,
  helpOpen,
  importText,
  menuRef,
  navigate,
  notice,
  onImport,
  onStartFree,
  setFreeGoal,
  setFreeStart,
  setImportText,
}: {
  freeGoal: string;
  freeStart: string;
  helpOpen: boolean;
  importText: string;
  menuRef: React.RefObject<HTMLHeadingElement | null>;
  navigate: (destination: Destination) => void;
  notice: Notice;
  onImport: () => void;
  onStartFree: () => void;
  setFreeGoal: (value: string) => void;
  setFreeStart: (value: string) => void;
  setImportText: (value: string) => void;
}) {
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

      <section className="menu-card" aria-labelledby="challenges-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Challenges</p>
            <h2 id="challenges-heading">Worked problems, in order</h2>
          </div>
        </div>
        <ul className="challenge-list">
          {CHALLENGES.map((entry) => (
            <li key={entry.id}>
              <button
                // The number is shown in the badge and read here, rather than
                // being printed twice in the title beside it.
                aria-label={`Challenge ${entry.label}: ${entry.title}. ${entry.blurb}`}
                className="challenge-entry"
                type="button"
                onClick={() => navigate({ view: 'challenge', id: entry.id })}
              >
                <span className="challenge-entry-number" aria-hidden="true">
                  {entry.label}
                </span>
                <span className="challenge-entry-copy">
                  <strong>{entry.title}</strong>
                  <span>{entry.blurb}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
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

/**
 * General orientation only: what the app is, what a step is, and how to write
 * an expression. How to do any particular challenge is the challenge's job.
 */
function HelpText() {
  return (
    <div className="help">
      <h3>What you are doing</h3>
      <p>
        You start from an expression or an equation and change it one step at a time. Every step
        has to be justified by a law that holds in every group, and the app will not let you make
        a move that is not. When a challenge sets a target, you are finished once your line
        matches it.
      </p>

      <h3>Making a step</h3>
      <ol>
        <li>Choose a law. Every place it can be used is then marked.</li>
        <li>Choose one of those places. A numbered bracket sits under the part it would rewrite.</li>
        <li>The new line joins the proof, labelled with the law that produced it.</li>
      </ol>
      <p>
        On an equation, some laws rewrite part of one side. Others act on the statement as a whole
        — multiplying both sides, or swapping them — and are offered on the line itself rather than
        under any part of it.
      </p>

      <h3>Writing an expression</h3>
      <p>
        Products are written by juxtaposition: <code>ab</code>, <code>a b</code> and <code>a*b</code>{' '}
        all mean the same thing. A generator is one letter and any digits, so <code>r2</code> is a
        single generator while <code>a^2</code> is a power. <code>e</code> is the identity. A
        repeated power needs parentheses: <code>(a^2)^3</code>. One <code>=</code> makes the line an
        equation.
      </p>

      <h3>Order matters</h3>
      <p>
        Nothing here assumes that <code>ab</code> and <code>ba</code> are the same. That is why
        multiplying an equation on the left and on the right are different moves, and why{' '}
        <code>(ab)^-1</code> is <code>b^-1 a^-1</code> rather than <code>a^-1 b^-1</code>.
      </p>

      <h3>Changing your mind</h3>
      <p>
        Undo and redo step back and forth through the proof; taking a different move after undoing
        replaces what came after. Restart returns to the first line. Nothing is timed and nothing is
        scored.
      </p>
    </div>
  );
}

/** Live typeset feedback for a text field, or the reason it will not parse. */
function FieldPreview({ source, allowEmpty = false }: { source: string; allowEmpty?: boolean }) {
  const trimmed = source.trim();
  if (allowEmpty && trimmed.length === 0) {
    return <span className="field-preview is-muted">No goal — explore freely.</span>;
  }

  const result = tryParseSubject(trimmed);
  if (!result.ok) {
    return (
      <span className="field-preview is-error" role="status">
        {result.message}
      </span>
    );
  }

  return (
    <span className="field-preview" role="status">
      <StaticSubject subject={result.subject} />
    </span>
  );
}
