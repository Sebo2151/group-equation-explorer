'use client';

import katex from 'katex';
import { tryParseSubject } from './parse.ts';
import { subjectSpeech, subjectTex, type Subject } from './subject.ts';

/**
 * The single trusted KaTeX boundary for the interface.
 *
 * The visual layer is hidden from assistive technology; every public component
 * receives or derives a plain-language form instead of exposing TeX source.
 */
export function mathHtml(tex: string) {
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

export function Typeset({ tex, speech }: { tex: string; speech: string }) {
  return (
    <>
      <span aria-hidden="true" dangerouslySetInnerHTML={mathHtml(tex)} />
      <span className="sr-only">{speech}</span>
    </>
  );
}

/** A subject typeset as a single run, with no grid and no controls. */
export function StaticSubject({ subject }: { subject: Subject }) {
  return (
    <span className="static-math" role="math" aria-label={subjectSpeech(subject)}>
      <span aria-hidden="true" dangerouslySetInnerHTML={mathHtml(subjectTex(subject))} />
    </span>
  );
}

/** Live typeset feedback for a text field, or the reason it will not parse. */
export function FieldPreview({ source, allowEmpty = false }: { source: string; allowEmpty?: boolean }) {
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
