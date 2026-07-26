/*
  Bench sketch for the outgoing-log rate limit.

  Prints as fast as the loop can run — the shape of the reported program,
  which had two logPrintln calls inside a `while` with no delay. Every log
  frame costs a synchronous ~100 ms modem write, so unthrottled this starves
  telemetry and makes the robot sluggish while flooding a console nobody can
  read.

  Expected with the limit in place: a burst of ~8 lines immediately, then a
  steady ~5 lines/s, with periodic "N line(s) dropped" notes so the student
  can tell output was thrown away rather than silently lost. USB Serial is
  NOT throttled and should keep printing at full speed.
*/
#include <MatrixMiniR4.h>
#include "Modules/MiniR4WiFiRuntime.h"
#define MINIR4_SKETCH_ID ((uint32_t)0x10F1000Du)

static void userSetup() { }

static void userLoop()
{
    static uint32_t n = 0;
    WiFiRuntime.logPrint("line ");
    WiFiRuntime.logPrintln(n++);
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
