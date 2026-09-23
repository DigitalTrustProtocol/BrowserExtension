# Asking the right questions

Attention is a Web of Trust for **attention**. The protocol only works if
each kind answers one question. Mixing the questions produces likes that
pretend to be trust, or trust that pretends to score a post.

```text
32009  identity   →  Is this identity worth my trust?
32014  artifact   →  Is this artifact worth my time?
```

Answer **trust first**. Then consume ratings only from people who passed.
Without kind `32009`, a rating is a crowd score (platform likes, public
review sites). With it, the rating is **your network’s advice on
attention**.

```mermaid
flowchart LR
  trustQ["32009: worth my trust?"]
  wot["Walk positive p edges"]
  rateQ["32014: worth my time?"]
  chip["One scroll score"]
  trustQ --> wot --> rateQ --> chip
```

Kind `32014` is specified in [NIP-32014.md](NIP-32014.md). Kind `32009` is
specified in [NIP-32009.md](NIP-32009.md). Attention ships both kinds:
`32009` for trust hops, `32014` for ratings consumed from trusted identities.

## Hard vs soft

| | Trust (`32009`) | Rating (`32014`) |
| --- | --- | --- |
| Question | Is this identity worth my trust? | Is this artifact worth my time? |
| Value | `v` = `1` / `0` / `-1` / `""` (Delete) | `score` = `""` (Delete) or `0`–`100` |
| Graph | Positive `p` is a hop | **Never** a hop; never grants access |
| Feel | Hard, controllable | Soft, familiar (stars) |

`32009` can open a door (`c=security:access:…`) or expand whose judgments
you read. A four-star review must never do either. Publishing both on the
same subject is allowed; they mean different things.

## Agents vs artifacts

- **Trust UI** for people and issuers (`p`, X `user:id`). These can issue
  statements.
- **Rating UI** for dead things: posts, products, pages. They cannot issue
  trust.

A rating MAY target an npub or an X account as a **statement**. It still
does not expand the graph. For people, the default action remains Trust /
Distrust. Rating a person is a soft review, not “I will consume their
trust.”

## One scroll indicator

While scrolling, show **one** number: the average of active `32014`
scores at the **nearest hitting degree** — the same stop rule as kind
`32009` trust. If you have rated the post, that score is the indicator.
If not, average only the closest trusted cohort (people you trust, then
the next hop, and so on). Farther ratings do not dilute nearer ones.

- **High** → the network would invest time → read
- **Low** → spam, slop, noise → skip
- **None** → no signal yet → you decide

Who rated, which labels, and any comment belong behind a tap. The timeline
is not a review thread.

Product policy (not a protocol MUST): labels such as `spam` or `ai-slop`
MAY hide an item even when another trusted rater scored it high.

## Do not duplicate the host

Hosts already have social gestures. Attention adds the missing **score**.

| Surface | What to offer | Why |
| --- | --- | --- |
| X post (likes + replies exist) | Stars + labels + optional collapsed comment. | Discussion stays in X replies; `content` is the claim note, not a second reply timeline. |
| Product / page with no review | Stars + optional comment + optional labels | The host has no review. You are the review. |

`content` stays optional on the wire. Empty `content` is a complete rating.
On an X post, the composer is collapsed; inbound comments are shown on
tap-through.

A public Like is not a rating: it has no dislike, it is not filtered by
*your* web of trust, and it does not answer “worth my time.”

## Labels are shortcuts, not a second protocol

Optional `l` tags (`insightful`, `genuine`, `funny`, `ai-slop`,
`misleading`, `spam`, …) are the *why*. They live on the same
replaceable rating event. Clients MAY map them onto whole stars
(insightful → `100` / 5★, genuine → `80`, funny → `60`, AI slop → `40`,
misleading → `20`, spam → `0`). One author, one subject, one site, one
purpose context: **one review**.
