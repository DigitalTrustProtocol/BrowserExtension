export interface FaultState {
  latencyMs: number
  /** Close every socket on this interval. `0` disables. */
  dropEveryMs: number
  /** Epoch ms. New sockets are refused until then. `0` means up. */
  downUntil: number
  /** Percent of valid EVENT messages answered with `OK false`. */
  rejectPercent: number
  eoseDelayMs: number
  suppressEose: boolean
  /** Accepted EVENTs per connection per second. `0` disables. */
  ratePerSec: number
}

export function idleFaults(): FaultState {
  return {
    latencyMs: 0,
    dropEveryMs: 0,
    downUntil: 0,
    rejectPercent: 0,
    eoseDelayMs: 0,
    suppressEose: false,
    ratePerSec: 0,
  }
}

export function isDown(faults: FaultState, now = Date.now()): boolean {
  return faults.downUntil > now
}
