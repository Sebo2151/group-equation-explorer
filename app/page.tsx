'use client';

import { useMemo, useState } from 'react';
import katex from 'katex';
import {
  applyTransformation,
  cloneFactors,
  expressionTex,
  factorTex,
  findCandidates,
  RULES,
  START,
  type Factor,
  type RuleId,
} from './core';

type ProofLine = { factors: Factor[]; reason?: string; detail?: string };

function mathHtml(tex: string, displayMode = false) {
  return {
    __html: katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml',
    }),
  };
}

function RuleFormula({ tex }: { tex: string }) {
  return <span className="rule-formula" dangerouslySetInnerHTML={mathHtml(tex)} />;
}

function StaticExpression({ factors }: { factors: Factor[] }) {
  return <span className="static-math" dangerouslySetInnerHTML={mathHtml(expressionTex(factors))} />;
}

function InteractiveExpression({
  factors,
  rule,
  candidates,
  onApply,
}: {
  factors: Factor[];
  rule: RuleId;
  candidates: number[];
  onApply: (index: number) => void;
}) {
  const starts = new Set(candidates);
  const ends = new Set(rule === 'inverse' ? candidates.map((index) => index + 1) : []);

  return (
    <span className="interactive-expression" aria-label={`Current expression: ${expressionTex(factors)}`}>
      {factors.map((factor, index) => {
        const startsTarget = starts.has(index);
        const endsTarget = ends.has(index);
        const pairTex = rule === 'inverse' && factors[index + 1]
          ? `${factorTex(factor)}${factorTex(factors[index + 1])}`
          : factorTex(factor);

        return (
          <button
            className={`factor ${startsTarget ? 'target-start' : ''} ${endsTarget ? 'target-end' : ''}`}
            disabled={!startsTarget}
            key={`${factor.base}-${factor.inverse ? 'i' : 'n'}-${index}`}
            onClick={() => startsTarget && onApply(index)}
            type="button"
            aria-label={startsTarget ? `Apply selected rule to ${pairTex}` : factorTex(factor)}
          >
            <span dangerouslySetInnerHTML={mathHtml(factorTex(factor))} />
            {startsTarget && <span className="target-marker" aria-hidden="true">tap</span>}
          </button>
        );
      })}
    </span>
  );
}

export default function Home() {
  const [selectedRule, setSelectedRule] = useState<RuleId>('inverse');
  const [history, setHistory] = useState<ProofLine[]>([{ factors: cloneFactors(START) }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [reasonsOpen, setReasonsOpen] = useState(true);

  const current = history[historyIndex];
  const candidates = useMemo(
    () => findCandidates(current.factors, selectedRule),
    [current.factors, selectedRule],
  );
  const complete = expressionTex(current.factors) === 'b';

  function applyRule(index: number) {
    const line = applyTransformation(current.factors, selectedRule, index);

    const kept = history.slice(0, historyIndex + 1);
    setHistory([...kept, line]);
    setHistoryIndex(kept.length);
  }

  function reset() {
    setHistory([{ factors: cloneFactors(START) }]);
    setHistoryIndex(0);
    setSelectedRule('inverse');
  }

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
            onClick={() => setHistoryIndex((value) => Math.max(0, value - 1))}
            disabled={historyIndex === 0}
          >Undo</button>
          <button
            className="tool-button"
            type="button"
            onClick={() => setHistoryIndex((value) => Math.min(history.length - 1, value + 1))}
            disabled={historyIndex === history.length - 1}
          >Redo</button>
          <button className="tool-button" type="button" onClick={reset}>Restart</button>
        </div>
      </header>

      <section className="challenge-banner" aria-labelledby="challenge-title">
        <div className="challenge-number">01</div>
        <div className="challenge-copy">
          <p className="eyebrow">First steps · Expression chain</p>
          <h2 id="challenge-title">Simplify to <span dangerouslySetInnerHTML={mathHtml('b')} /></h2>
          <p>Choose a law, then tap one highlighted place where it applies.</p>
        </div>
        <div className={`status-pill ${complete ? 'is-complete' : ''}`} role="status">
          <span className="status-dot" />
          {complete ? 'Complete' : `${historyIndex} ${historyIndex === 1 ? 'step' : 'steps'}`}
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
            <div className="proof-lines" aria-live="polite">
              {history.slice(0, historyIndex + 1).map((line, index) => {
                const isCurrent = index === historyIndex;
                return (
                  <div className={`proof-line ${isCurrent ? 'is-current' : ''}`} key={index}>
                    <span className="relation" aria-hidden="true">{index === 0 ? '' : '='}</span>
                    <div className="expression-slot">
                      {isCurrent && !complete ? (
                        <InteractiveExpression
                          factors={line.factors}
                          rule={selectedRule}
                          candidates={candidates}
                          onApply={applyRule}
                        />
                      ) : <StaticExpression factors={line.factors} />}
                    </div>
                    {index > 0 && reasonsOpen && (
                      <button className="reason" type="button" title={line.detail}>{line.reason}</button>
                    )}
                  </div>
                );
              })}
            </div>

            {complete ? (
              <div className="success-note">
                <span className="success-mark" aria-hidden="true">✓</span>
                <div>
                  <strong>Expression simplified</strong>
                  <span>You reached the target with a justified chain.</span>
                </div>
              </div>
            ) : (
              <div className="selection-note">
                <span className="selection-swatch" aria-hidden="true" />
                {candidates.length
                  ? `${candidates.length} valid ${candidates.length === 1 ? 'place' : 'places'} highlighted for this law.`
                  : 'This law does not apply yet. Choose another law.'}
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
            {RULES.map((rule) => {
              const count = findCandidates(current.factors, rule.id).length;
              const active = selectedRule === rule.id;
              return (
                <button
                  className={`rule-card ${active ? 'is-active' : ''}`}
                  key={rule.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedRule(rule.id)}
                >
                  <span className="rule-topline">
                    <span className="rule-name">{rule.name}</span>
                    <span className={`candidate-count ${count ? '' : 'is-zero'}`}>
                      {count} {count === 1 ? 'place' : 'places'}
                    </span>
                  </span>
                  <RuleFormula tex={rule.formula} />
                  <span className="rule-description">{rule.description}</span>
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
