/*
  Acceptance test for the blocking-loop fix.

  This is the user's reported reproduction, written exactly as
  arduino_wifi_wrapper.js now emits it: the "wait until BTN_UP is pressed"
  gate that opens practically every student program, with its condition
  wrapped in WiFiRuntime.tick().

  Before the fix this sketch made the hub invisible on WiFi AND on USB from
  the moment it booted. The hub must now stay fully discoverable while parked
  on the gate, with no button ever pressed.
*/
#include <MatrixMiniR4.h>
#include "Modules/MiniR4WiFiRuntime.h"
#define MINIR4_SKETCH_ID ((uint32_t)0x51A7E01Du)

static void userSetup()
{
    Serial.begin(9600);
}

static void userLoop()
{
    MiniR4.OLED.clearDisplay();
    MiniR4.OLED.setCursor(10, 10);
    MiniR4.OLED.print("PRESS UP");
    MiniR4.OLED.display();
    while(WiFiRuntime.tick(!MiniR4.BTN_UP.getState()));
    MiniR4.OLED.clearDisplay();
    MiniR4.OLED.setCursor(10, 10);
    MiniR4.OLED.print("RUNNING");
    MiniR4.OLED.display();
    while(WiFiRuntime.tick(!MiniR4.BTN_DOWN.getState()))
    {
        WiFiRuntime.logPrintln("running");
        WiFiRuntime.safeDelay(500);
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
