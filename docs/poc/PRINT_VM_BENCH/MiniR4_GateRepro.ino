/*
  Acceptance test for waitForStart() — the "press to start" gate that opens
  practically every student program, made reachable and remotely startable.

  The robot must stay fully discoverable while parked here, and must start
  either from BTN_UP or from {"t":"start"} sent by the IDE.
*/
#include <MatrixMiniR4.h>
#include "Modules/MiniR4WiFiRuntime.h"
#define MINIR4_SKETCH_ID ((uint32_t)0x51A7E01Du)

static void userSetup() { }

static void userLoop()
{
    MiniR4.OLED.clearDisplay();
    MiniR4.OLED.setCursor(10, 10);
    MiniR4.OLED.print("PRESS UP");
    MiniR4.OLED.display();

    WiFiRuntime.waitForStart();

    MiniR4.OLED.clearDisplay();
    MiniR4.OLED.setCursor(10, 10);
    MiniR4.OLED.print("RUNNING");
    MiniR4.OLED.display();

    // Run until BTN_DOWN, then go back to the gate.
    while (WiFiRuntime.tick(!MiniR4.BTN_DOWN.getState()))
    {
        WiFiRuntime.logPrintln("running");
        WiFiRuntime.safeDelay(1000);
    }
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
