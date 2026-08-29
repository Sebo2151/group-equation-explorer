import type { RefObject } from 'react';
import type { Challenge, CourseChapter } from './challenges.ts';
import { goalProse, goalSpeech, goalTex, type Goal } from './goal.ts';
import { StaticSubject, Typeset } from './math-view.tsx';
import type { Subject } from './subject.ts';

export function ChallengeBriefing({
  challenge,
  chapter,
  goal,
  headingRef,
  onBegin,
  start,
}: {
  challenge: Challenge;
  chapter: CourseChapter | undefined;
  goal: Goal | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBegin: () => void;
  start: Subject;
}) {
  return (
    <section className="briefing-stage" aria-labelledby="briefing-title">
      <div className="briefing-card">
        <p className="eyebrow">
          {chapter ? `${chapter.label}: ${chapter.title}` : 'Course challenge'}
        </p>
        <p className="briefing-number">Challenge {challenge.label}</p>
        <h2 id="briefing-title" ref={headingRef} tabIndex={-1}>
          {challenge.title}
        </h2>
        <p className="briefing-objective">{challenge.objective}</p>

        <div className="briefing-route" aria-label="Starting point and goal">
          <div>
            <span>Start with</span>
            <StaticSubject subject={start} />
          </div>
          <span className="briefing-arrow" aria-hidden="true">→</span>
          <div>
            <span>Your goal</span>
            <strong>
              {goal?.kind === 'exact' ? (
                <Typeset tex={goalTex(goal)} speech={goalSpeech(goal)} />
              ) : (
                goalProse(goal)
              )}
            </strong>
          </div>
        </div>

        <div className="briefing-prompt">
          <span aria-hidden="true">?</span>
          <div>
            <strong>Think before you begin</strong>
            <p>{challenge.prompt}</p>
          </div>
        </div>

        <div className="briefing-actions">
          <button className="tool-button is-primary" type="button" onClick={onBegin}>
            Begin proof
          </button>
          <p>You can reopen this briefing from the proof controls.</p>
        </div>
      </div>
    </section>
  );
}
