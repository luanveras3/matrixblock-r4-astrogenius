# Design — one connection manager for USB and WiFi

**Status: steps 1 and 2 IMPLEMENTED 2026-07-25** (`connection.js`). The
indicator, the two-transport panel and the setup form all ship; converting the
remaining per-feature pickers (§4 steps 3-4) is still open.

Implemented differently from §2 in one important way: the panel does **not**
open its own WiFi socket. The HUD already owns the single TCP slot and its
reconnect logic, so the panel drives it through
`MBR4Hud.send/onFrame/onConnect/isConnected/selectRobot/currentRobot`. Adding a
second client would have recreated the exact contention this design exists to
remove. USB is owned outright — and released when the panel closes, because
holding the port would block arduino-cli's USB upload.
**Motivation, in the maintainer's words:** *"that way we will always know when
it is connected to WiFi and when it is not."*

---

## 1. The problem: connection state is scattered across five places

Today a user answers "am I connected, and to what?" by looking in five
different places, each with its own picker, its own idea of connection,
and no shared state:

| Where | What it owns | Module |
|---|---|---|
| `#deviceStNavLink` in the navbar ("No Device" / `COM10`) | USB serial port, with `#deviceDropdown-content` → auto-discovery checkbox + `#comSelect` | stock app |
| "Send via WiFi" modal | its own UDP discovery + robot picker, per upload | `wifi_upload.js` |
| "Send VM (fast)" modal | *another* discovery + picker, per upload | `wifi_vm_upload.js` |
| HUD tab | its own connect loop, auto-reconnect and `openHudPicker` | `wifi_hud.js` |
| "USB Setup" panel | its own port scan and baud probe | `usb_config.js` |

Consequences we have actually hit this session:

- the same robot is discovered three or four times for one workflow;
- the runtime accepts **one TCP client**, so these compete for the slot —
  which is why `MBR4Hud.pause()/resume()` exists at all, and why a stray
  reconnect timer once caused the HUD flapping bug (`b9e4ca2`);
- nothing ever shows "you are not on the robot's WiFi", which is precisely
  the state a user spends an afternoon failing to diagnose;
- after a rename, the network on the air still carries the old SSID and no
  single place says so.

## 2. The proposal

Turn `#deviceStNavLink` — the element that already means "which device am I
talking to" — into the **one** connection surface, covering both transports.

### The indicator

Always visible in the navbar, showing the live state of both links:

```
[🔌 COM10]  [📶 ASTROGENIUS-B0BC]        <- both up
[🔌 COM10]  [📶 not connected]           <- cable only
[🔌 no cable] [📶 ASTROGENIUS-B0BC]      <- wireless only
[🔌 no cable] [📶 not connected]         <- nothing (and say so loudly)
```

Clicking it opens the connection panel. That is the entire mental model:
one place, two lamps.

### The panel

- **USB** — port list (reuse `usb_config.js`'s probe: it already identifies a
  real hub rather than guessing from the port name), connect/disconnect, and
  the hub identity it read.
- **WiFi** — the discovery list (one implementation, from `wifi_upload.js`),
  battery and mode per robot, connect/disconnect, plus **which SSID the PC is
  currently joined to** versus the SSID the selected robot broadcasts. That
  comparison is the missing diagnostic: it is what tells a user "your laptop
  is on the school network, the robot is on its own AP".
- The hub configuration form from `usb_config.js` moves here as a tab, so
  name / WiFi credentials / AP password / reset live next to the connection
  they affect — and work over **whichever transport is up**, since both speak
  the same NDJSON command set.

### The plumbing

A single `MBR4Connection` module owning:

- the discovery cache (one UDP sweep, shared by every consumer);
- the **one** `RobotClient` for the single TCP slot;
- the **one** serial handle;
- a `send(obj)` that routes over the active transport, preferring WiFi for
  streaming and USB for configuration;
- the existing subscription bus, generalised: `onFrame`, `onConnect`, plus a
  new `onStateChange` for the indicator.

Then delete the per-feature pickers: `wifi_upload.js`, `wifi_vm_upload.js`,
`wifi_hud.js` and `wifi_vm_debug.js` all become consumers that ask the
manager for the current robot instead of hunting for one. `MBR4Hud.pause()/
resume()` disappears with them — nobody is fighting for the slot any more,
because there is only one owner.

## 3. Why this is worth doing beyond tidiness

It closes the diagnostic gap that cost this session. Every "I can't find the
hub" symptom we chased — wrong SSID after a rename, laptop on the wrong
network, low battery, a starved runtime — becomes visible in one panel that
also works over the cable when the radio does not.

## 4. Order of work (suggested)

1. `MBR4Connection` with the state machine, indicator and the two links.
   Ship it *alongside* the existing pickers, changing nothing else.
2. Move the config form from `usb_config.js` into it.
3. Convert consumers one at a time — HUD, then Send VM, then Send via WiFi,
   then the debugger — deleting each picker as its consumer switches over.
4. Remove `MBR4Hud.pause()/resume()` and the reconnect-timer dance once the
   last competitor for the TCP slot is gone.

Keep every string bilingual EN + pt-BR, as everywhere else in this fork.

## 5. Traps to carry forward

- The runtime is **single-client** over TCP. That constraint is the reason
  this design exists; do not let two clients reappear.
- Blocking user code starves the runtime and both transports go dark —
  see `BUG_BLOCKING_USERLOOP.md`. The indicator will show "not connected",
  which is honest but not actionable; consider a hint pointing at BTN_UP
  recovery when a hub was discovered recently and then vanished.
- A rename only reaches the AP SSID on the next power-cycle. `info` reports
  the live SSID as `"ap"`; show it, do not derive it.
- `Blockly.BlockSvg.prototype` is a minefield — see
  `reference_blockly_context_menu_trap` in memory before adding UI hooks.
