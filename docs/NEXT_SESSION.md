# Next session — start here

Everything below was decided or diagnosed on 2026-07-25 and deliberately not
implemented, to be picked up cold. Ordered by what unblocks the most.

---

## 1. ✅ DONE — blocking-loop starvation fixed 2026-07-25

Fixed and hardware-validated; see §0 of `BUG_BLOCKING_USERLOOP.md` for what
was done and the acceptance results. What remains from the original list:

- [x] **Rate-limit `log()`** — done 2026-07-25. Token bucket, 5 lines/s with a
      burst of 8, and a "N line(s) dropped" summary at most once a second.
      Not the 10/s first sketched: each frame is a ~100 ms synchronous modem
      write, so 10/s would consume the radio outright and starve telemetry.
      Measured under a flood: 10.3 → 6.7 frames/s (5.7 lines + 1.0 note),
      while USB Serial stayed unthrottled at 25 lines/s.
- [ ] **Fix `control_wait_until` in the Arduino generator** — still open. The
      wrapper now catches it, so this is no longer urgent, but the generator
      still emits a bare `while(!cond);` which is wrong on its own terms and
      would bite anyone using the generated code outside the wrapper.
- [x] **`waitForStart()`** — done 2026-07-25. `WiFiRuntime.waitForStart()`
      parks on tick() (so the robot is fully reachable exactly when someone
      wants to upload to it), releases on BTN_UP **or** a remote
      `{"t":"start"}`, waits for the button to be released so the same press
      is not consumed twice, and reports `"waiting"` in `info`. The HUD shows
      a green **Start** button whenever a connected robot reports it is
      waiting — one click starts it without walking over to the robot, which
      is the groundwork for the R7 teacher panel.
      Deliberately does not draw on the OLED: the student's blocks have
      usually just drawn their own prompt there.
- [x] **`waitForStart()` wired to a block** — done 2026-07-25, without adding
      one. The wrapper recognises the canonical shape the stock blocks
      already emit (`control_wait_until` wrapping `mini_BTNget` produces
      exactly `while(!MiniR4.BTN_UP.getState());`) and converts it. Every
      program a student has already built becomes remotely startable, with no
      new block to learn and no toolbox change. Only BTN_UP, only with an
      empty body; BTN_DOWN is the stop button and stays a pumped loop.

<details>
<summary>Original entry (kept for context)</summary>

Full analysis and implementation traps: **`BUG_BLOCKING_USERLOOP.md`**.

One line summary: `WiFiRuntime.poll()` only runs when `loop()` iterates, so
any user code that does not return kills WiFi **and** the USB config channel.

**Treat this as release-blocking.** The Arduino starts running the moment it
resets, so students gate their programs with "wait until BTN_UP is pressed" —
which means the *typical* program, not an unusual one, starts with a bare
busy-wait and takes the hub off the network from boot. The WiFi feature is
not usable in a real classroom until this is fixed.

</details>

## 2. Separate the "cannot upload via VM" report

See `BUG_BLOCKING_USERLOOP.md` §6.2. Two candidate causes with different
fixes — unsupported blocks (the VM has no string-print opcode) versus the hub
already being starved by the previous program. **Rescue with BTN_UP, confirm
discovery, then retry the upload** before changing anything, and read the
warning list the Send-VM window prints.

## 3. One connection manager for USB and WiFi — PARTLY DONE

**Done 2026-07-25:** `connection.js` — navbar indicator with a lamp per
transport, a Status pane showing the cable link, the discovered robots, the
SSID the *computer* is on versus the one the robot broadcasts, the battery
warning and a Start button when a robot is waiting; plus a Setup pane with the
whole config form working over whichever link is up.

**Still open:** converting the per-feature pickers (HUD, Send via WiFi, Send
VM, debugger) to ask the manager for the current robot, deleting each picker
as its consumer switches, and finally removing `MBR4Hud.pause()/resume()` once
nothing competes for the TCP slot.

Full design: **`DESIGN_UNIFIED_CONNECTION.md`**.

Connection state currently lives in five places, each with its own picker.
The proposal turns the navbar's `#deviceStNavLink` ("No Device" / `COM10`)
into the single connection surface with two lamps — cable and wireless — so
"am I on the robot's WiFi?" is always answerable, and folds the USB Setup
form in as a tab. Then the per-feature pickers get deleted one consumer at a
time, and `MBR4Hud.pause()/resume()` disappears with them.

Suggested order is in §4 of the design doc. Ship the manager alongside the
existing pickers first, change nothing else, then convert consumers one by
one.

## 4. Still open from before

- Release (§6 of `HANDOFF_NEXT_PHASES.md`): tag, GitHub Actions build,
  and only then the batched message to Rose (MATRIX Robotics) — team
  convention is one message for accumulated upgrades, not per feature.
- Roadmap R1 (mission slots) and R4–R10 in `ROADMAP.md`.
- Two hardware checks needing props: the two-robot picker (needs a second
  hub) and the BTN_UP rescue of a deliberately-blocking sketch — note that
  item 1 above now gives us the perfect blocking sketch for it.

## 5. Corrections to carry forward

The 2026-07-25 "hub pings but does not answer" incident was blamed first on a
**modem socket wedge** and then on a **low battery**. Item 1 explains every
observation on its own, and in both cases the hub was running a user program.
Treat those two theories as unproven. The changes they produced (MAC-persist
reboot, factory reset clearing the VM) are correct on their own merits, but do
not assume they fixed what the user reported.
