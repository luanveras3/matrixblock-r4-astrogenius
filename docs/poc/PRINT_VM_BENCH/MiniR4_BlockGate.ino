#include "MatrixMiniR4.h"
#include "Modules/MiniR4WiFiRuntime.h"
#define MINIR4_SKETCH_ID ((uint32_t)0x93D930CEu)
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
  WiFiRuntime.waitForStart();
  MiniR4.OLED.clearDisplay();
  MiniR4.OLED.setCursor(10, 10);
  MiniR4.OLED.print("RUNNING");
  MiniR4.OLED.display();
  while(WiFiRuntime.tick(!MiniR4.BTN_DOWN.getState()))
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
