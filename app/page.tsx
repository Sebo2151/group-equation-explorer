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
import { tryParseTerm } from './parse.ts';
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
  columnCount,
  layoutTerm,
  placeTargets,
  tokenColumn,
  tokensInTarget,
  type Layout,
} from './render.ts';
import { findTargets, ruleById, RULES, type RuleDefinition, type RuleId } from './rules.ts';
import {
  importProof,
  proofFromHash,
  proofToHash,
  proofToJson,
  proofToLatex,
} from './serialize.ts';
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

function StaticExpression({ term }: { term: Term }) {
  return (
    <span className="static-math" role="math" aria-label={termSpeech(term)}>
      <span aria-hidden="true" dangerouslySetInnerHTML={mathHtml(termTex(term))} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The interactive line                                                */
/* ------------------------------------------------------------------ */

type ApplyRequest = { target: Target };

/**
 * The expression and its candidate controls share one grid, so a bracket spans
 * exactly the columns of the sub-expression it applies to without measuring
 * anything. Each candidate gets its own control: overlapping spans, and
 * insertion points that fall at the same place at different depths, are
 * stacked onto separate rows rather than collapsed together.
 */
function InteractiveExpression({
  term,
  layout,
  rule,
  targets,
  onApply,
  blocked,
  firstTargetRef,
}: {
  term: Term;
  layout: Layout;
  rule: RuleDefinition;
  targets: Target[];
  onApply: (request: ApplyRequest) => void;
  blocked: string | null;
  firstTargetRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [active, setActive] = useState<Target | null>(null);
  const stageRef = useRef<HTMLSpanElement | null>(null);

  const placements = useMemo(() => placeTargets(layout, targets), [layout, targets]);
  const highlighted = useMemo(
    () => (active ? tokensInTarget(layout, active) : new Set<number>()),
    [active, layout],
  );
  const candidates = useMemo(() => {
    const inside = new Set<number>();
    for (const { target } of placements) {
      for (const token of tokensInTarget(layout, target)) inside.add(token);
    }
    return inside;
  }, [layout, placements]);

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
    <span
      className="expression-stage"
      onKeyDown={onKeyDown}
      ref={stageRef}
      style={{ gridTemplateColumns: gridColumns(layout, rule.attachesToGaps) }}
    >
      <span className="factor-row" role="math" aria-label={termSpeech(term)}>
        {layout.tokens.map((token, index) => (
          <span
            aria-hidden="true"
            className={[
              'factor',
              `is-${token.kind}`,
              candidates.has(index) ? 'is-candidate' : '',
              highlighted.has(index) ? 'is-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={index}
            style={{ gridColumn: tokenColumn(index) }}
            dangerouslySetInnerHTML={mathHtml(token.tex)}
          />
        ))}
      </span>

      {placements.map(({ target, columns, ordinal, layer }) => (
        <button
          aria-label={describeTarget(term, rule, target, ordinal, placements.length)}
          className={`target ${isGap(target) ? 'is-insertion' : ''} ${
            active && sameSpan(active, target) ? 'is-active' : ''
          }`}
          disabled={blocked !== null}
          key={`${target.path.join('.')}:${target.start}:${target.end}`}
          onBlur={() => setActive(null)}
          onClick={() => onApply({ target })}
          onFocus={() => setActive(target)}
          onMouseEnter={() => setActive(target)}
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
  );
}

/** Insertion columns need real width only while an insertion rule is selected. */
function gridColumns(layout: Layout, forInsertion: boolean): string {
  const total = columnCount(layout);
  return Array.from({ length: total }, (_, index) =>
    index % 2 === 0 ? (forInsertion ? '18px' : '0') : 'auto',
  ).join(' ');
}

function sameSpan(left: Target, right: Target): boolean {
  return (
    left.path.join('.') === right.path.join('.') &&
    left.start === right.start &&
    left.end === right.end
  );
}

function describeTarget(
  term: Term,
  rule: RuleDefinition,
  target: Target,
  ordinal: number,
  total: number,
): string {
  const where = isGap(target)
    ? describeGap(term, target)
    : `at ${spanSpeech(spanTerms(term, target))}`;
  return `${rule.name} ${where}. Option ${ordinal} of ${total}.`;
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
  term,
  detail,
  reason,
  interactive,
}: {
  term: Term;
  detail?: string;
  reason?: string;
  interactive: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="expression-slot">{interactive ?? <StaticExpression term={term} />}</div>
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
};

type Notice = { tone: 'ok' | 'error'; text: string } | null;

function steps(count: number): string {
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

export default function Home() {
  const [proof, setProof] = useState(() => createProof(challengeSetup(CHALLENGES[0])));
  const [selectedRule, setSelectedRule] = useState<RuleId>(CHALLENGES[0].rules[0]);
  const [reasonsOpen, setReasonsOpen] = useState(true);
  const [insertSource, setInsertSource] = useState('a');
  const [inverseFirst, setInverseFirst] = useState(false);
  const [freeStart, setFreeStart] = useState('(ab)^-1 a b');
  const [freeGoal, setFreeGoal] = useState('e');
  const [importText, setImportText] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const dockRef = useRef<HTMLElement | null>(null);
  const currentRef = useRef<HTMLDivElement | null>(null);
  const firstTargetRef = useRef<HTMLButtonElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);

  const line = currentLine(proof);
  const complete = isComplete(proof);
  const rule = ruleById(selectedRule);
  const isFree = proof.challenge === FREE_CHALLENGE_ID;
  const challenge = challengeById(proof.challenge);

  const layout = useMemo(() => layoutTerm(line.term), [line.term]);
  const targets = useMemo(
    () => (complete ? [] : findTargets(line.term, selectedRule)),
    [complete, line.term, selectedRule],
  );

  const insertParse = useMemo(() => tryParseTerm(insertSource, 'term'), [insertSource]);
  const blocked = rule.needsTerm && !insertParse.ok ? 'Name a term to insert first.' : null;

  /**
   * The sticky dock's height depends on how many laws the challenge permits,
   * so the band reserved for it under the proof sheet cannot be a constant.
   * Measure the dock and publish it as `--dock-height`, which the narrow
   * layout uses for both padding and scroll margin.
   */
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const sync = () =>
      document.documentElement.style.setProperty(
        '--dock-height',
        `${Math.ceil(dock.getBoundingClientRect().height)}px`,
      );

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  // Keep whatever just changed visible: on a narrow screen the rule dock is
  // sticky and would otherwise sit over it once the proof grows past the fold.
  // On the final move the success note sits below the line, so it — not the
  // line — is what has to clear the dock.
  useEffect(() => {
    (successRef.current ?? currentRef.current)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [proof, complete]);

  // A committed move unmounts the control that was clicked, which drops focus
  // to <body>. Hand it to the next thing the learner would act on: the first
  // remaining target, the success note, or — when the selected law no longer
  // applies anywhere — the new line itself, so the chain is never lost.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (firstTargetRef.current ?? successRef.current ?? currentRef.current)?.focus();
  }, [proof, targets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
    ({ target }: ApplyRequest) => {
      const argument =
        rule.needsTerm && insertParse.ok
          ? { term: insertParse.term, ...(inverseFirst ? { inverseFirst: true } : {}) }
          : undefined;

      try {
        const next = applyRule(proof, selectedRule, target, argument);
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
    if (id === FREE_CHALLENGE_ID) {
      startFree();
      return;
    }
    const found = challengeById(id);
    if (found) open(createProof(challengeSetup(found)));
  };

  const startFree = () => {
    const start = tryParseTerm(freeStart, 'expression');
    if (!start.ok) {
      setNotice({ tone: 'error', text: `Start: ${start.message}` });
      return;
    }
    const trimmedGoal = freeGoal.trim();
    let goal: Term | null = null;
    if (trimmedGoal.length > 0) {
      const parsedGoal = tryParseTerm(trimmedGoal, 'goal');
      if (!parsedGoal.ok) {
        setNotice({ tone: 'error', text: `Goal: ${parsedGoal.message}` });
        return;
      }
      goal = parsedGoal.term;
    }
    open(createProof(freeSetup(start.term, goal)), { tone: 'ok', text: 'Free exploration ready.' });
  };

  const copy = async (label: string, text: string) => {
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
    void copy('Link', `${window.location.origin}${window.location.pathname}${hash}`);
  };

  const runImport = () => {
    try {
      open(importProof(importText), { tone: 'ok', text: 'Proof imported and replayed.' });
      setImportText('');
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    }
  };

  const permitted = RULES.filter((entry) => ruleAllowed(proof, entry.id));
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
                Reach <Typeset tex={termTex(proof.goal)} speech={termSpeech(proof.goal)} />
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
            <button className="tool-button" type="button" onClick={() => copy('Proof record', proofToJson(proof))}>
              Copy proof record
            </button>
            <button className="tool-button" type="button" onClick={() => copy('LaTeX', proofToLatex(proof))}>
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
                      {index === 0 ? '' : '='}
                    </span>
                    <ProofLineView
                      term={entry.term}
                      detail={entry.step?.detail}
                      reason={reasonsOpen ? entry.step?.reason : undefined}
                      interactive={
                        isCurrent && !complete ? (
                          <InteractiveExpression
                            blocked={blocked}
                            firstTargetRef={firstTargetRef}
                            key={`${stepCount(proof)}-${selectedRule}`}
                            layout={layout}
                            onApply={apply}
                            rule={rule}
                            targets={targets}
                            term={entry.term}
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
                ? `Complete. ${termSpeech(line.term)} in ${steps(stepCount(proof))}.`
                : `${termSpeech(line.term)}. ${targets.length} ${
                    targets.length === 1 ? 'place' : 'places'
                  } for ${rule.name}.`}
            </p>

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
                    {targets.length
                      ? `${rule.description} ${targets.length} ${
                          targets.length === 1 ? 'place' : 'places'
                        } marked ${rule.attachesToGaps ? 'between the factors' : 'below the expression'}.`
                      : `${rule.description} It is still a true law — there is just nowhere to use it here. Try another law.`}
                  </span>
                </div>
              </div>
            )}
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
                    const count = complete ? 0 : findTargets(line.term, entry.id).length;
                    const active = selectedRule === entry.id;
                    return (
                      <button
                        aria-label={`${entry.name}, ${count} ${count === 1 ? 'place' : 'places'}`}
                        aria-pressed={active}
                        className={`rule-card ${active ? 'is-active' : ''}`}
                        key={entry.id}
                        onClick={() => setSelectedRule(entry.id)}
                        type="button"
                      >
                        <span className="rule-topline">
                          <span className="rule-name">{entry.name}</span>
                          <span className={`candidate-count ${count ? '' : 'is-zero'}`}>
                            {count} {count === 1 ? 'place' : 'places'}
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
            <span>Phase 2</span>
            <p>
              Associativity is working quietly: products are read without unnecessary parentheses,
              and structure under an inverse or a power is kept.
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

  const result = tryParseTerm(trimmed);
  if (!result.ok) {
    return (
      <span className="field-preview is-error" role="status">
        {result.message}
      </span>
    );
  }

  return (
    <span className="field-preview" role="status">
      <StaticExpression term={result.term} />
    </span>
  );
}
