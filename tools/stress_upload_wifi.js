#!/usr/bin/env node
/*
 * Stress test for the WiFi TCP + OTA upload path (MANUAL_WIFI_TCP_OTA.md
 * Fase 5). Runs N consecutive OTA uploads of the same .ota against one
 * robot and reports per-round timing plus the success rate.
 *
 * Node port of tools/stress_upload_wifi.py. The reason a Node port exists
 * at all: on Windows, when the PC has joined a robot AP, that network
 * lands on the Public firewall profile and the built-in Python HTTP
 * server (Microsoft Store distribution) has no Public inbound rule --
 * so `python -m http.server` gets blocked and OTA returns error -6
 * (ServerConnectError). Node.exe usually DOES have Public allow rules
 * from previous consent prompts, so this version serves + orchestrates
 * entirely in Node. Zero deps. Documented in docs/POC_OTA_FINDINGS.md
 * §"Bugs found on hardware".
 *
 * Usage:
 *   node stress_upload_wifi.js <sketch.ota> [rounds] [robot-ip]
 *
 * With no robot-ip the script discovers via UDP broadcast and, if
 * exactly one robot answers, uses it. Generate the .ota with:
 *   node tools/bin2ota.js <sketch.bin> <sketch.ota>
 */

'use strict';

const dgram = require('dgram');
const net = require('net');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');

const HTTP_PORT = 47800;
const UDP_PORT = 47801;
const TCP_PORT = 47802;
const DISCOVER = JSON.stringify({ t: 'MBR4_DISCOVER', v: 1 });

function discover(timeoutMs = 2000) {
    return new Promise((resolve) => {
        const robots = new Map();
        let sock;
        try { sock = dgram.createSocket('udp4'); } catch (e) { resolve([]); return; }
        const finish = () => {
            try { sock.close(); } catch (e) {}
            resolve(Array.from(robots.values()));
        };
        sock.on('error', finish);
        sock.on('message', (msg, rinfo) => {
            try {
                const obj = JSON.parse(msg.toString());
                if (obj && obj.t === 'MBR4_HERE') {
                    obj.ip = obj.ip || rinfo.address;
                    robots.set(obj.mac || obj.ip, obj);
                }
            } catch (e) {}
        });
        sock.bind(0, () => {
            try { sock.setBroadcast(true); } catch (e) {}
            const buf = Buffer.from(DISCOVER);
            for (const t of ['255.255.255.255', '192.168.4.255']) {
                try { sock.send(buf, UDP_PORT, t); } catch (e) {}
            }
            setTimeout(finish, timeoutMs);
        });
    });
}

function localIpToward(ip) {
    return new Promise((resolve) => {
        const s = net.createConnection({ host: ip, port: TCP_PORT });
        s.once('connect', () => { const a = s.localAddress; s.destroy(); resolve(a); });
        s.once('error', () => resolve(null));
    });
}

function serveOta(buf) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': buf.length,
            });
            res.end(buf);
        });
        server.on('error', reject);
        server.listen(HTTP_PORT, '0.0.0.0', () => resolve(server));
    });
}

// Windows-only WLAN association refresh. When the robot reboots mid-OTA,
// the PC keeps the "connected" state but the ARP entry goes stale — every
// subsequent TCP connect times out even though the WLAN says everything is
// fine (observed on the first 20-round run: 1 round hung in "apply" for
// 180 s, 19 rounds connect-timed-out afterwards). netsh wlan
// disconnect/connect forces a fresh association + DHCP + ARP.
function refreshWlan(ssid) {
    if (process.platform !== 'win32' || !ssid) return Promise.resolve();
    return new Promise((resolve) => {
        execFile('netsh', ['wlan', 'disconnect'], () => {
            setTimeout(() => {
                execFile('netsh', ['wlan', 'connect', `name=${ssid}`], () => {
                    setTimeout(resolve, 8000);   // let DHCP settle
                });
            }, 2000);
        });
    });
}

async function oneRound(robotIp, url, wlanSsid) {
    const t0 = Date.now();

    // 1. TCP connect. If this fails, the ARP entry is likely stale — try
    //    one WLAN refresh + retry before giving up.
    let sock;
    const connectOnce = () => new Promise((res, rej) => {
        const s = net.createConnection({ host: robotIp, port: TCP_PORT });
        const timer = setTimeout(() => { s.destroy(); rej(new Error('connect timeout')); }, 5000);
        s.once('connect', () => { clearTimeout(timer); res(s); });
        s.once('error', (e) => { clearTimeout(timer); rej(e); });
    });
    try {
        sock = await connectOnce();
    } catch (e) {
        if (wlanSsid) {
            await refreshWlan(wlanSsid);
            try { sock = await connectOnce(); }
            catch (e2) { return { ok: false, secs: (Date.now() - t0) / 1000, detail: `connect after wlan refresh: ${e2.message}` }; }
        } else {
            return { ok: false, secs: (Date.now() - t0) / 1000, detail: `connect: ${e.message}` };
        }
    }

    // 2. Stream ota_status frames. "apply" (or "error") is a terminal event;
    //    socket close during OTA also counts as the robot rebooting mid-
    //    handshake if lastPhase was verify or apply. Anything else is a
    //    real failure.
    const applied = await new Promise((resolve) => {
        let buf = '';
        let lastPhase = 'ota';
        let settled = false;
        const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

        sock.on('data', (d) => {
            buf += d.toString();
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 1);
                try {
                    const o = JSON.parse(line);
                    if (o.t !== 'ota_status') continue;
                    lastPhase = o.phase;
                    if (o.phase === 'error') {
                        settle({ ok: false, detail: `ota error ${o.code} (${o.detail})` });
                    } else if (o.phase === 'apply') {
                        settle({ ok: true, detail: 'apply frame received' });
                    }
                } catch (_) {}
            }
        });
        sock.on('close', () => {
            // Robot may reset before flushing the apply frame — count verify
            // and apply as success signals when the socket closes clean.
            if (lastPhase === 'apply' || lastPhase === 'verify') {
                settle({ ok: true, detail: `socket closed during ${lastPhase} (reboot)` });
            } else {
                settle({ ok: false, detail: `socket closed during ${lastPhase}` });
            }
        });
        sock.on('error', () => {});

        sock.write(JSON.stringify({ t: 'ota', url }) + '\n');

        setTimeout(() => settle({ ok: false, detail: `overall timeout in ${lastPhase}` }), 90000);
    });
    try { sock.destroy(); } catch (_) {}

    if (!applied.ok) {
        return { ok: false, secs: (Date.now() - t0) / 1000, detail: applied.detail };
    }

    // 3. Robot rebooting — wait for it to re-announce. Refresh WLAN once
    //    partway through: the AP may cycle SSID/beacon and Windows keeps a
    //    stale association until forced to redo the DHCP handshake.
    let refreshed = false;
    const deadline = Date.now() + 60000;
    await new Promise((res) => setTimeout(res, 3000));   // let the reset land
    while (Date.now() < deadline) {
        const robots = await discover(2000);
        const back = robots.find((r) => r.ip === robotIp);
        if (back) return { ok: true, secs: (Date.now() - t0) / 1000, detail: `back as ${back.name}` };
        if (!refreshed && wlanSsid && Date.now() - t0 > 20000) {
            refreshed = true;
            await refreshWlan(wlanSsid);
        }
    }
    return { ok: false, secs: (Date.now() - t0) / 1000, detail: 'did not come back within 60 s' };
}

async function main() {
    const [otaPath, roundsStr, robotIpArg, wlanSsidArg] = process.argv.slice(2);
    if (!otaPath) {
        console.error('Usage: node stress_upload_wifi.js <sketch.ota> [rounds] [robot-ip] [wlan-ssid]');
        console.error('  wlan-ssid: pass the SSID of the robot AP to force a Windows WLAN');
        console.error('             refresh after each round (avoids stale ARP on AP mode).');
        process.exit(1);
    }
    const rounds = parseInt(roundsStr, 10) || 20;
    const wlanSsid = wlanSsidArg || '';
    const otaBuf = fs.readFileSync(otaPath);
    console.log(`payload: ${otaPath} (${otaBuf.length} bytes)`);

    let robotIp = robotIpArg;
    if (!robotIp) {
        const found = await discover(2500);
        if (found.length !== 1) {
            console.error(`found ${found.length} robot(s); pass an explicit IP`);
            for (const r of found) console.error(' ', JSON.stringify(r));
            process.exit(1);
        }
        robotIp = found[0].ip;
        console.log(`robot: ${found[0].name} @ ${robotIp}`);
    }

    const server = await serveOta(otaBuf);
    const myIp = await localIpToward(robotIp) || '192.168.4.2';
    const url = `http://${myIp}:${HTTP_PORT}/sketch.ota`;
    console.log(`serving: ${url}`);

    let okCount = 0;
    const times = [];
    for (let i = 1; i <= rounds; i++) {
        const label = `round ${String(i).padStart(2)}/${rounds}`;
        const r = await oneRound(robotIp, url, wlanSsid);
        if (r.ok) okCount++;
        times.push(r.secs);
        console.log(`${label}: ${r.ok ? 'OK  ' : 'FAIL'} ${r.secs.toFixed(1).padStart(6)} s  ${r.detail}`);
        // Small pause; the per-round logic already refreshes WLAN when it
        // needs to (on a failed connect, or 20 s into the reboot wait).
        await new Promise((res) => setTimeout(res, 3000));
    }

    server.close();
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const worst = Math.max(...times);
    console.log(`\n${okCount}/${rounds} uploads succeeded; ` +
                `avg ${avg.toFixed(1)} s, worst ${worst.toFixed(1)} s`);
    process.exit(okCount === rounds ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
