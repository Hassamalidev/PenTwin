const STEPS = [
  { label: 'Write and photograph', href: '/sample' },
  { label: 'Check your letters', href: '/sample' },
  { label: 'Add your document', href: '/editor' },
  { label: 'Export', href: '/editor' },
];

/**
 * The whole way from a sheet of paper to a finished PDF, shown on both working pages, so
 * they read as one journey and not as two separate tools. `step` is the current one, 1 to 4.
 * Earlier steps stay links, so the way back is always there.
 */
export function Journey({ step, skipped = false }: { step: number; skipped?: boolean }) {
  return (
    <nav aria-label="Progress" data-testid="journey">
      <ol className="stepper">
        {STEPS.map(({ label, href }, index) => {
          const number = index + 1;
          // On the sample handwriting the first two steps are still there to do, not done.
          const passed = number < step;
          const open = passed && skipped && number <= 2;
          const state = open
            ? undefined
            : passed
              ? 'done'
              : number === step
                ? 'current'
                : undefined;
          const content = (
            <>
              <span className="stepper-number">{number}</span>
              {label}
            </>
          );
          return (
            <li
              key={label}
              className={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {passed ? <a href={href}>{content}</a> : content}
              {state === 'current' && <span className="stepper-of">Step {number} of 4</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
