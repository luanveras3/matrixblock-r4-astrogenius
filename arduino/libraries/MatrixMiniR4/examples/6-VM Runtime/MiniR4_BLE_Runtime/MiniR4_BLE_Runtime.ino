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
    MiniR4.begin();
    Serial.begin(115200);
    BLERuntime.begin();
}

void loop()
{
    BLERuntime.poll();
    // No user logic -- this sketch exists only to host the runtime.
}
