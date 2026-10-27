# TODO

Roadmap from proof of concept to a game worth riding every day. Ordered by priority: finish a phase
before starting the next, except for small polish items.

## 0. Prove it on the bike (blocking)

- [ ] Install the release APK on the tablet; confirm `pnpm logs:sensors` shows `status=connected`
- [ ] Check reported power/cadence/resistance match the Peloton app's own readout at a few efforts
- [ ] Record the tablet model, Android SDK and GPU (`ro.product.model`, `ro.build.version.sdk`, `dumpsys SurfaceFlinger | grep GLES`) in the README
- [ ] Note the FPS on the real tablet; if under ~30, do the perf items in §6 before adding anything
- [ ] Fix whatever the sensor binding gets wrong (permission denial, Bike+ parcel layout, power scaling)
- [ ] Handle the service disconnecting mid-ride: auto-rebind with backoff, show a "sensor lost" banner, pause the race
- [ ] Trim the APK to `arm64-v8a`/`armeabi-v7a` only (currently 73 MB with every ABI)

## 1. Game feel

- [x] Smooth the incoming power (short rolling average or Kalman) so speed doesn't jitter on noisy readings
- [x] Drafting: reduce CdA when within ~3 m behind another rider, show a "drafting" indicator
- [x] Riders steer round each other instead of overlapping (lane changes when overtaking)
- [x] Pedalling animation tied to real cadence (legs/cranks rotate), lean into corners
- [x] Better bike + rider models (procedural low-poly, IK legs, 7 draw calls for the whole field)
- [x] Rider moods from W/kg: sleepy wobble + rising Z's when soft-pedalling, flame trail when going hard
- [x] Camera: slight FOV widening with speed
- [ ] Camera: optional second view (side/overhead) toggle
- [x] Countdown start (3-2-1)
- [x] A proper finish line moment (checkered gantry, final lap + sprint callouts, slow-mo, finish cam, confetti, results)
- [x] Gradient preview strip in the HUD: elevation profile of the lap with your position
- [ ] Audio: wind noise scaling with speed, crowd at the finish, simple beeps for countdown and lap

## 2. Content

- [ ] Track format as data (JSON: centreline points + elevation + scenery theme) instead of the procedural loop
- [ ] 3–5 circuits with different character: flat crit, rolling hills, a single long climb, a mountain loop
- [ ] Point-to-point routes (not just loops) with a distance/elevation summary on the start screen
- [x] Theme system (`src/game/world/theme.ts`): palette, light, terrain shape, vegetation, roadside all data-driven; Alpine built
- [x] Maps: Alpine Valley, Winter Pass (snowfall, frozen lake), Autumn Forest (falling leaves), Golden Hour Lakes — each its own circuit + theme, picked from a map-select screen
- [ ] More maps: coast, desert, night
- [ ] Import real routes from GPX (elevation from the file, xz from a lat/lon projection)

## 3. Game modes

- [x] Menu screen: pick mode (race / time trial / free ride), map, laps, rival difficulty; in-ride pause menu (resume / restart / end ride, Android back button)
- [ ] Ghosts in race mode too (bots + household), and picking which ghosts to race
- [x] **Time trial**: solo against the clock
- [ ] Time trial split times per lap vs your PB
- [ ] **Elimination**: last rider at the end of each lap is out
- [ ] **Interval workouts as races**: power-zone targets on screen, bots ride the same plan
- [ ] Bots scale to the rider: set FTP once, bot difficulty as % of FTP instead of fixed watts
- [ ] Smarter bots: surge on climbs, sprint in the final 200 m, sit in the draft

## 4. Progression and persistence

- [x] Household profiles ("Who's riding?"): name, colour, weight (feeds climbing physics); stored in local SQLite (`src/data/`)
- [x] Every finished ride (and unfinished ones over a minute) saved per profile; History screen with totals + household bests
- [x] Ghost racing: time trials race every household member's best on that course + distance; PB detection

- [ ] Profile FTP (bot difficulty as % of FTP, power zones)
- [ ] Post-ride summary: avg/max power, NP, avg cadence, time in zones, kJ, route + power chart
- [ ] Personal bests per track and per segment (climbs as timed segments)
- [ ] XP/levels and unlockable kit colours/bike styles for streaks and PBs
- [ ] Export rides as `.fit`/`.tcx` and optional Strava upload

## 5. Multiplayer (later)

- [ ] Small realtime server (Cloudflare Durable Object per race room) relaying rider distance/power at ~2 Hz
- [ ] Join by room code; other riders render as remote riders with interpolation
- [ ] Async races: upload ghosts so friends race your recorded ride
- [ ] Leaderboards per track

## 6. Performance and robustness

- [x] Graphics quality setting (Low/High, auto from bike model, toggle in the HUD badge)
- [ ] Render-resolution scale for weaker tablets (render at ~0.7× and upscale) if FPS is low
- [ ] If fill rate/vertex bound on the tablet: chunk vegetation per area so frustum culling works, trim HIGH tree count (HIGH is ~224k scene tris)
- [ ] Merge static scenery into as few meshes as possible; keep draw calls under ~100
- [ ] Level of detail for riders and trees beyond ~150 m; frustum-cull distant props
- [ ] Remove the `THREE.Clock` deprecation (R3F internals; track the R3F release that moves to `THREE.Timer`)
- [ ] Unit tests for `physics.ts`, `track.ts` and `race.ts` (pure TS, cheap to cover)
- [ ] Crash/ANR reporting from the tablet (Sentry or just a local log file pulled over ADB)
- [ ] Remove the Metro `three` redirect and the expo-gl keep rule once upstream fixes land (comments explain both)

## 7. Tablet integration

- [ ] Launcher shortcut / set as a quick-launch app so it's one tap from the Peloton home screen
- [ ] Keep the screen on and stop the Peloton app's sleep timer during a ride
- [ ] Optional: broadcast FTMS over Bluetooth from the tablet so a phone/watch can record the ride too
- [ ] Heart rate: pair a BLE HR strap and show HR + zones in the HUD
