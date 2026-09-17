/** DOM helpers shared by AXI page.evaluate and unit tests. */

export function axLabel(el) {
  if (el == null || typeof el !== 'object') return '';
  const root = el.shadowRoot;
  const node = root?.querySelector('button, [role="button"], .score') ?? el;
  if (!node || typeof node.getAttribute !== 'function') return '';
  return (
    node.getAttribute('aria-label') ||
    node.getAttribute('title') ||
    String(node.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function clickAxTarget(el, kind) {
  if (!el) return false;
  const isScore =
    kind === 'score' ||
    (typeof el.getAttribute === 'function' && el.getAttribute('data-attentionx-score') != null);
  if (isScore) {
    const inner = el.shadowRoot?.querySelector('button.score, button, [role="button"]');
    if (inner && typeof inner.click === 'function') {
      inner.click();
      return true;
    }
  }
  if (typeof el.click === 'function') {
    el.click();
    return true;
  }
  return false;
}

export function mapXArticle(article, label = axLabel) {
  const href = article.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? '';
  const postId = href.match(/status\/(\d+)/)?.[1] ?? '';
  const handleHref =
    article
      .querySelector('[data-testid="User-Name"] a[href^="/"], [data-testid="UserName"] a[href^="/"]')
      ?.getAttribute('href') ?? '';
  const handle = handleHref.replace(/^\//, '').split('/')[0] ?? '';
  const chip =
    article.querySelector('[data-attentionx-chip="author"]') ??
    article.querySelector('[data-attentionx-chip]:not([data-attentionx-star])');
  const star = article.querySelector('[data-attentionx-star]');
  const score = article.querySelector('[data-attentionx-score]');
  return {
    handle,
    postId,
    chip: label(chip),
    star: label(star),
    score: score?.shadowRoot?.querySelector('.score')?.textContent?.trim() || label(score),
    tone: article.getAttribute('data-attentionx-author-tone') || '',
    postTone: article.getAttribute('data-attentionx-post-tone') || '',
  };
}

export function axDomPreamble() {
  return [axLabel.toString(), clickAxTarget.toString(), mapXArticle.toString()].join('\n');
}
