/*
  OTA_POC — Fase 0 proof-of-concept for the WiFi TCP + OTA feature.

  Validates the three unknowns from MANUAL_WIFI_TCP_OTA.md §Fase 0 on real
  hardware, WITHOUT touching the product code:

    1. Does ota.download() accept a plain http:// URL (no TLS)?
    2. How long does download + verify + update take for a real sketch?
    3. Does OTA work in AP mode (app joins the robot's AP and serves the file)?

  Usage:
    - Put your network in arduino_secrets.h (SECRET_SSID / SECRET_PASS).
      Leave SECRET_SSID empty ("") to start in AP mode instead
      (AP name MBR4-POC, password mbr4poc123, robot IP 192.168.4.1).
    - Flash via USB, open Serial Monitor @115200.
    - Serve an .ota file from your PC, e.g.:
        python -m http.server 47800
    - In the Serial Monitor, send:
        u http://<pc-ip>:47800/blink.ota
      The sketch downloads, verifies, applies and reboots, printing the
      elapsed time of each phase. Record results in docs/POC_OTA_FINDINGS.md.
*/

#include "WiFiS3.h"
#include "OTAUpdate.h"
#include "arduino_secrets.h"

OTAUpdate ota;
static bool apMode = false;

static void printNet()
{
    Serial.print("mode: ");
    Serial.println(apMode ? "AP" : "STA");
    Serial.print("SSID: ");
    Serial.println(WiFi.SSID());
    Serial.print("IP:   ");
    Serial.println(apMode ? IPAddress(192, 168, 4, 1) : WiFi.localIP());
    Serial.print("bridge fw: ");
    Serial.println(WiFi.firmwareVersion());
}

void setup()
{
    Serial.begin(115200);
    while (!Serial) { }

    if (WiFi.status() == WL_NO_MODULE) {
        Serial.println("FATAL: no WiFi module");
        while (true) { }
    }

    String fv = WiFi.firmwareVersion();
    if (fv < WIFI_FIRMWARE_LATEST_VERSION) {
        Serial.print("WARNING: bridge firmware ");
        Serial.print(fv);
        Serial.println(" is older than latest; OTA may need an upgrade (Fase 0 item 1)");
    }

    if (strlen(SECRET_SSID) == 0) {
        apMode = true;
        Serial.println("starting AP MBR4-POC (pass mbr4poc123)...");
        if (WiFi.beginAP("MBR4-POC", "mbr4poc123") != WL_AP_LISTENING) {
            Serial.println("FATAL: beginAP failed");
            while (true) { }
        }
    } else {
        Serial.print("connecting to ");
        Serial.println(SECRET_SSID);
        while (WiFi.begin(SECRET_SSID, SECRET_PASS) != WL_CONNECTED) {
            Serial.print(".");
            delay(1000);
        }
        Serial.println();
    }

    printNet();
    Serial.println("ready — send:  u http://<pc-ip>:47800/<file>.ota");
}

static void runOta(const String& url)
{
    unsigned long t0, tDownload, tVerify;

    Serial.print("OTA from: ");
    Serial.println(url);

    int ret = ota.begin("/update.bin");
    if (ret != OTAUpdate::OTA_ERROR_NONE) {
        Serial.print("ota.begin() error: ");
        Serial.println(ret);
        return;
    }

    // No setCACert(): the whole point is testing plain http://.
    t0  = millis();
    int size = ota.download(url.c_str(), "/update.bin");
    tDownload = millis() - t0;
    if (size <= 0) {
        Serial.print("ota.download() error: ");
        Serial.println(size);
        return;
    }
    Serial.print("downloaded ");
    Serial.print(size);
    Serial.print(" bytes in ");
    Serial.print(tDownload);
    Serial.println(" ms");

    t0  = millis();
    ret = ota.verify();
    tVerify = millis() - t0;
    if (ret != OTAUpdate::OTA_ERROR_NONE) {
        Serial.print("ota.verify() error: ");
        Serial.println(ret);
        return;
    }
    Serial.print("verified in ");
    Serial.print(tVerify);
    Serial.println(" ms");

    Serial.println("applying update (board will reboot)...");
    Serial.flush();
    t0  = millis();
    ret = ota.update("/update.bin");
    // Only reached on failure — success reboots into the new sketch.
    Serial.print("ota.update() error: ");
    Serial.print(ret);
    Serial.print(" after ");
    Serial.print(millis() - t0);
    Serial.println(" ms");
}

void loop()
{
    if (Serial.available()) {
        String line = Serial.readStringUntil('\n');
        line.trim();
        if (line.startsWith("u ")) {
            runOta(line.substring(2));
        } else if (line == "i") {
            printNet();
        } else if (line.length()) {
            Serial.println("commands:  u <url>  |  i (info)");
        }
    }
    delay(10);
}
