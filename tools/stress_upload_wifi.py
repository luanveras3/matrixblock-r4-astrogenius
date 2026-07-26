#!/usr/bin/env python3
"""Stress test for the WiFi TCP + OTA upload path (MANUAL Fase 5).

Runs N consecutive OTA uploads of the same .ota file to one robot and
reports per-round timing plus the success rate. Acceptance target from
MANUAL_WIFI_TCP_OTA.md: 20/20 uploads of a sketch >= 100 KB.

The uploaded .ota must embed the WiFi runtime (any sketch compiled by the
IDE does — the wrapper guarantees it), otherwise the robot never comes back
after round 1.

Usage:
    python stress_upload_wifi.py <sketch.ota> [rounds] [robot-ip]

With no robot-ip the script discovers robots via UDP broadcast and, if
exactly one answers, uses it. Generate the .ota with:
    node bin2ota.js <sketch.bin> <sketch.ota>
"""

import http.server
import json
import secrets
import socket
import sys
import threading
import time

UDP_PORT = 47801
TCP_PORT = 47802
HTTP_PORT = 47800
DISCOVER = json.dumps({"t": "MBR4_DISCOVER", "v": 1}).encode()


def discover(timeout=2.0):
    robots = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.bind(("", 0))
    s.settimeout(0.3)
    for target in ("255.255.255.255", "192.168.4.255"):
        try:
            s.sendto(DISCOVER, (target, UDP_PORT))
        except OSError:
            pass
    end = time.time() + timeout
    while time.time() < end:
        try:
            data, addr = s.recvfrom(512)
            obj = json.loads(data.decode())
            if obj.get("t") == "MBR4_HERE":
                obj.setdefault("ip", addr[0])
                robots[obj.get("mac", obj["ip"])] = obj
        except (socket.timeout, ValueError):
            continue
    s.close()
    return list(robots.values())


class OneFileHandler(http.server.BaseHTTPRequestHandler):
    payload = b""
    url_path = "/x.ota"

    def do_GET(self):
        if self.path != self.url_path:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(self.payload)))
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *a):
        pass


def local_ip_toward(ip):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect((ip, 1))
    out = s.getsockname()[0]
    s.close()
    return out


def ndjson_lines(sock_file):
    for line in sock_file:
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except ValueError:
            continue


def one_round(robot_ip, url):
    """Returns (ok, seconds, detail)."""
    t0 = time.time()
    try:
        tcp = socket.create_connection((robot_ip, TCP_PORT), timeout=5)
    except OSError as e:
        return False, time.time() - t0, f"connect: {e}"
    tcp.settimeout(120)
    f = tcp.makefile("r", encoding="utf-8", newline="\n")
    try:
        tcp.sendall((json.dumps({"t": "ota", "url": url}) + "\n").encode())
        last_phase = "?"
        for obj in ndjson_lines(f):
            if obj.get("t") != "ota_status":
                continue
            last_phase = obj.get("phase", "?")
            if last_phase == "error":
                return False, time.time() - t0, f"ota error {obj.get('code')} in {obj.get('detail')}"
            if last_phase == "apply":
                break
        else:
            return False, time.time() - t0, f"socket closed during {last_phase}"
    except OSError as e:
        return False, time.time() - t0, f"io: {e}"
    finally:
        tcp.close()

    # Wait for reboot + re-announce.
    deadline = time.time() + 60
    while time.time() < deadline:
        for r in discover(2.0):
            if r["ip"] == robot_ip:
                return True, time.time() - t0, f"back as {r.get('name')} fw {r.get('fw')}"
    return False, time.time() - t0, "did not come back within 60 s"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    ota_path = sys.argv[1]
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    robot_ip = sys.argv[3] if len(sys.argv) > 3 else None

    with open(ota_path, "rb") as fh:
        OneFileHandler.payload = fh.read()
    print(f"payload: {ota_path} ({len(OneFileHandler.payload)} bytes)")

    if not robot_ip:
        robots = discover()
        if len(robots) != 1:
            print(f"found {len(robots)} robot(s); pass an explicit IP")
            for r in robots:
                print("  ", r)
            sys.exit(1)
        robot_ip = robots[0]["ip"]
        print(f"robot: {robots[0].get('name')} @ {robot_ip}")

    OneFileHandler.url_path = "/" + secrets.token_hex(4) + ".ota"
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), OneFileHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://{local_ip_toward(robot_ip)}:{HTTP_PORT}{OneFileHandler.url_path}"
    print(f"serving: {url}")

    ok_count = 0
    times = []
    for i in range(1, rounds + 1):
        ok, secs, detail = one_round(robot_ip, url)
        times.append(secs)
        ok_count += ok
        print(f"round {i:2d}/{rounds}: {'OK  ' if ok else 'FAIL'} {secs:6.1f} s  {detail}")
        time.sleep(2)

    httpd.shutdown()
    print(f"\n{ok_count}/{rounds} uploads succeeded; "
          f"avg {sum(times)/len(times):.1f} s, worst {max(times):.1f} s")
    sys.exit(0 if ok_count == rounds else 1)


if __name__ == "__main__":
    main()
