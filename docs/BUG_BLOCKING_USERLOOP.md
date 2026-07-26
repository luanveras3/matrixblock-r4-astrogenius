# OPEN BUG — blocking user code starves the runtime and makes the hub unreachable

**Status: FIXED 2026-07-25, hardware-validated.** Kept as the record of what
happened and why the design is shaped the way it is.
**Severity was:** blocking. Not "a bug that can be hit" — **the normal way
student programs are written hit it every time.**
**Reported:** 2026-07-25, with a complete reproduction.

## 0. How it was fixed

- **`WiFiRuntime.tick(bool cond)`** (firmware): services the serial channel,
  discovery, TCP and telemetry, steps the VM, and returns `cond` unchanged so
  it can wrap a loop condition. Self-throttling at 5 ms, because a tight gate
  loop calls it tens of thousands of times a second and every discovery poll
  is a modem transaction.
- **The wrapper rewrites every user loop condition** into
  `while (WiFiRuntime.tick(COND))`, covering `while`, `do/while` and the
  condition slot of `for`. Implemented as a scanner, not a regex: `while` and
  `for` occur inside string literals and comments, and rewriting one of those
  would corrupt the sketch in a way that is near-impossible to trace back.
  User spacing is preserved so the generated code still looks like the
  student's program.
- **`tick()` also steps the VM.** Found during hardware validation: sending a
  VM program while the robot sat at its gate loaded it and never ran it,
  because `poll()` — which normally drives the VM — is exactly what a blocked
  `userLoop` never reaches. Since the gate is where a robot spends most of
  its idle life, "Send VM (fast)" would have appeared to do nothing most of
  the time. `_pollVm()` gained a re-entry guard.

**Hardware acceptance** (`examples/zDeveloper Use/MiniR4_GateRepro`, the
reported reproduction verbatim), with the hub parked on `while(!BTN_UP)` and
no button ever pressed:

| Check | Result |
|---|---|
| UDP discovery | answers — `ASTROGENIUS 192.168.4.1 fw 1.2.0` |
| TCP `info` | answers |
| USB serial `info` | answers, three consecutive requests |
| VM upload while parked | accepted, and the program **runs** (counter 27 → 76 between reads) |

Test coverage: 20 new assertions in `tools/wifi_wrapper.test.js`, including
every string/comment/paren trap the scanner exists for.

> **Why this is the main path, not an edge case** (maintainer, 2026-07-25):
> the Arduino starts executing the instant it resets, so students need a gate
> to control *when* the program actually begins. Practically every program
> therefore opens with **"wait until BTN_UP is pressed"**. That single block
> compiles to a bare busy-wait, so essentially **every program uploaded from
> the IDE takes the hub off the network from the moment it boots** — over
> WiFi *and* over the USB config channel.
>
> Consequences for planning:
> - this is not optional cleanup; the WiFi feature is unusable in real
>   classroom use until it is fixed, and it should block any wider release;
> - the fix must specifically cover *this* shape: a blocking loop as the very
>   first thing `userLoop()` does, i.e. starvation from boot;
> - the moment the robot sits at "waiting to start" is exactly when a teacher
>   or student wants to connect, upload or configure it. Making this pattern
>   poll-safe does not merely remove a bug, it turns the most common state a
>   robot is ever in into its most responsive one.

---

## 1. Reproduction (user's, verbatim in effect)

Upload this program to the hub (the shape matters, not the details):

```cpp
static void userLoop()
{
  MiniR4.OLED.print("PRESS UP");  MiniR4.OLED.display();
  while (!MiniR4.BTN_UP.getState());              // <-- blocks here
  MiniR4.OLED.print("RUNNING");   MiniR4.OLED.display();
  while (!MiniR4.BTN_DOWN.getState())            // <-- and here
  {
    teste = 0; WiFiRuntime.logPrintln(teste);
    teste = 1; WiFiRuntime.logPrintln(teste);
  }
}

void loop()
{
  WiFiRuntime.poll();
  if (!WiFiRuntime.isRunningVM()) { userLoop(); }
}
```

From the moment this runs, the hub is invisible to the IDE — over WiFi and
over USB — until it is reflashed or rescued.

## 2. Root cause

The runtime is **cooperatively scheduled**. `WiFiRuntime.poll()` services
UDP discovery, the TCP command server, telemetry, the VM *and* the USB serial
config channel, and it only runs when `loop()` comes back around.

In the program above `loop()` calls `poll()` **exactly once**, then enters
`userLoop()` and never returns: `while (!MiniR4.BTN_UP.getState());` spins
until a human presses a button. During that spin nothing is serviced:

- discovery never answers, so the robot vanishes from the picker;
- the TCP server never accepts, so direct connects hang;
- `_pollSerial()` never runs, so **the USB setup panel is starved too** — the
  rescue path built for exactly this situation inherits the same flaw.

### The user's own log is a direct measurement of this

```
{"t":"info",...,"uptime":74491}
{"t":"info",...,"uptime":74653}
{"t":"info",...,"uptime":74816}
```

Three identical `info` replies, 163 ms apart, all printed **at the moment the
loop was stopped**. Those were requests the USB panel sent *while the hub was
blocked*: they sat unread in the UART receive buffer and were all processed in
one burst the instant `userLoop()` finally returned. That is starvation,
measured — not a modem fault, not a network fault.

## 3. Why it is worse than one bad sketch: a standard block emits it

From `blockly-core/generator/control.js` inside the pristine asar:

```js
Blockly.Arduino['control_wait_until'] = function () {
    const argument = Blockly.Arduino.valueToCode(this, ...) || 'false';
    return 'while(!' + argument + ');\n';
};
```

The **"wait until"** block compiles to a bare busy-wait with no yield. Any
student who drags it in makes their robot unreachable. `control_repeat_until`
(`while (!cond) { ... }`) has the same problem whenever its body contains no
`delay`, and a `forever` loop that is not the outermost statement is equally
fatal.

## 4. What the wrapper already handles, and the exact gap

`arduino_wifi_wrapper.js` was built with this failure mode in mind and covers
two cases:

| Construct | Handled? | How |
|---|---|---|
| `delay(N)` | yes | rewritten to `WiFiRuntime.safeDelay(N)`, which polls in ~20 ms slices |
| a single outermost `while (true) { ... }` | yes | `stripOuterWhileTrue` unwraps it into `loop()` |
| `while (cond);` — "wait until" | **NO** | spins with nothing to yield to |
| `while (cond) { ...no delay... }` — "repeat until" | **NO** | same |
| a nested or non-outermost `forever` | **NO** | only the outer one is unwrapped |
| any hand-written blocking loop | **NO** | — |

So the gap is precise: **we made waits safe but not loops.**

## 5. Secondary problem, visible in the same sketch

```cpp
teste = 0; WiFiRuntime.logPrintln(teste);
teste = 1; WiFiRuntime.logPrintln(teste);
```

`logPrintln` flushes a line to `log()`, and every outgoing frame costs a
**synchronous ~100 ms modem write** (the ceiling that holds telemetry to
9.4 Hz). In a tight loop this is a self-inflicted denial of service on the
modem: the sketch generates frames far faster than the radio can drain them.
Fixing the loop starvation alone would not make this program behave; `log()`
needs a rate limit.

## 6. Immediate workaround for the user

**Hold BTN_UP while powering the hub on.** `begin()` enters `_recoveryLoop()`
before any user code runs — the OLED shows `OTA MODE`, `userLoop` is never
called, and the loop services discovery, TCP and (since this session) the USB
serial channel. From there, upload a different program or use USB Setup.

This is why the recovery gesture exists and it is the one path this bug cannot
take away.

### 6.1 Confirmed working (2026-07-25)

The user rescued the hub with the BTN_UP gesture and WiFi came back normally.
That is the recovery path validated in the field, and it also confirms the
diagnosis from the other direction: the hardware and the radio were fine all
along — only the sketch was starving them.

## 6.2 Second symptom: the same program cannot be sent to the VM either

The user reports that the reproduction sketch also fails to upload as a VM
program. Not yet investigated; the likely causes, in order of probability:

1. **Unsupported blocks, not a transport failure.** The VM has no opcode for
   printing a *string* to the OLED — `OLED_PRINT_I` prints an integer — so
   `MiniR4.OLED.print("PRESS UP")` has nothing to compile to. Same for
   `MiniR4.PWR.setBattCell(2)` and for logging a value to the console. The
   compiler is expected to emit warnings and skip them, which can leave a
   payload so small that `wifi_vm_upload.js` rejects it as `trivial`
   (`bytes.length <= 1`).
2. **The upload never starts** because the hub is already starved by the
   *previous* program — the VM upload needs the TCP slot, which needs
   `poll()`, which is exactly what is blocked. If so, the fix is BTN_UP
   recovery first, then upload.

These are different bugs with different fixes, so **reproduce and separate
them before touching code**: rescue the hub with BTN_UP, confirm it is
discoverable, and only then attempt the VM upload. Check the warning list the
Send-VM window prints — it names every skipped block.

## 7. Proposed fix — in priority order

**A. Pump the runtime inside user loops (the real fix).**
Extend the wrapper the same way `delay` was handled. Add a firmware helper:

```cpp
/// Services network + USB serial, never the VM, and returns `cond`
/// unchanged so it can wrap a loop condition.
bool tick(bool cond);
void tick();
```

then rewrite user `while (COND)` into `while (WiFiRuntime.tick(COND))`.
Notes for whoever implements it:
- must **not** re-enter the VM (that is the `a9db855` stack-overflow bug);
- `while (cond);` with an empty body needs the rewrite on the condition, which
  the above handles naturally;
- must not touch `while` inside comments or string literals;
- `do { } while (cond)` and `for (;;)` need the same treatment;
- keep `stripOuterWhileTrue` — unwrapping is still better than pumping.
Also fix `control_wait_until` at the generator level to emit a yielding loop,
so block-generated code is correct even outside the wrapper. Do both: the
generator for correctness, the wrapper as the net that catches everything.

**A2. Consider making "wait to start" a first-class runtime concept.**
Since nearly every program opens with this gate, it is worth more than a
generic loop rewrite. A `WiFiRuntime.waitForStart()` that polls while it
waits could, at no extra cost to the student:
- keep discovery, TCP and USB fully alive while parked (the state a robot
  spends most of its idle life in, and exactly when someone wants to reach
  it);
- show "waiting to start" on the OLED, so a robot that looks dead is visibly
  just waiting;
- accept a **remote start** from the IDE — one "Start" button for a whole
  classroom, and the basis for the R7 teacher panel;
- report the waiting state in `info`, so the connection panel can explain
  what the robot is doing instead of leaving the user guessing.
The generic loop fix (A) is still required — it catches every other blocking
shape — but this turns the single most common one into a feature.

**B. Rate-limit `log()`.** Cap outgoing log frames (~10/s is already twice the
old BLE dashboard cadence), drop the excess and emit a periodic
`"... N lines dropped"` so the student sees that output was throttled rather
than silently losing data.

**C. Compile-time warning in the IDE.** After `Blockly.Arduino.finish`, scan
the generated sketch for blocking constructs the wrapper could not rewrite and
warn before upload, naming the block. Cheap, and it teaches the concept.

**D. Consider the RA4M1 watchdog.** A hardware WDT would reboot a truly stuck
sketch, but it reboots *into the same sketch*, so on its own it produces a
boot loop rather than a recovery. Only worth it combined with a "N watchdog
resets in a row → stay in recovery mode" counter in dataflash.

## 8. Note on the earlier diagnosis

The 2026-07-25 incident in `POC_OTA_FINDINGS.md` ("hub pings but does not
answer") shows the **same signature** as this bug: ICMP is answered by the
modem autonomously, while UDP and TCP payloads need the sketch to service
them. The modem-wedge explanation may therefore have been wrong, and the
low battery a red herring — at the time the hub was running a user program,
and this bug alone accounts for every observation. The MAC-persist reboot
change made there is still correct on its own merits, but it should not be
assumed to have fixed anything the user saw.

**Test this first when the fix lands:** flash the reproduction above, confirm
the hub stays discoverable while parked on `while (!BTN_UP)`.
