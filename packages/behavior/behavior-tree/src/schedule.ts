/**
 * Responsibilities: Decide whether a moment falls inside daily active windows and when the next boundary occurs.
 * Contracts: Windows are local `HH:MM` ranges at a fixed UTC offset; a window whose end precedes its start spans midnight.
 * Constraints: Pure arithmetic on epoch milliseconds; no time-zone database or daylight-saving rules.
 */
import type { TimeWindow } from './definition.ts'

const MINUTE_MS = 60_000
const DAY_MINUTES = 24 * 60

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function localMinute(now: number, utcOffsetMinutes: number): number {
  const minutes = Math.floor((now + utcOffsetMinutes * MINUTE_MS) / MINUTE_MS)
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
}

function contains(window: TimeWindow, minute: number): boolean {
  const start = minutesOf(window.start)
  const end = minutesOf(window.end)
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end
}

/** Whether `now` lies inside any window. */
export function isWithinWindows(now: number, windows: readonly TimeWindow[], utcOffsetMinutes: number): boolean {
  const minute = localMinute(now, utcOffsetMinutes)
  return windows.some((window) => contains(window, minute))
}

/**
 * Epoch milliseconds of the next window start or end after `now`, whichever comes first.
 * Used as a wake-up time so the runner does not poll.
 */
export function nextWindowBoundary(now: number, windows: readonly TimeWindow[], utcOffsetMinutes: number): number {
  const minute = localMinute(now, utcOffsetMinutes)
  const startOfMinute = Math.floor(now / MINUTE_MS) * MINUTE_MS
  let best = DAY_MINUTES
  for (const window of windows) {
    for (const boundary of [minutesOf(window.start), minutesOf(window.end)]) {
      const distance = (boundary - minute + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES
      best = Math.min(best, distance)
    }
  }
  return startOfMinute + best * MINUTE_MS
}
