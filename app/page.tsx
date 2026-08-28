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
  addressColumns,
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
  type Side,
  type Subject,
} from './subject.ts';
import {
  getNode,
  hostFactors,
  isGap,
  spanSpeech,
  spanTerms,
  termSpeech,
  termTex,
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

function sameSpan(left: Target, right: Target): boolean {
  return (
    left.path.join('.') === right.path.join('.') &&
    left.start === right.start &&
    left.end === right.end
  );
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

  const dockRef = useRef<HTMLElement | null>(null);
  const currentRef = useRef<HTMLDivElement | null>(null);
  const firstTargetRef = useRef<HTMLButtonElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);
  const lastFreeProof = useRef<ProofState | null>(null);

  const line = currentLine(proof);
  const complete = isComplete(proof);
  const rule = anyRuleById(selectedRule);
  const isFree = proof.challenge === FREE_CHALLENGE_ID;
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
      ? 'Name a term to insert first.'
      : insertParse.subject.kind === 'equation'
        ? 'Insert a term, not an equation.'
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
   * A shared link opens the proof it carries, or says why it could not. The
   * fragment is only readable in the browser and the server render must not
   * depend on it, so this is a one-shot read after mount rather than an
   * initial value.
   */
  useEffect(() => {
    if (!window.location.hash) return;
    try {
      const shared = proofFromHash(window.location.hash);
      // A one-shot read of browser-only state at mount. The server render must
      // not depend on the fragment, and there is nothing here to subscribe to,
      // so this is the case the rule cannot distinguish.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (shared) open(shared, { tone: 'ok', text: 'Opened the proof from this link.' });
    } catch (error) {
      setNotice({ tone: 'error', text: `That link did not open: ${(error as Error).message}` });
    }
    // Reading the fragment once at mount; `open` is stable.
  }, [open]);

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

  const chooseChallenge = (id: string) => {
    // Draft text is independent of the last successfully started proof. In
    // particular, leaving an invalid draft must not prevent reopening it.
    if (isFree) lastFreeProof.current = proof;
    if (id === FREE_CHALLENGE_ID) {
      open(lastFreeProof.current ?? createProof(freeSetup(
        parseSubject(DEFAULT_FREE_START), parseSubject(DEFAULT_FREE_GOAL),
      )));
      return;
    }
    const found = challengeById(id);
    if (found) open(createProof(challengeSetup(found)));
  };

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

  const runImport = () => {
    try {
      open(importProof(importText), { tone: 'ok', text: 'Proof imported and replayed.' });
      setImportText('');
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    }
  };

  const permitted = ALL_RULES.filter((entry) => ruleAllowed(proof, entry.id));
  const families = [...new Set(permitted.map((entry) => entry.family))];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Group Equation Explorer</p>
          <h1>One move. One reason. One proof.</h1>
          <p className="subtitle">
            Use the group axioms to rewrite expressions without skipping the thinking.
          </p>
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
          <div className="eyebrow">
            <label htmlFor="challenge-picker" className="sr-only">
              Choose a challenge
            </label>
            <select
              className="challenge-picker"
              id="challenge-picker"
              onChange={(event) => chooseChallenge(event.target.value)}
              value={proof.challenge}
            >
              {CHALLENGES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} · {entry.title}
                </option>
              ))}
              <option value={FREE_CHALLENGE_ID}>Free exploration</option>
            </select>
          </div>
          <h2 id="challenge-title">
            {proof.goal ? (
              <>
                Reach <Typeset tex={subjectTex(proof.goal)} speech={subjectSpeech(proof.goal)} />
              </>
            ) : (
              'Explore freely — there is no target'
            )}
          </h2>
          <p>{challenge?.blurb ?? 'Every law in the catalogue is available.'}</p>
        </div>
        <div className={`status-pill ${complete ? 'is-complete' : ''}`} role="status">
          <span className="status-dot" />
          {complete ? `Complete in ${steps(stepCount(proof))}` : steps(stepCount(proof))}
        </div>
      </section>

      {shareOpen && (
        <section className="share-card" aria-label="Export and import">
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
          <div className="share-import">
            <label htmlFor="import-field">Paste a proof record to replay it</label>
            <textarea
              id="import-field"
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{ "format": "group-equation-explorer/proof", … }'
              rows={3}
              value={importText}
            />
            <button className="tool-button" type="button" onClick={runImport} disabled={!importText.trim()}>
              Import and check
            </button>
          </div>
          <p className="share-note">
            An imported proof is replayed step by step against the same rules before it is shown.
            A record that does not check out is refused rather than displayed.
          </p>
        </section>
      )}

      {isFree && (
        <section className="free-card" aria-label="Free exploration">
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
          <button className="tool-button" type="button" onClick={startFree}>
            Start
          </button>
          <p className="free-note">
            Write products by juxtaposition: <code>ab</code>, <code>(ab)^-1 c</code>,{' '}
            <code>a^3</code>, <code>r2 s</code>. A generator is one letter and any digits;{' '}
            <code>e</code> is the identity.
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
              <h2 id="proof-heading">Build an equality chain</h2>
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
                    <strong>Expression simplified</strong>
                    <span>You reached the target with a justified chain.</span>
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
            <p className="eyebrow">Available in this challenge</p>
            <h2 id="rules-heading">Group laws</h2>
            <p>Select a law to reveal every legal target.</p>
          </div>

          {rule.needsTerm && (
            <div className="instantiation" aria-label="Term to insert">
              <label htmlFor="insert-field">Insert this term</label>
              <input
                id="insert-field"
                onChange={(event) => setInsertSource(event.target.value)}
                spellCheck={false}
                value={insertSource}
              />
              <FieldPreview source={insertSource} />
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

          <div className="phase-note">
            <span>Phase 3</span>
            <p>
              A line can now be an equation. Laws that rewrite part of a line mark their targets
              beneath it; laws that transform the statement as a whole are offered on the line
              itself.
            </p>
          </div>
        </aside>
      </div>

      <footer>
        <p>Built for learning group theory, one valid transformation at a time.</p>
      </footer>
    </main>
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
