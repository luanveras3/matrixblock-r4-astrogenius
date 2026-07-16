/*
 * MATRIX Mini R4 - Hardware Explorer Sketch
 *
 * Uploaded by the AstroGenius fork when the user opens
 * "Ferramentas > Explorar Hardware". Emits one compact JSON telemetry
 * line every ~100 ms over USB serial (115200 baud) with every reading
 * the board can produce without a specific user program.
 *
 * Each telemetry line is prefixed with `#EXP#` so the desktop UI can
 * filter it out from arbitrary boot spam / library init prints.
 *
 * I2C bus scanning across the 4 PCA9548A mux channels is expensive
 * (up to ~120 addresses each), so it's rotated one channel per
 * ~1s interval and the last known result is cached between scans.
 */

#include <MatrixMiniR4.h>
#include <Wire.h>

using AxisType = MiniR4Motion::AxisType;

static const uint32_t LOOP_INTERVAL_MS      = 100;
static const uint32_t I2C_SCAN_INTERVAL_MS  = 1000;
static const uint8_t  PCA9548A_ADDR         = 0x70;
static const uint8_t  I2C_SCAN_START        = 0x03;
static const uint8_t  I2C_SCAN_END          = 0x77;
static const uint8_t  I2C_CHANNELS          = 4;
static const uint8_t  MAX_I2C_HITS_PER_CH   = 8;

// Pin groups (physical Arduino UNO R4 pins behind each MATRIX port).
static const uint8_t D_PINS[4][2] = {
  {3, 2},    // D1: A, B
  {5, 4},    // D2
  {12, 11},  // D3
  {13, 10},  // D4
};
static const uint8_t A_PINS[3][2] = {
  {PIN_A1, PIN_A0},  // A1
  {PIN_A3, PIN_A2},  // A2
  {PIN_A4, PIN_A5},  // A3
};

struct I2CScanResult {
  uint8_t addrs[MAX_I2C_HITS_PER_CH];
  uint8_t count;
};

static I2CScanResult i2cCache[I2C_CHANNELS];
static uint8_t       nextI2cChannel = 0;
static uint32_t      lastLoopMs     = 0;
static uint32_t      lastI2cScanMs  = 0;

// Select one channel on the PCA9548A. channel = 0..3, or 0xFF to disable all.
static void muxSelect(uint8_t channel) {
  Wire1.beginTransmission(PCA9548A_ADDR);
  Wire1.write(channel < I2C_CHANNELS ? (uint8_t)(1 << channel) : 0);
  Wire1.endTransmission();
}

static void scanChannel(uint8_t channel) {
  muxSelect(channel);
  I2CScanResult& r = i2cCache[channel];
  r.count = 0;
  for (uint8_t addr = I2C_SCAN_START; addr <= I2C_SCAN_END; addr++) {
    Wire1.beginTransmission(addr);
    if (Wire1.endTransmission() == 0) {
      if (r.count < MAX_I2C_HITS_PER_CH) {
        r.addrs[r.count++] = addr;
      }
    }
  }
  muxSelect(0xFF);
}

static void printI2cChannel(uint8_t channel) {
  Serial.print('[');
  const I2CScanResult& r = i2cCache[channel];
  for (uint8_t i = 0; i < r.count; i++) {
    if (i) Serial.print(',');
    Serial.print(r.addrs[i]);
  }
  Serial.print(']');
}

static void printTelemetry() {
  Serial.print(F("#EXP#{\"t\":"));
  Serial.print(millis());

  // Digital ports (raw pin read on both A and B sub-pins).
  for (uint8_t p = 0; p < 4; p++) {
    Serial.print(F(",\"d"));
    Serial.print(p + 1);
    Serial.print(F("\":["));
    Serial.print(digitalRead(D_PINS[p][0]));
    Serial.print(',');
    Serial.print(digitalRead(D_PINS[p][1]));
    Serial.print(']');
  }

  // Analog ports.
  for (uint8_t p = 0; p < 3; p++) {
    Serial.print(F(",\"a"));
    Serial.print(p + 1);
    Serial.print(F("\":["));
    Serial.print(analogRead(A_PINS[p][0]));
    Serial.print(',');
    Serial.print(analogRead(A_PINS[p][1]));
    Serial.print(']');
  }

  // Onboard buttons via co-processor.
  Serial.print(F(",\"btn\":["));
  Serial.print(MiniR4.BTN_UP.getState() ? 1 : 0);
  Serial.print(',');
  Serial.print(MiniR4.BTN_DOWN.getState() ? 1 : 0);
  Serial.print(']');

  // IMU (accel + gyro, 3-axis each).
  Serial.print(F(",\"acc\":["));
  Serial.print(MiniR4.Motion.getAccel(AxisType::X), 3);
  Serial.print(',');
  Serial.print(MiniR4.Motion.getAccel(AxisType::Y), 3);
  Serial.print(',');
  Serial.print(MiniR4.Motion.getAccel(AxisType::Z), 3);
  Serial.print(']');

  Serial.print(F(",\"gyr\":["));
  Serial.print(MiniR4.Motion.getGyro(AxisType::X), 2);
  Serial.print(',');
  Serial.print(MiniR4.Motion.getGyro(AxisType::Y), 2);
  Serial.print(',');
  Serial.print(MiniR4.Motion.getGyro(AxisType::Z), 2);
  Serial.print(']');

  // Encoder speeds for the 4 motor ports (via co-processor).
  int32_t enc[4] = {0, 0, 0, 0};
  MiniR4.Motion.getAllSpeed(enc);
  Serial.print(F(",\"enc\":["));
  Serial.print(enc[0]); Serial.print(',');
  Serial.print(enc[1]); Serial.print(',');
  Serial.print(enc[2]); Serial.print(',');
  Serial.print(enc[3]);
  Serial.print(']');

  // I2C mux channels (cached; refreshed one channel per second).
  for (uint8_t ch = 0; ch < I2C_CHANNELS; ch++) {
    Serial.print(F(",\"i2c"));
    Serial.print(ch + 1);
    Serial.print(F("\":"));
    printI2cChannel(ch);
  }

  Serial.println('}');
}

void setup() {
  Serial.begin(115200);
  MiniR4.begin();
  Wire1.begin();

  // Draw a hint on the OLED so anyone holding the board knows it's not
  // running their program right now.
  MiniR4.OLED.clearDisplay();
  MiniR4.OLED.setTextSize(1);
  MiniR4.OLED.setTextColor(SSD1306_WHITE);
  MiniR4.OLED.setCursor(0, 0);
  MiniR4.OLED.println(F("EXPLORER MODE"));
  MiniR4.OLED.println(F("AstroGenius"));
  MiniR4.OLED.println(F("Sensor telemetry"));
  MiniR4.OLED.println(F("over USB serial"));
  MiniR4.OLED.display();

  // Configure D pins as inputs with pullups so an unconnected port
  // shows a stable HIGH instead of floating noise.
  for (uint8_t p = 0; p < 4; p++) {
    pinMode(D_PINS[p][0], INPUT_PULLUP);
    pinMode(D_PINS[p][1], INPUT_PULLUP);
  }

  // Initial full scan so the first telemetry line already has data.
  for (uint8_t ch = 0; ch < I2C_CHANNELS; ch++) {
    scanChannel(ch);
  }
  lastI2cScanMs = millis();
}

void loop() {
  uint32_t now = millis();

  if (now - lastI2cScanMs >= I2C_SCAN_INTERVAL_MS) {
    scanChannel(nextI2cChannel);
    nextI2cChannel = (nextI2cChannel + 1) % I2C_CHANNELS;
    lastI2cScanMs = now;
  }

  if (now - lastLoopMs >= LOOP_INTERVAL_MS) {
    printTelemetry();
    lastLoopMs = now;
  }
}
