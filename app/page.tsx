'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import {
  expressionSpeech,
  expressionTex,
  factorTex,
  findTargets,
  layerTargets,
  RULES,
  sameTarget,
  spanSpeech,
  START,
  targetContains,
  type Factor,
  type RuleDefinition,
  type RuleId,
  type Target,
} from './core.ts';
import {
  applyRule,
  canRedo,
  canUndo,
  createProof,
  currentLine,
  isComplete,
  redo,
  restart,
  stepCount,
  undo,
  visibleLines,
} from './proof.ts';

const GOAL: Factor[] = [{ base: 'b' }];

/**
 * `output: 'html'` emits only KaTeX's visual layer, which KaTeX marks
 * aria-hidden. Every accessible name therefore comes from the spoken forms in
 * `core.ts` rather than from TeX source or duplicated MathML. `trust` and the
 * expansion limits are pinned explicitly so that the policy is reviewable here
 * when parsed input eventually reaches this renderer.
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

function StaticExpression({ factors }: { factors: Factor[] }) {
  return (
    <span className="static-math" role="math" aria-label={expressionSpeech(factors)}>
      <span aria-hidden="true" dangerouslySetInnerHTML={mathHtml(expressionTex(factors))} />
    </span>
  );
}

/**
 * The expression and its candidate targets share one grid, so a bracket can
 * span exactly the columns of the factors it applies to without measuring
 * anything. Each candidate gets its own control: overlapping spans are stacked
 * into separate rows rather than collapsed onto the factor they share.
 */
function InteractiveExpression({
  factors,
  rule,
  targets,
  onApply,
  firstTargetRef,
}: {
  factors: Factor[];
  rule: RuleDefinition;
  targets: Target[];
  onApply: (target: Target) => void;
  firstTargetRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [active, setActive] = useState<Target | null>(null);

  // Numbering runs left to right across the expression, which is the order the
  // learner reads; the layer only decides which row the bracket is drawn on.
  const placements = useMemo(() => {
    const rows = layerTargets(targets);
    return [...targets]
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .map((target, index) => ({
        target,
        ordinal: index + 1,
        layer: rows.findIndex((row) => row.some((entry) => sameTarget(entry, target))),
      }));
  }, [targets]);

  const inActive = (index: number) => Boolean(active && targetContains(active, index));
  const inAny = (index: number) => targets.some((target) => targetContains(target, index));

  return (
    <span
      className="expression-stage"
      style={{ gridTemplateColumns: `repeat(${Math.max(factors.length, 1)}, auto)` }}
    >
      <span className="factor-row" role="math" aria-label={expressionSpeech(factors)}>
        {factors.map((factor, index) => (
          <span
            aria-hidden="true"
            className={`factor ${inAny(index) ? 'is-candidate' : ''} ${inActive(index) ? 'is-active' : ''}`}
            key={index}
            style={{ gridColumn: index + 1 }}
            dangerouslySetInnerHTML={mathHtml(factorTex(factor))}
          />
        ))}
      </span>

      {placements.map(({ target, ordinal, layer }) => (
        <button
          className={`target ${active && sameTarget(active, target) ? 'is-active' : ''}`}
          key={`${target.start}-${target.end}`}
          onBlur={() => setActive(null)}
          onClick={() => onApply(target)}
          onFocus={() => setActive(target)}
          onMouseEnter={() => setActive(target)}
          onMouseLeave={() => setActive(null)}
          ref={ordinal === 1 ? firstTargetRef : undefined}
          style={{ gridColumn: `${target.start + 1} / ${target.end + 2}`, gridRow: layer + 2 }}
          type="button"
          aria-label={`${rule.name} at ${spanSpeech(factors, target)}. Option ${ordinal} of ${targets.length}.`}
        >
          <span aria-hidden="true" className="target-bracket" />
          <span aria-hidden="true" className="target-label">{ordinal}</span>
        </button>
      ))}
    </span>
  );
}

function ProofLineView({
  factors,
  detail,
  reason,
  interactive,
}: {
  factors: Factor[];
  detail?: string;
  reason?: string;
  interactive: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="expression-slot">{interactive ?? <StaticExpression factors={factors} />}</div>
      {reason && (
        <div className="reason-slot">
          <button
            aria-expanded={open}
            className="reason"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {reason}
            <span aria-hidden="true" className="reason-caret">{open ? '−' : '+'}</span>
          </button>
          {open && <p className="reason-detail">{detail}</p>}
        </div>
      )}
    </>
  );
}

export default function Home() {
  const [selectedRule, setSelectedRule] = useState<RuleId>('inverse');
  const [proof, setProof] = useState(() => createProof(START));
  const [reasonsOpen, setReasonsOpen] = useState(true);

  const currentRef = useRef<HTMLDivElement | null>(null);
  const firstTargetRef = useRef<HTMLButtonElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);
  const moveCount = useRef(0);

  const line = currentLine(proof);
  const complete = isComplete(proof, GOAL);
  const rule = RULES.find((entry) => entry.id === selectedRule)!;
  const targets = useMemo(() => findTargets(line.factors, selectedRule), [line.factors, selectedRule]);

  // Keep the thing that just changed visible: on a narrow screen the rule dock
  // is sticky and would otherwise sit over it once the proof grows past the
  // fold. On the final move the success note sits below the line, so it — not
  // the line — is what has to clear the dock.
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
    if (moveCount.current === 0) return;
    moveCount.current = 0;
    (firstTargetRef.current ?? successRef.current ?? currentRef.current)?.focus();
  }, [proof, targets]);

  const apply = useCallback((target: Target) => {
    moveCount.current += 1;
    setProof((state) => applyRule(state, selectedRule, target));
  }, [selectedRule]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Group Equation Explorer</p>
          <h1>One move. One reason. One proof.</h1>
          <p className="subtitle">
            Use the group axioms to simplify expressions without skipping the thinking.
          </p>
        </div>
        <div className="top-actions" aria-label="Proof controls">
          <button
            className="tool-button"
            type="button"
            onClick={() => setProof(undo)}
            disabled={!canUndo(proof)}
          >Undo</button>
          <button
            className="tool-button"
            type="button"
            onClick={() => setProof(redo)}
            disabled={!canRedo(proof)}
          >Redo</button>
          <button
            className="tool-button"
            type="button"
            onClick={() => { setProof(restart); setSelectedRule('inverse'); }}
          >Restart</button>
        </div>
      </header>

      <section className="challenge-banner" aria-labelledby="challenge-title">
        <div className="challenge-number">01</div>
        <div className="challenge-copy">
          <p className="eyebrow">First steps · Expression chain</p>
          <h2 id="challenge-title">Simplify to <Typeset tex="b" speech="b" /></h2>
          <p>Choose a law, then tap a bracket under the expression where it applies.</p>
        </div>
        <div className={`status-pill ${complete ? 'is-complete' : ''}`} role="status">
          <span className="status-dot" />
          {complete
            ? `Complete in ${stepCount(proof)} steps`
            : `${stepCount(proof)} ${stepCount(proof) === 1 ? 'step' : 'steps'}`}
        </div>
      </section>

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
            >{reasonsOpen ? 'Hide reasons' : 'Show reasons'}</button>
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
                    <span className="relation" aria-hidden="true">{index === 0 ? '' : '='}</span>
                    <ProofLineView
                      factors={entry.factors}
                      detail={entry.step?.detail}
                      reason={reasonsOpen ? entry.step?.reason : undefined}
                      interactive={isCurrent && !complete ? (
                        <InteractiveExpression
                          factors={entry.factors}
                          key={`${stepCount(proof)}-${selectedRule}`}
                          firstTargetRef={firstTargetRef}
                          onApply={apply}
                          rule={rule}
                          targets={targets}
                        />
                      ) : null}
                    />
                  </div>
                );
              })}
            </div>

            <p aria-live="polite" className="sr-only">
              {complete
                ? `Complete. ${expressionSpeech(line.factors)} in ${stepCount(proof)} steps.`
                : `${expressionSpeech(line.factors)}. ${targets.length} ${targets.length === 1 ? 'place' : 'places'} for ${rule.name}.`}
            </p>

            {complete ? (
              <div className="success-note" ref={successRef} tabIndex={-1}>
                <span className="success-mark" aria-hidden="true">✓</span>
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
                      ? `${rule.description} ${targets.length} ${targets.length === 1 ? 'place' : 'places'} marked below the expression.`
                      : `${rule.description} It is still a true law — there is just nowhere to use it here. Try another law.`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="rules-card" aria-labelledby="rules-heading">
          <div className="rules-heading">
            <p className="eyebrow">Available now</p>
            <h2 id="rules-heading">Group laws</h2>
            <p>Select a law to reveal every legal target.</p>
          </div>

          <div className="rule-list">
            {RULES.map((entry) => {
              const count = findTargets(line.factors, entry.id).length;
              const active = selectedRule === entry.id;
              return (
                <button
                  className={`rule-card ${active ? 'is-active' : ''}`}
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedRule(entry.id)}
                  aria-label={`${entry.name}, ${count} ${count === 1 ? 'place' : 'places'}`}
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

          <div className="phase-note">
            <span>Phase 1</span>
            <p>Associativity is working quietly: products are read without unnecessary parentheses.</p>
          </div>
        </aside>
      </div>

      <footer><p>Built for learning group theory, one valid transformation at a time.</p></footer>
    </main>
  );
}
