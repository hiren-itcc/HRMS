import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Testing Library does not unmount between tests on its own outside of its own
// globals setup; without this, a query in one test can match a node the
// previous test left in the document.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/*
 * jsdom implements neither of these and Base UI reaches for both. Left
 * unstubbed, every component that measures itself throws on mount and the
 * failure looks like a bug in the component rather than a missing browser API.
 */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/*
 * Base UI's popups call `getAnimations()` when tearing down, to wait for exit
 * animations. jsdom has no Web Animations API, so without this a Select test
 * passes its assertions and then fails the run with an unhandled
 * "viewport.getAnimations is not a function" after the component unmounts.
 */
Element.prototype.getAnimations ??= () => [];

/*
 * jsdom has no layout, so it has none of the scrolling or pointer-capture APIs
 * either. The org chart scrolls a search hit into view and captures the pointer
 * while you drag to pan; without these, both throw and the failure reads like a
 * bug in the chart rather than a missing browser API.
 *
 * Stubs, not spies: nothing asserts on them. What they buy is that the code
 * under test can call these the way it does in a browser, rather than carrying
 * optional-call guards that exist purely for the test environment.
 */
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
