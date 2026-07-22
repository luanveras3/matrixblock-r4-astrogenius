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

function oneRound(robotIp, url) {
    return new Promise(async (resolve) => {
        const t0 = Date.now();
        let lastPhase = 'connect';
        let sock;
        try {
            sock = await new Promise((res, rej) => {
                const s = net.createConnection({ host: robotIp, port: TCP_PORT });
                const timer = setTimeout(() => { s.destroy(); rej(new Error('connect timeout')); }, 5000);
                s.once('connect', () => { clearTimeout(timer); res(s); });
                s.once('error', (e) => { clearTimeout(timer); rej(e); });
            });
        } catch (e) {
            resolve({ ok: false, secs: (Date.now() - t0) / 1000, detail: `connect: ${e.message}` });
            return;
        }

        let buf = '';
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            try { sock.destroy(); } catch (e) {}
            resolve(result);
        };

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
                        finish({ ok: false, secs: (Date.now() - t0) / 1000,
                                 detail: `ota error ${o.code} (${o.detail})` });
                        return;
                    }
                    if (o.phase === 'apply') {
                        // Success handshake: robot will reboot after this frame.
                        // Wait for socket close (or the discover loop below).
                    }
                } catch (e) {}
            }
        });
        sock.on('close', async () => {
            if (done) return;
            if (lastPhase !== 'apply') {
                finish({ ok: false, secs: (Date.now() - t0) / 1000,
                         detail: `socket closed during ${lastPhase}` });
                return;
            }
            // Reboot + re-announce.
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) {
                const robots = await discover(2000);
                const back = robots.find((r) => r.ip === robotIp);
                if (back) {
                    finish({ ok: true, secs: (Date.now() - t0) / 1000,
                             detail: `back as ${back.name}` });
                    return;
                }
            }
            finish({ ok: false, secs: (Date.now() - t0) / 1000,
                     detail: 'did not come back within 60 s' });
        });
        sock.on('error', () => {});

        sock.write(JSON.stringify({ t: 'ota', url }) + '\n');
        setTimeout(() => {
            if (!done) finish({ ok: false, secs: (Date.now() - t0) / 1000,
                                detail: `overall timeout in ${lastPhase}` });
        }, 180000);
    });
}

async function main() {
    const [otaPath, roundsStr, robotIpArg] = process.argv.slice(2);
    if (!otaPath) {
        console.error('Usage: node stress_upload_wifi.js <sketch.ota> [rounds] [robot-ip]');
        process.exit(1);
    }
    const rounds = parseInt(roundsStr, 10) || 20;
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
        const r = await oneRound(robotIp, url);
        if (r.ok) okCount++;
        times.push(r.secs);
        console.log(`${label}: ${r.ok ? 'OK  ' : 'FAIL'} ${r.secs.toFixed(1).padStart(6)} s  ${r.detail}`);
        await new Promise((res) => setTimeout(res, 2000));
    }

    server.close();
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const worst = Math.max(...times);
    console.log(`\n${okCount}/${rounds} uploads succeeded; ` +
                `avg ${avg.toFixed(1)} s, worst ${worst.toFixed(1)} s`);
    process.exit(okCount === rounds ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
