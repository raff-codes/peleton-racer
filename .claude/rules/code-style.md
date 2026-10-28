# Code style

Biome enforces formatting and the lint rules in `biome.json`. Everything here is caught in review instead.

## Names

- Components are named `const` arrow exports (`export const Hud = (…) => …`), matching the rest of `src/`. Helpers,
  callbacks and functions inside a component are `const` arrows too, not `function` declarations.
- Spell names out in full: `element`, `index`, `event`, `error`, `button`, not `el`, `idx`, `evt`, `err`, `btn`.
  Established terms (`id`, `ref`, `props`, the `i`/`j` of a numeric loop) are fine, and so are the conventional
  short names of maths and geometry code (`x`, `y`, `z`, `t`, `dx`, `lo`/`hi`, `n`).
- Event handlers start with `handle`, named after the event: `handlePress` for `onPress`.

## Control flow

- Prefer `const`. In UI and app code, don't declare `let` and reassign it; compute the value in one expression, a
  helper, or an early return. `let` is fine for accumulators and loop state in numeric code (physics, track and world
  generation, binary searches) where the alternative allocates or obscures the maths.
- Return early instead of nesting. Don't chain ternaries; use a lookup object, a helper with early returns, or a
  subcomponent.
- Don't assemble JSX in a variable (`let body: ReactNode`); extract a subcomponent with early returns.
- In JSX, write `condition && <El />`, not `condition ? <El /> : null`. Use `!!count &&` when the left side can be a
  number, so `0` isn't rendered (React Native throws on bare text outside `<Text>`).
- Check lengths by truthiness: `!items.length` / `!!items.length`, not `=== 0` / `> 0`.
- Outside per-frame code, transform and filter in one `reduce` rather than `.filter().map()`. Inside `useFrame` and
  the race tick, avoid allocating at all.

## React

- Don't mirror props or store data into state with an effect (`useEffect(() => setX(…), [y])`). Derive the value
  during render, reset state with a `key`, or set it in the event handler that caused the change.
- Effects are for syncing with something outside React (the sensor module, SQLite, timers, three.js objects), not for
  reacting to a user action.
