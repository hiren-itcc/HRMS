import { escapeHtml, render, renderSubject, usedVariables } from './template-renderer';

describe('render', () => {
  it('substitutes a variable', () => {
    expect(render('Hello {{name}}', { name: 'Asha' })).toBe('Hello Asha');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(render('Hello {{  name  }}', { name: 'Asha' })).toBe('Hello Asha');
  });

  it('substitutes every occurrence', () => {
    expect(render('{{a}} and {{a}}', { a: 'x' })).toBe('x and x');
  });

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    expect(render('Hi {{missing}}', {})).toBe('Hi {{missing}}');
  });

  it('treats null and undefined as missing', () => {
    expect(render('{{a}}{{b}}', { a: null, b: undefined })).toBe('{{a}}{{b}}');
  });

  it('renders numbers', () => {
    expect(render('{{days}} days', { days: 3 })).toBe('3 days');
  });

  it('escapes HTML in values so a name cannot inject markup', () => {
    expect(render('<p>{{name}}</p>', { name: '<script>alert(1)</script>' })).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('escapes an ampersand in a name', () => {
    expect(render('{{name}}', { name: 'Smith & Co' })).toBe('Smith &amp; Co');
  });

  it('leaves the template markup itself untouched', () => {
    expect(render('<strong>{{a}}</strong>', { a: 'x' })).toBe('<strong>x</strong>');
  });

  it('encodes query separators in a URL, which is valid inside an href', () => {
    expect(render('{{url}}', { url: 'https://x.test/r?a=1&b=2' })).toBe(
      'https://x.test/r?a=1&amp;b=2',
    );
  });
});

describe('renderSubject', () => {
  it('does not escape — a subject line is plain text', () => {
    expect(renderSubject('Reset your {{org}} password', { org: 'Smith & Co' })).toBe(
      'Reset your Smith & Co password',
    );
  });
});

describe('escapeHtml', () => {
  it('covers the five significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('usedVariables', () => {
  it('lists placeholders once, in order', () => {
    expect(usedVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });

  it('returns nothing for a template with no placeholders', () => {
    expect(usedVariables('<p>Static</p>')).toEqual([]);
  });
});
