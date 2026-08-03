'use client';

/**
 * Renders a letter's stored HTML.
 *
 * A sandboxed iframe rather than dangerouslySetInnerHTML, for the reason the
 * email template preview gives: the body is HTML an administrator wrote, so
 * putting it in this document would run their script in the viewer's session.
 * Values interpolated into it were escaped server-side; the template around
 * them was not, and does not need to be.
 *
 * `window.print()` on the parent includes iframe content, so printing works
 * with no extra plumbing. The frame cannot self-size inside a sandbox — that
 * needs allow-scripts, which hands back everything the sandbox took — so it is
 * given a page's worth of height and print CSS of its own.
 */
export function LetterFrame({ html, className }: { html: string; className?: string }) {
  const doc = [
    '<!doctype html><meta charset="utf-8">',
    '<style>',
    'body{font:15px/1.7 Georgia,"Times New Roman",serif;margin:0;color:#111}',
    'p{margin:0 0 1em}',
    'strong{font-weight:600}',
    '@page{margin:20mm}',
    '@media print{body{font-size:12pt}}',
    '</style>',
    html,
  ].join('');

  return (
    <iframe
      title="Letter"
      sandbox=""
      srcDoc={doc}
      className={className ?? 'min-h-[240mm] w-full border-0 bg-white'}
    />
  );
}
