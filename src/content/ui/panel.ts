import type { ArticleTargets } from '../types'
import { TrustCard } from './trust-card'

const HOST_ATTR = 'data-attentionx-host'

export interface DebugPanel {
  update(targets: ArticleTargets): void
  destroy(): void
}

/**
 * The original inline debug card: both trust surfaces stacked under the post.
 * Kept for troubleshooting; it is the only preset that changes X's layout.
 */
export function createDebugPanel(
  article: HTMLElement,
  targets: ArticleTargets,
): DebugPanel {
  article
    .querySelector<HTMLElement>(`:scope > [${HOST_ATTR}]`)
    ?.remove()

  const host = document.createElement('div')
  host.setAttribute(HOST_ATTR, 'true')
  host.style.cssText =
    'display:grid;gap:6px;box-sizing:border-box;margin:2px 12px 10px 58px;max-width:calc(100% - 70px);'

  const author = new TrustCard({
    target: targets.profileTarget,
    variant: 'author',
  })
  const post = new TrustCard({ target: targets.postTarget, variant: 'post' })
  host.append(author.host, post.host)
  article.append(host)
  article.dataset.attentionxPostId = targets.postTarget.id
  article.dataset.attentionxTwitterId = targets.profileTarget.twitterId ?? ''

  return {
    update(next) {
      author.setTarget(next.profileTarget)
      post.setTarget(next.postTarget)
      article.dataset.attentionxTwitterId = next.profileTarget.twitterId ?? ''
    },
    destroy() {
      author.destroy()
      post.destroy()
      host.remove()
      delete article.dataset.attentionxPostId
      delete article.dataset.attentionxTwitterId
    },
  }
}
