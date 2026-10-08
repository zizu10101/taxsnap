import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Whether state seeded from a prop must be re-seeded: only when the prop is a
 * different value (reference) than the one it was last seeded from. A server
 * component re-render (router.refresh(), a revisit) hands down a NEW array
 * even when nothing changed, which is the signal; a parent client re-render
 * that passes the same reference is not.
 */
export function shouldResync<T>(seededFrom: T, prop: T): boolean {
  return !Object.is(seededFrom, prop);
}

/**
 * `useState(prop)` that follows the prop. Plain `useState(initialX)` reads its
 * argument once, so after `router.refresh()` fed the page fresh server data a
 * list kept showing what it was first given - the "only shows up after a
 * manual reload" bug. Local edits still apply instantly (optimistic) through
 * the setter; the next time the SERVER hands down new data, that wins.
 *
 * Re-seeds during render (React's "adjust state from props" pattern), not in
 * an effect, so there is no extra paint with stale data and it stays clear of
 * the react-hooks/set-state-in-effect rule.
 *
 * The prop must be reference-stable between renders that did not change it
 * (true for props coming from a server component); do not pass a value built
 * fresh on every render (`items ?? []` inside a client component), or this
 * re-seeds every render.
 */
export function useSyncedState<T>(prop: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(prop);
  const [seededFrom, setSeededFrom] = useState(prop);
  if (shouldResync(seededFrom, prop)) {
    setSeededFrom(prop);
    setState(prop);
  }
  return [state, setState];
}
