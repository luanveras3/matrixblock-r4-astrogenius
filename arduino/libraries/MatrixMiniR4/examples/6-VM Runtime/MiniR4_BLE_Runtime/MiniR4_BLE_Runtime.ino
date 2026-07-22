/*
  MiniR4_BLE_Runtime
  ------------------
  Standalone runtime sketch: turns the R4 into a bytecode target that does
  nothing on its own, only receives programs over BLE and executes them.

  Most people don't need this sketch. The MATRIXblock IDE now embeds the
  BLE runtime into every USB upload automatically (see MiniR4BLERuntime.h),
  so any compiled program stays reachable over BLE for future uploads.
  This sketch is kept as a reference / bare-metal testbed for the runtime
  library itself.

  Wire protocol, LED states, and dataflash layout are documented in
  ../../src/Modules/MiniR4BLERuntime.h.

  BLE kill switch: hold BTN_UP + BTN_DOWN together for 3 seconds to toggle
  BLE on/off (LED1 flashes green when re-enabled, red when disabled).
  The setting persists across power cycles.
*/
#include "MatrixMiniR4.h"
#include "Modules/MiniR4BLERuntime.h"

void setup()
{
    Serial.begin(115200);
    // Give the USB serial a moment to come up so the first print isn't lost.
    // Bounded wait: if nobody's listening we don't want to block boot forever.
    for (uint32_t t0 = millis(); !Serial && (millis() - t0) < 2000; ) {}

    Serial.print(F("[RAM] pre-MiniR4.begin(): "));
    Serial.println((unsigned long)MiniR4BLERuntimeClass::freeRam());

    MiniR4.begin();
    Serial.print(F("[RAM] post-MiniR4.begin(): "));
    Serial.println((unsigned long)MiniR4BLERuntimeClass::freeRam());

    BLERuntime.begin();
    Serial.print(F("[RAM] post-BLERuntime.begin(): "));
    Serial.println((unsigned long)MiniR4BLERuntimeClass::freeRam());
}

void loop()
{
    BLERuntime.poll();
    // Periodic RAM probe. Catches slow growth (leaks, fragmentation) that a
    // one-shot boot-time reading would miss.
    static uint32_t lastRamPrint = 0;
    const uint32_t now = millis();
    if (now - lastRamPrint > 5000) {
        lastRamPrint = now;
        Serial.print(F("[RAM] loop: "));
        Serial.println((unsigned long)MiniR4BLERuntimeClass::freeRam());
    }
    // No user logic -- this sketch exists only to host the runtime.
}
