# WiFi Upload (OTA) — User Guide

The **Send via WiFi** button uploads your block program to the MATRIX Mini R4
without a USB cable. Unlike the experimental BLE mode (separate branch), this
sends the **real compiled firmware** over the network — every block works,
programs of any size fit, and a full upload takes seconds instead of minutes.

## How it works

1. The IDE compiles your blocks to a normal Arduino sketch (same toolchain as
   the USB button) and converts it to Arduino's `.ota` format.
2. The IDE finds robots on the network (UDP broadcast) and you pick one.
3. The robot's WiFi module downloads the file from the IDE over HTTP on your
   local network, verifies it (CRC), reflashes the main controller and
   reboots into your program.
4. Every sketch sent this way (or via USB) embeds the WiFi runtime again, so
   the robot stays reachable for the next wireless upload.

## First-time setup

The hub must run a WiFi-runtime sketch once before wireless upload works.
Either flash any program via USB from this IDE version, or flash the
standalone receiver: `arduino/libraries/MatrixMiniR4/examples/7-WiFi
Runtime/MiniR4_WiFi_Runtime`.

**Modem firmware**: OTA needs a recent ESP32-S3 bridge firmware (>= 0.5.0).
If uploads fail at "download", update it once via Arduino IDE → Tools →
Firmware Updater (USB).

## Connecting IDE and robot

Two ways to put them on the same network:

- **Classroom router / phone hotspot (recommended)**: click **Settings** on
  the robot in the picker and store the network's SSID/password on the robot.
  It joins on next boot. Multiple robots + one IDE on the same network work
  fine — each robot appears in the picker by name.
- **Robot access point**: with no stored network (or the router missing) the
  robot opens its own AP (password `matrix2026`). Connect your PC to it and
  search. Note: your PC loses internet while connected.

The default robot name is `MBR4-<4 hex digits>` (unique per hub). Rename it
in **Settings** — names are stored on the robot itself. The robot's own AP
is named after it: `<NAME>-xxxx` once renamed (`MBR4-xxxx` before), where
`xxxx` is a per-hub MAC suffix that is always kept — two students naming
their robots identically still get distinct networks. A rename reaches the
AP name on the next power-cycle.

**Robot network password**: the robot's own AP uses `matrix2026` by
default. Change it per robot in **Settings** (8–63 characters; classroom
tip: one shared password per team). Empty = back to the default. Password
changes, renames and the stored network all take effect after a restart —
use the **Restart robot** button to apply remotely, then reconnect with
the new password.

**Factory reset**: two ways to return name, stored WiFi and network
password to defaults: the **Factory reset** button in Settings (asks for
confirmation, applies after restart), or — with no IDE at all, e.g. a
forgotten AP password — **hold BTN_UP + BTN_DOWN while powering on** (the
OLED shows "RESET OK"). USB flashing always remains available regardless.

Notes on the stored network:
- The SSID field is the network the robot should **join** — it does not
  rename the robot's own `MBR4-xxxx` access point, whose name is fixed.
- Use the **2.4 GHz** network name; the hub's WiFi module cannot see 5 GHz.
- With a network stored, every boot spends ~10 s trying to join it before
  falling back to the AP. To make the robot forget the stored network,
  save with an **empty SSID**.

## Send VM (fast) — and what you can do while it runs

Next to "Send via WiFi" there is **Send VM (fast)** (lightning icon). It
compiles the blocks to a compact bytecode instead of a full firmware, so the
program is on the robot in well under a second rather than ~20 s. Use it to
iterate; use "Send via WiFi" to commit the final program.

Two limits, both deliberate: the bytecode has a **3584-byte ceiling**
(roughly 600-700 blocks) and not every block has a VM handler. The window
tells you when a program exceeds either, and OTA has neither limit.

**Keep this program on the robot.** Tick this before sending and the robot
stores the program permanently: it runs on every power-on with no computer
present. This is what lets you take the robot to a table with the program
already in it. To undo, press **Forget saved** in the same window, or send a
new program, or flash anything over USB — a reflash always clears a stored
program rather than running it on top of a different sketch.

### Live debug (bug icon)

With a VM program running, open the debug panel and press **Debug on**:

- the block the robot is executing **glows in the workspace**, live;
- **Pause** freezes the program exactly where it is — variables included;
- **Step** advances one instruction at a time;
- **right-click any block → Add breakpoint** to make the robot stop there
  (up to 8 at a time); the block keeps a dashed red outline;
- the panel lists every variable with its current value.

Breakpoints follow the block, not the position in the program, so they still
work after you edit and re-send. The highlight updates about 10 times a
second — that is a hardware limit of the robot's WiFi module, not a setting.

## Prints without a cable

Blocks that print to the serial monitor now also show up in the IDE's **Log**
tab while the robot is on WiFi — no cable needed. The USB serial monitor
keeps working exactly as before; this only adds a second destination.

## USB Setup — when the robot cannot be found on WiFi

The **USB Setup** button opens a panel that talks to the hub over the cable
instead of the network. Everything the WiFi settings dialog does is there —
rename, store or forget the classroom network, AP password, clear a saved
program, restart, factory reset — plus the two things you actually need when
the robot has gone missing:

- **which WiFi network to join.** The robot's own network name only changes
  when it is powered off and on again, so right after a rename or a factory
  reset the network on the air still carries the *previous* name. The panel
  shows the live one and tells you what it will become.
- **the battery voltage.** A weak pack is the classic false alarm: the robot
  works perfectly over USB and becomes unreliable or invisible over WiFi,
  because the radio's transmit bursts sag the supply. The panel warns you
  instead of letting you hunt for a software fault.

This path does not depend on the radio at all — it works with wrong
credentials stored, a forgotten AP password, or a WiFi module that has
stopped answering.

## Recovery mode (un-brick without USB)

If a program with an infinite loop (or a crash) makes the robot unreachable:
**hold BTN_UP while turning the robot on**. The OLED shows `OTA MODE` and the
robot waits for a new upload without ever running the broken program. Send a
fixed program via WiFi, done.

USB upload always keeps working regardless — it is untouched by this feature.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No robot found | Same network? Hub powered? First search after installing may hit the **Windows Firewall** prompt — allow access for the IDE and search again. |
| Robot in the picker but upload fails at "download" | Old bridge firmware (see First-time setup) — or the firewall blocked the IDE's local HTTP server (allow and retry). |
| Upload OK but robot "did not come back" | It may still be flashing — wait for the OLED, then search again. In AP mode your PC sometimes hops back to another network mid-update; reconnect to `MBR4-xxxx`. |
| Robot never answers after a bad sketch | Recovery mode (BTN_UP at power-on), then upload again. |
| Robot's WiFi is visible and your PC joins it, but the IDE still finds nothing | Power-cycle the robot — this clears a rare modem hiccup where it answers the network but not the app. If it survives a power cycle, reflash over USB; USB never depends on the WiFi module and always works. |

### What a factory reset does

Holding **BTN_UP + BTN_DOWN** while powering on clears the robot's name, the
stored WiFi network, a custom AP password, and any VM program saved on the
robot. Two things to expect afterwards:

- **The robot's WiFi name changes back to `MBR4-xxxx`.** If your PC was saved
  onto the old name it will not reconnect on its own — pick the new network
  from the Windows WiFi list (password `matrix2026`).
- **The robot reboots itself once,** a few seconds after the reset. That is
  intentional: it is how it comes back with the correct network name in one
  clean startup. Just wait for it before searching.

## Competition note

WRO and similar rulebooks forbid radio communication during scoring runs.
This feature is for the pit, practice and classroom. To compete with radios
off, flash your final program and power-cycle without BTN_UP; if the rules
require zero WiFi activity, flash a build made by the stock (non-fork) IDE
via USB, which contains no wireless runtime at all.
