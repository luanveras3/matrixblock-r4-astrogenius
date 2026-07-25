#!/usr/bin/env node
'use strict';
/*
 * hubctl — talk NDJSON to a Mini R4 hub from the command line.
 *
 * The IDE is the product surface; this is the bench tool for firmware work:
 * it discovers hubs over UDP and sends arbitrary commands over TCP 47802,
 * printing every frame that comes back. Written because the VM debugger and
 * persistence features need to be exercised on hardware without driving
 * Electron, and because a failing hardware test is far easier to read as a
 * frame log than as a UI screenshot.
 *
 * Usage:
 *   node tools/hubctl.js discover
 *   node tools/hubctl.js <ip> info
 *   node tools/hubctl.js <ip> send '{"t":"echo","s":"hello"}' [--listen 5]
 *   node tools/hubctl.js <ip> vmload <file.bin> [--save] [--run]
 *   node tools/hubctl.js <ip> watch 10          (stream frames for 10 s)
 *
 * Note for this machine: the robot AP lands on Windows' Public profile;
 * node.exe already has inbound allow rules there, python does not (see
 * docs/POC_OTA_FINDINGS.md).
 */
const dgram = require('dgram');
const net   = require('net');
const fs    = require('fs');

const UDP_PORT = 47801;
const TCP_PORT = 47802;

function discover(ms = 1800) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const found = new Map();
        sock.bind(() => {
            sock.setBroadcast(true);
            const msg = Buffer.from(JSON.stringify({ t: 'MBR4_DISCOVER', v: 1 }));
            for (const addr of ['255.255.255.255', '192.168.4.255']) {
                try { sock.send(msg, UDP_PORT, addr); } catch (_) {}
            }
        });
        sock.on('message', (buf, rinfo) => {
            try {
                const o = JSON.parse(buf.toString());
                if (o.t === 'MBR4_HERE') found.set(o.mac || rinfo.address,
                    Object.assign({ ip: rinfo.address }, o));
            } catch (_) {}
        });
        setTimeout(() => { try { sock.close(); } catch (_) {} resolve([...found.values()]); }, ms);
    });
}

class Hub {
    constructor(ip) { this.ip = ip; this.buf = ''; this.handlers = []; }

    connect(timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            this.sock = net.createConnection({ host: this.ip, port: TCP_PORT });
            const to = setTimeout(() => { this.sock.destroy(); reject(new Error('connect timeout')); }, timeoutMs);
            this.sock.on('connect', () => { clearTimeout(to); resolve(); });
            this.sock.on('error', (e) => { clearTimeout(to); reject(e); });
            this.sock.on('data', (d) => {
                this.buf += d.toString();
                let i;
                while ((i = this.buf.indexOf('\n')) >= 0) {
                    const line = this.buf.slice(0, i).trim();
                    this.buf = this.buf.slice(i + 1);
                    if (!line) continue;
                    let o = null;
                    try { o = JSON.parse(line); } catch (_) { console.log('  <raw> ' + line); continue; }
                    for (const h of this.handlers.slice()) h(o);
                }
            });
        });
    }

    send(obj) { this.sock.write(JSON.stringify(obj) + '\n'); }

    /** Send and wait for the first frame matching `match`. */
    request(obj, match, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            const to = setTimeout(() => { this.off(h); reject(new Error('timeout waiting for reply to ' + obj.t)); }, timeoutMs);
            const h = (o) => {
                if (!match(o)) return;
                clearTimeout(to); this.off(h); resolve(o);
            };
            this.handlers.push(h);
            this.send(obj);
        });
    }

    on(fn)  { this.handlers.push(fn); return fn; }
    off(fn) { const i = this.handlers.indexOf(fn); if (i >= 0) this.handlers.splice(i, 1); }
    close() { try { this.sock.end(); } catch (_) {} }
}

function b64(buf) { return Buffer.from(buf).toString('base64'); }

async function vmload(hub, file, opts) {
    const bytes = fs.readFileSync(file);
    console.log(`uploading ${bytes.length} bytes from ${file}`);
    const start = await hub.request({ t: 'vm_start', size: bytes.length },
        (o) => o.t === 'ack' && o.cmd === 'vm_start');
    if (!start.ok) throw new Error('vm_start rejected: ' + JSON.stringify(start));
    const CHUNK = 96;
    for (let off = 0; off < bytes.length; off += CHUNK) {
        const slice = bytes.subarray(off, Math.min(off + CHUNK, bytes.length));
        const ack = await hub.request({ t: 'vm_chunk', d: b64(slice) },
            (o) => o.t === 'ack' && o.cmd === 'vm_chunk');
        if (!ack.ok) throw new Error('chunk rejected at ' + off + ': ' + JSON.stringify(ack));
    }
    const end = await hub.request(
        { t: 'vm_end', run: !!opts.run, save: !!opts.save },
        (o) => o.t === 'ack' && (o.cmd === 'vm_end' || o.cmd === 'vm_run'), 8000);
    console.log('vm_end ->', JSON.stringify(end));
    return end;
}

(async () => {
    const argv = process.argv.slice(2);
    if (!argv.length || argv[0] === 'discover') {
        const robots = await discover(Number(argv[1]) || 1800);
        if (!robots.length) { console.log('no robots found'); process.exit(1); }
        for (const r of robots) {
            console.log(`${r.name}\t${r.ip}\tfw ${r.fw}\tmode ${r.mode}\tbatt ${r.batt}`);
        }
        return;
    }

    const ip  = argv[0];
    const cmd = argv[1];
    const hub = new Hub(ip);
    await hub.connect();

    const listenIdx = argv.indexOf('--listen');
    const listenS   = listenIdx >= 0 ? Number(argv[listenIdx + 1] || 3) : 0;

    if (cmd === 'info') {
        const o = await hub.request({ t: 'info' }, (x) => x.t === 'info');
        console.log(JSON.stringify(o, null, 2));

    } else if (cmd === 'send') {
        const obj = JSON.parse(argv[2]);
        hub.on((o) => console.log('  <- ' + JSON.stringify(o)));
        hub.send(obj);
        await new Promise((r) => setTimeout(r, Math.max(listenS, 1) * 1000));

    } else if (cmd === 'vmload') {
        hub.on((o) => { if (o.t === 'log' || o.t === 'pc') console.log('  <- ' + JSON.stringify(o)); });
        await vmload(hub, argv[2], {
            save: argv.includes('--save'), run: argv.includes('--run'),
        });
        if (listenS) await new Promise((r) => setTimeout(r, listenS * 1000));

    } else if (cmd === 'watch') {
        const secs = Number(argv[2]) || 10;
        const counts = {};
        hub.on((o) => {
            counts[o.t] = (counts[o.t] || 0) + 1;
            if (o.t !== 'tm') console.log('  <- ' + JSON.stringify(o));
        });
        await new Promise((r) => setTimeout(r, secs * 1000));
        console.log('frame counts over ' + secs + 's:', JSON.stringify(counts));

    } else {
        console.error('unknown command: ' + cmd);
        process.exitCode = 2;
    }
    hub.close();
})().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
