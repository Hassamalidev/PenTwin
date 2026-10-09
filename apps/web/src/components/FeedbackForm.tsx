'use client';

import { useState, type FormEvent } from 'react';
import { callWorker, WorkerProblem } from '../lib/worker';

const KINDS = {
  bad_output: 'The handwriting on the page looks wrong',
  bad_glyph: 'One letter looks wrong',
  bug: 'Something did not work',
  idea: 'An idea or a request',
  other: 'Something else',
} as const;

type Kind = keyof typeof KINDS;

/**
 * Where it happened and with which settings. Only these are sent with the words the
 * person types: never the document, a file name or the handwriting. The worker drops
 * anything else as well.
 */
export interface FeedbackContext {
  screen: 'editor' | 'sample' | 'account' | 'other';
  page?: number;
  pages?: number;
  style?: string;
  ink?: string;
  paper?: string;
}

/** The feedback form, and the "report a bad result" form in the editor. */
export function FeedbackForm({
  context,
  initialKind = 'other',
  heading = 'Tell us what you think',
}: {
  context: FeedbackContext;
  initialKind?: Kind;
  heading?: string;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [message, setMessage] = useState('');
  const [character, setCharacter] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setState('sending');
    setError(undefined);
    try {
      await callWorker('/feedback', {
        method: 'POST',
        auth: true,
        body: {
          kind,
          message,
          context: {
            ...context,
            ...(kind === 'bad_glyph' && character ? { character } : {}),
          },
        },
      });
      setState('sent');
      setMessage('');
    } catch (caught) {
      setState('idle');
      setError(
        caught instanceof WorkerProblem
          ? caught.message
          : 'That could not be sent. Please try again.',
      );
    }
  };

  if (state === 'sent') {
    return (
      <p className="notice" role="status" data-testid="feedback-sent">
        Thank you. A person reads every one of these.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} data-testid="feedback-form">
      <h3>{heading}</h3>
      <div className="field">
        <label>
          What is it about?
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
            data-testid="feedback-kind"
          >
            {Object.entries(KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === 'bad_glyph' && (
        <div className="field">
          <label>
            Which letter?
            <input
              type="text"
              maxLength={2}
              value={character}
              onChange={(event) => setCharacter([...event.target.value].slice(0, 1).join(''))}
              style={{ width: '4rem' }}
              data-testid="feedback-character"
            />
          </label>
        </div>
      )}
      <div className="field">
        <label>
          In your own words
          <textarea
            rows={3}
            required
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            data-testid="feedback-message"
          />
        </label>
        <p className="muted">
          Only what you type here is sent, with the page number and the style you chose. Your
          document and your handwriting are not.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={state === 'sending'} data-testid="feedback-send">
        {state === 'sending' ? 'Sending...' : 'Send'}
      </button>
    </form>
  );
}
