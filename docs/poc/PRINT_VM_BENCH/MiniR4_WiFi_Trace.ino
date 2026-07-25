/*
  Debug build of the WiFi runtime: identical to the 7-WiFi Runtime example
  but with Serial up before WiFiRuntime.begin(), so the WIFIRT_TRACE
  checkpoints inside the runtime are visible on USB.

  Compile with:
    --build-property "build.extra_flags=-DMINIR4_WIFI_RUNTIME_DEBUG"
  (the define has to reach MiniR4WiFiRuntime.cpp, a separate translation
  unit, so putting it in this file would do nothing.)
*/
#include <MatrixMiniR4.h>
#include "Modules/MiniR4WiFiRuntime.h"

void setup()
{
    Serial.begin(115200);
    const uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 2000) { }
    Serial.println(F("=== BOOT ==="));

    MiniR4.begin();
    Serial.println(F("MiniR4.begin done"));

    WiFiRuntime.begin();
    Serial.print(F("WiFiRuntime.begin returned, netUp="));
    Serial.print(WiFiRuntime.isNetworkUp());
    Serial.print(F(" ap="));
    Serial.println(WiFiRuntime.isAPMode());
}

void loop()
{
    static uint32_t last = 0;
    WiFiRuntime.poll();
    if (millis() - last > 3000) {   // heartbeat proves the sketch is alive
        last = millis();
        Serial.print(F("alive t="));
        Serial.println(millis() / 1000);
    }
    delay(5);
}
