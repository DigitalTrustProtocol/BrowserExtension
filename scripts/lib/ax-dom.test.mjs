import { describe, expect, it, vi } from 'vitest';
import { axLabel, clickAxTarget, mapXArticle } from './ax-dom.mjs';

describe('axLabel', () => {
  it('returns empty string when the host is missing', () => {
    expect(axLabel(null)).toBe('');
    expect(axLabel(undefined)).toBe('');
  });

  it('reads aria-label from the shadow button', () => {
    const button = {
      getAttribute: (name) => (name === 'aria-label' ? 'Trust alice' : ''),
      textContent: '',
    };
    const host = { shadowRoot: { querySelector: () => button } };
    expect(axLabel(host)).toBe('Trust alice');
  });
});

describe('mapXArticle', () => {
  it('does not throw when an article has no chip, star, or score', () => {
    const article = {
      querySelector: () => null,
      closest: () => null,
      getAttribute: () => null,
    };
    expect(() => mapXArticle(article)).not.toThrow();
    expect(mapXArticle(article)).toMatchObject({
      handle: '',
      postId: '',
      chip: '',
      star: '',
      score: '',
    });
  });
});

describe('clickAxTarget', () => {
  it('clicks the inner score button, not the host', () => {
    const inner = { click: vi.fn() };
    const host = {
      click: vi.fn(),
      getAttribute: (name) => (name === 'data-attentionx-score' ? 'true' : null),
      shadowRoot: { querySelector: () => inner },
    };
    clickAxTarget(host, 'score');
    expect(inner.click).toHaveBeenCalledTimes(1);
    expect(host.click).not.toHaveBeenCalled();
  });

  it('clicks the host for chips (listeners live on the host)', () => {
    const host = {
      click: vi.fn(),
      getAttribute: () => null,
      shadowRoot: { querySelector: () => ({ click: vi.fn() }) },
    };
    clickAxTarget(host, 'chip');
    expect(host.click).toHaveBeenCalledTimes(1);
  });
});
