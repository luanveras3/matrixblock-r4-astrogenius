/*
  Bench sketch mirroring exactly what arduino_wifi_wrapper.js emits, used to
  validate two things on real hardware that no host-side test can cover:

   1. R3 v2 — WiFiRuntime.logPrint/logPrintln mirror the print blocks to the
      wireless console while still writing to USB Serial. The wrapper rewrites
      Serial.print(x) into WiFiRuntime.logPrint(x); this file is written the
      way that rewrite comes out.
   2. VM persistence invalidation — this sketch declares its own
      MINIR4_SKETCH_ID, so a VM program saved against a different sketch must
      be dropped at boot instead of auto-running.
*/
#include <MatrixMiniR4.h>
#include "Modules/MiniR4WiFiRuntime.h"
#define MINIR4_SKETCH_ID ((uint32_t)0xABCD1234u)

static void userSetup()
{
    Serial.begin(9600);
}

static void userLoop()
{
    static uint32_t n = 0;
    n++;
    // print/print/println must arrive as ONE console line: "count=<n> ok"
    WiFiRuntime.logPrint("count=");
    WiFiRuntime.logPrint(n);
    WiFiRuntime.logPrintln(" ok");
    // a lone println with an argument is its own line
    WiFiRuntime.logPrintln(MiniR4.PWR.getBattVoltage());
    WiFiRuntime.safeDelay(2000);
}

void setup()
{
    MiniR4.begin();
    WiFiRuntime.setSketchId(MINIR4_SKETCH_ID);
    WiFiRuntime.begin();
    userSetup();
}

void loop()
{
    WiFiRuntime.poll();
    if (!WiFiRuntime.isRunningVM()) { userLoop(); }
}
