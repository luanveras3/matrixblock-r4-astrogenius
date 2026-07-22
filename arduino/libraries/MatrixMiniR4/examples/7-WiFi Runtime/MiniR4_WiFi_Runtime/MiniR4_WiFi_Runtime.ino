/*
  MiniR4_WiFi_Runtime — standalone receiver sketch for the WiFi TCP + OTA
  runtime (feature/wifi-tcp-ota).

  Flash this once via USB and the hub becomes a wireless target for the
  MATRIXblock IDE: it answers UDP discovery on port 47801, serves NDJSON
  commands on TCP 47802 (telemetry, rename, WiFi credentials) and accepts
  real firmware uploads through the official OTAUpdate library — the IDE
  compiles the student's blocks to a full sketch and the hub reflashes
  itself over the air. Sketches uploaded that way embed this same runtime
  (see the IDE's arduino_wifi_wrapper), so the hub stays reachable forever.

  Network: joins the WiFi stored via the IDE ("setwifi"); with nothing
  stored (or the router missing) it opens the fallback AP
  MBR4-<mac4> / password "matrix2026".

  Recovery: hold BTN_UP while powering on -> "OTA MODE" on the OLED, user
  code never runs, hub waits for a new upload. This un-bricks a hub whose
  user sketch crashes or blocks forever, with no USB cable.

  This sketch has no user program of its own — the loop just services the
  runtime and shows status on the OLED.
*/

#include <MatrixMiniR4.h>
#include "Modules/MiniR4WiFiRuntime.h"

void setup()
{
    MiniR4.begin();
    WiFiRuntime.begin();

    MiniR4.OLED.clearDisplay();
    MiniR4.OLED.setTextSize(2);
    MiniR4.OLED.setTextColor(1);
    MiniR4.OLED.setCursor(5, 5);
    MiniR4.OLED.print("WiFi RT");
    MiniR4.OLED.setTextSize(1);
    MiniR4.OLED.setCursor(5, 26);
    MiniR4.OLED.print(WiFiRuntime.isAPMode() ? "mode: AP" : "mode: STA");
    MiniR4.OLED.display();
}

void loop()
{
    WiFiRuntime.poll();
    delay(5);
}
