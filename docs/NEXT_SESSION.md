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

**Also done 2026-07-25:** consumers converted. The uploaders and the settings
dialog ride the shared socket, the per-dialog pickers are gone, and
`pause()/resume()` is deleted (kept as no-ops for one release). Measured: a VM
upload now runs with the HUD still connected and telemetry still flowing.

**Still open:** one real "Send via WiFi" (OTA) on hardware. That path was
converted but not exercised end to end — it is the riskiest shape, since it
needs the PC's address on the robot's network and ends with the hub rebooting
under the socket. Do this before relying on OTA.

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

## 3b. Radio off — validated 2026-07-25

`{"t":"radio","on":false}` / `on:true`, with a button in the connection panel.
Full round trip exercised over the cable: off → ack, `radio:false`, IP 0.0.0.0,
UDP discovery finds nothing, **and the cable still answers**; on → ack, AP back
at 192.168.4.1. Not persisted, so a power cycle always restores the radio — a
hub that boots unreachable is the failure this branch exists to prevent.

Telemetry is also gated on the dashboard being visible (measured 0 / 45 / 0
frames per 5 s: hidden, open, left). Between the two, the radio now works only
when someone is actually using it.

## 3c. OTA over the shared socket — ✅ VALIDATED 2026-07-25 (manually, from the button)

Attempted 2026-07-25, did not complete. Record so the next attempt starts
informed rather than repeating it:

1. ~~**`{"t":"radio","on":true}` leaves the sockets wedged.**~~ **FIXED** — it
   reboots instead of re-initialising in place, and discovery works again
   afterwards. Original analysis: It does
   `WiFi.end()` then `beginAP()` in place and rebinds UDP/TCP right after —
   the same modem mode-transition race already removed from
   `_refreshMacIdentity` by rebooting instead. Observed: after `radio on` the
   hub answers ping and reports `mode:ap, ip:192.168.4.1`, but UDP discovery
   finds nothing; a reboot fixes it every time. **Fix the same way: reboot
   instead of re-initialising in place.** Until then, `radio on` should be
   considered "needs a power cycle to be useful".

2. ~~**A client that dies mid-OTA appears to lock the runtime out.**~~
   **FIXED** — `_pollCommands` only ever looked for a waiting client when the
   slot was free, so a half-open socket reporting connected() forever locked
   the robot out permanently. It now preempts a client that has been silent
   for 15 s, but only when someone else is actually knocking. Original report: The probe's
   Electron window closed during the upload and afterwards the hub refused new
   TCP connections and stopped answering discovery, recovered only by a USB
   reflash. The runtime is single-client; it likely never noticed the dead
   peer. Worth a `_pollCommands` review: drop `g_client` on a stale/half-open
   socket (idle timeout or write failure) so one crashed client cannot take
   the robot off the network.

**Confirmed working.** After both fixes, a real "Send via WiFi" run from the
button succeeded end to end — so the shared-socket conversion is good: an OTA
now uploads over the same connection the HUD holds, with no pause/resume and
no second client. That closes the last open item of the unified-connection
work.

History of the two failed probe attempts, kept for the method lesson:

**Attempt 2 (after both fixes) got much further and still did not close.**
The pipeline worked: compiled 155000 B, converted to a 121862 B .ota,
transferred, and reached "waiting for the robot to come back" — so download,
verify and apply all completed. What could not be confirmed is whether the new
image booted: the Electron window died during the post-flash wait, and the hub
then answered on neither WiFi nor USB until a USB reflash.

**Stop driving this from a headless probe.** A long flow that opens dialogs
and ends with the robot rebooting is the worst possible fit for it: when the
window dies mid-flight every observation is lost, and twice now that produced
a misleading diagnosis. Run it from the real "Send via WiFi" button with a
human watching, and use the bench tools only to check the result afterwards.

Neither bug is in the shared-socket conversion itself — but both must be
understood before trusting an OTA through it. Run the upload from the real
"Send via WiFi" button, watching `docs/poc` bench tools, before relying on it.

## 3d. VM block coverage — 47% -> 60%, validated on hardware

Rounds 4 and 4a/4b took the bytecode VM from 90 to 116 of the 193 blocks the
Arduino generator supports. Flashed and exercised on the hub with a
hand-assembled program: `map(50, 0..100 -> 0..1000)` returned exactly 500, the
three sensor opcodes returned their "nothing attached" sentinels (0xFFFF, -1,
8191) without faulting, the void opcodes did not trap, and the heartbeat
counter kept advancing — so the VM survives every new opcode.

**Key finding for the remaining work:** the I2C drivers are already members of
`MiniR4.I2C1..I2C4`, so sensor opcodes cost flash and NOT static RAM. Measured
across both rounds: static RAM unchanged at 23068 bytes, flash 61% -> 62%.
Static RAM has ~228 bytes of headroom; flash has ~100 KB. That is what makes
the rest affordable.

**77 blocks remain**, of which ~31 are design boundaries, not pending work:
BLE (ArduinoBLE cannot link beside WiFiS3), WiFi/MQTT (the VM runs inside the
runtime that owns the radio), custom code (arbitrary C++ by definition), and
strings (the VM is single-int32; strings need tagged values against a
228-byte margin). The other ~46 are mechanical, following the round-4b
pattern: digital/Grove sensors, numeric Serial, timers.

`mini_i2c_MXmotion_*` is the one exception in the sensor family: there is no
MXMotion instance on MiniR4I2C, so it needs a RAM decision rather than just an
opcode.

Measure coverage by LOADING the generators with a stubbed Blockly and reading
the registered keys. A regex over `G['name']` is wrong in both directions: it
misses blocks registered in a loop and counts handlers with no Arduino
counterpart.

## 4. Still open from before

- Release (§6 of `HANDOFF_NEXT_PHASES.md`): tag, GitHub Actions build,
  and only then the batched message to Rose (MATRIX Robotics) — team
  convention is one message for accumulated upgrades, not per feature.
- Roadmap R1 (mission slots) and R4–R10 in `ROADMAP.md`.
- Two hardware checks needing props: the two-robot picker (needs a second
  hub) and the BTN_UP rescue of a deliberately-blocking sketch — note that
  item 1 above now gives us the perfect blocking sketch for it.

## 4a. Port sensors — confirmed on real hardware 2026-07-25

Sampled the running VM while the bench was operated by hand: switch on D1
toggled 0 -> 1 -> 0 over four presses; the M1 encoder tracked -387 -> -437 ->
-396, following the shaft both ways. Potentiometer steady at 537-539, PIR at 0
— both consistent with nothing touching them. Earlier in the same setup the
PIR toggled 1 -> 0 on motion and an I2C laser read a real 23-25 mm.

The switch reads from the **L** pin. An older note said R; the Arduino
generator has always emitted `getL()` and the hardware agrees.

## 4b. Probes MUST answer the app's dialogs

The app raises SweetAlert2 dialogs a human dismisses without thinking and a
probe never answers:

- **"Restore previous session?"** at startup, whenever tabs were left open;
- **"unsaved changes / close anyway?"** on quit.

A probe that ignores them looks exactly like a crash — the evaluate hangs or
the window disappears, and every observation collected so far is lost. This
cost two misdiagnoses in one session: an OTA run was blamed first on a modem
wedge and then on the battery, when a modal was simply waiting for a click.

Use `probe_helpers.js`: `launchApp()` starts the app with a background
watcher already dismissing dialogs, and `closeApp()` answers the quit prompt.
Never call `electron.launch()` directly in a new probe.

## 5. Corrections to carry forward

The 2026-07-25 "hub pings but does not answer" incident was blamed first on a
**modem socket wedge** and then on a **low battery**. Item 1 explains every
observation on its own, and in both cases the hub was running a user program.
Treat those two theories as unproven. The changes they produced (MAC-persist
reboot, factory reset clearing the VM) are correct on their own merits, but do
not assume they fixed what the user reported.
