'use strict';
/*
 * MATRIXblock WiFi TCP + OTA uploader (feature/wifi-tcp-ota).
 *
 * Adds a "Send via WiFi" button next to the USB upload button. Clicking it:
 *   1. generates the C++ sketch from the workspace (the WiFi wrapper in
 *      arduino_wifi_wrapper.js embeds the MiniR4WiFiRuntime automatically);
 *   2. compiles it with the bundled arduino-cli (same toolchain as USB);
 *   3. converts the .bin to Arduino .ota format (LZSS + header — inline
 *      port of tools/bin2ota.js, which owns the tests for this code);
 *   4. discovers robots on the LAN (UDP broadcast, port 47801) and shows
 *      a picker (name, IP, battery, fw, mode) — multi-robot classrooms
 *      pick exactly which hub receives the program;
 *   5. serves the .ota from an ephemeral HTTP server (port 47800 or an
 *      OS-assigned fallback) locked to the robot's IP + a random token;
 *   6. sends {"t":"ota",...} over TCP 47802 and relays live progress
 *      (download % / verify / apply) into the modal;
 *   7. waits for the hub to reboot and re-announce itself, then reports
 *      success. One automatic retry on transient failures.
 *
 * The picker doubles as the robot settings dialog: rename the hub and store
 * WiFi credentials (setname / setwifi commands).
 *
 * Everything runs in the renderer — this app ships with nodeIntegration on
 * (main.html itself does require("jquery")), so dgram/net/http/child_process
 * are available directly; no IPC hop needed.
 *
 * The existing USB compile+upload path is not modified.
 */
(function () {
    const dgram = require('dgram');
    const net   = require('net');
    const http  = require('http');
    const fs    = require('fs');
    const path  = require('path');
    const os    = require('os');
    const { spawn } = require('child_process');

    // --- Protocol constants (must match MiniR4WiFiRuntime.cpp) ---------------
    const UDP_DISCOVERY_PORT = 47801;
    const TCP_COMMAND_PORT   = 47802;
    const HTTP_PREFERRED_PORT = 47800;
    const DISCOVER_MSG = JSON.stringify({ t: 'MBR4_DISCOVER', v: 1 });
    const FQBN = 'arduino:renesas_uno:unor4wifi';

    // --- i18n (self-contained; reads locale from Blockly.ScratchMsgs) --------
    const STRINGS = {
        en: {
            btnLabel:        'Send via WiFi',
            btnTitle:        'Compile the blocks and upload to a robot over WiFi (OTA)',
            modalTitle:      'WiFi upload',
            searching:       'Searching for robots...',
            found:           '%d robot(s) found.',
            noneFound:       'No robot found. Check that the hub is on and on the same network (or connect to its MBR4-xxxx access point). The first search may also trigger a Windows Firewall prompt — allow access and try again.',
            refresh:         'Search again',
            cancel:          'Cancel',
            close:           'Close',
            send:            'Send',
            settings:        'Settings',
            battery:         'battery',
            robotMode_ap:    'access point',
            robotMode_sta:   'network',
            phase_generate:  'Generating code...',
            phase_compile:   'Compiling (arduino-cli)...',
            phase_convert:   'Converting to .ota...',
            phase_serve:     'Starting local file server...',
            phase_send:      'Sending to %s...',
            phase_download:  'Robot downloading: %d%%',
            phase_verify:    'Verifying on the robot...',
            phase_apply:     'Flashing (the robot will reboot)...',
            phase_reboot:    'Waiting for the robot to come back...',
            done:            'Done! %s is running the new program (%d s total).',
            retrying:        'Attempt failed (%s). Retrying once...',
            genFail:         'Could not generate code from the workspace: %s',
            compileFail:     'Compile failed. Full output below.',
            compiledOK:      'Compiled: %s',
            otaSize:         'OTA file: %d bytes (%d%% of the binary).',
            connectFail:     'Could not reach %s port %d: %s',
            otaError:        'Robot reported an OTA error (phase %s, code %d).',
            rebootTimeout:   'The robot did not come back after the update. It may still be flashing — wait for its OLED, then search again.',
            cliMissing:      'arduino-cli not found (looked in %s).',
            emptyWorkspace:  'The workspace is empty.',
            settingsTitle:   'Robot settings — %s',
            nameLabel:       'Robot name',
            nameHint:        'Up to 24 printable ASCII characters. Shown in the picker; after the next power-cycle it also names the robot\'s own network (NAME-xxxx).',
            wifiLabel:       'Classroom WiFi (stored on the robot)',
            wifiHint:        'The school/home network the robot should JOIN (2.4 GHz only) — not the robot\'s own network, which is named NAME-xxxx (or MBR4-xxxx) automatically. Save with an empty SSID to make the robot forget the stored network.',
            ssidPh:          'Network name (SSID)',
            passPh:          'Password',
            saveName:        'Save name',
            saveWifi:        'Save WiFi',
            saved:           'Saved.',
            saveFail:        'The robot rejected the change.',
            back:            'Back',
            apPassLabel:     'Robot network password',
            apPassPh:        'New password (8-63 characters)',
            saveApPass:      'Save password',
            apPassHint:      'Password of the robot\'s own network. Empty = back to the default "matrix2026". Takes effect after the robot restarts — reconnect using the new password. Forgot it? Hold BTN_UP + BTN_DOWN while powering on to factory-reset.',
            rebootBtn:       'Restart robot',
            factoryBtn:      'Factory reset',
            factoryConfirm:  'Reset this robot to factory defaults? Name, stored WiFi and network password all go back to default (applies after restart).',
            rebootSent:      'Restart command sent — the robot is coming back up.',
        },
        'pt-BR': {
            btnLabel:        'Enviar via WiFi',
            btnTitle:        'Compilar os blocos e enviar para um robô via WiFi (OTA)',
            modalTitle:      'Envio via WiFi',
            searching:       'Procurando robôs...',
            found:           '%d robô(s) encontrado(s).',
            noneFound:       'Nenhum robô encontrado. Confira se o hub está ligado e na mesma rede (ou conecte-se ao ponto de acesso MBR4-xxxx dele). A primeira busca também pode disparar o aviso do Firewall do Windows — permita o acesso e tente de novo.',
            refresh:         'Buscar de novo',
            cancel:          'Cancelar',
            close:           'Fechar',
            send:            'Enviar',
            settings:        'Configurar',
            battery:         'bateria',
            robotMode_ap:    'ponto de acesso',
            robotMode_sta:   'rede',
            phase_generate:  'Gerando código...',
            phase_compile:   'Compilando (arduino-cli)...',
            phase_convert:   'Convertendo para .ota...',
            phase_serve:     'Iniciando servidor local...',
            phase_send:      'Enviando para %s...',
            phase_download:  'Robô baixando: %d%%',
            phase_verify:    'Verificando no robô...',
            phase_apply:     'Gravando (o robô vai reiniciar)...',
            phase_reboot:    'Aguardando o robô voltar...',
            done:            'Pronto! %s está rodando o novo programa (%d s no total).',
            retrying:        'Tentativa falhou (%s). Tentando mais uma vez...',
            genFail:         'Não consegui gerar o código dos blocos: %s',
            compileFail:     'Falha na compilação. Saída completa abaixo.',
            compiledOK:      'Compilado: %s',
            otaSize:         'Arquivo OTA: %d bytes (%d%% do binário).',
            connectFail:     'Não consegui falar com %s porta %d: %s',
            otaError:        'O robô reportou erro de OTA (fase %s, código %d).',
            rebootTimeout:   'O robô não voltou depois da atualização. Ele ainda pode estar gravando — espere o OLED e busque de novo.',
            cliMissing:      'arduino-cli não encontrado (procurei em %s).',
            emptyWorkspace:  'A área de blocos está vazia.',
            settingsTitle:   'Configurações do robô — %s',
            nameLabel:       'Nome do robô',
            nameHint:        'Até 24 caracteres ASCII. Aparece na lista de robôs; após religar o robô, também vira o nome da rede dele (NOME-xxxx).',
            wifiLabel:       'WiFi da sala (fica salvo no robô)',
            wifiHint:        'A rede da escola/casa em que o robô deve ENTRAR (só 2.4 GHz) — não é a rede do próprio robô, que se chama NOME-xxxx (ou MBR4-xxxx) automaticamente. Salvar com SSID vazio faz o robô esquecer a rede.',
            ssidPh:          'Nome da rede (SSID)',
            passPh:          'Senha',
            saveName:        'Salvar nome',
            saveWifi:        'Salvar WiFi',
            saved:           'Salvo.',
            saveFail:        'O robô recusou a alteração.',
            back:            'Voltar',
            apPassLabel:     'Senha da rede do robô',
            apPassPh:        'Nova senha (8-63 caracteres)',
            saveApPass:      'Salvar senha',
            apPassHint:      'Senha da rede do próprio robô. Vazio = volta ao padrão "matrix2026". Vale depois de reiniciar o robô — reconecte usando a senha nova. Esqueceu? Segure BTN_UP + BTN_DOWN ao ligar pra restaurar o padrão de fábrica.',
            rebootBtn:       'Reiniciar robô',
            factoryBtn:      'Restaurar padrão',
            factoryConfirm:  'Restaurar este robô ao padrão de fábrica? Nome, WiFi gravado e senha da rede voltam ao padrão (vale após reiniciar).',
            rebootSent:      'Comando de reinício enviado — o robô já está voltando.',
        },
    };
    function locale() {
        try {
            const l = Blockly && Blockly.ScratchMsgs && Blockly.ScratchMsgs.currentLocale_;
            if (l && STRINGS[l]) return l;
        } catch (e) {}
        return 'en';
    }
    function tr(k) { return STRINGS[locale()][k] || STRINGS.en[k]; }
    function fmt(t) {
        const args = Array.prototype.slice.call(arguments, 1);
        let i = 0;
        return t.replace(/%[ds]/g, () => (args[i++] !== undefined ? args[i - 1] : ''));
    }

    // --- bin2ota (inline) -----------------------------------------------------
    // Faithful copy of tools/bin2ota.js (which owns the reference tests,
    // including byte-equality against Arduino's official encoder output).
    // Keep the two in sync when touching either.
    const MAGIC_UNOR4WIFI = 0x23411002;
    const LZ_EI = 11, LZ_EJ = 4, LZ_P = 1;
    const LZ_N = 1 << LZ_EI, LZ_F = (1 << LZ_EJ) + 1;

    function lzssEncode(input) {
        const out = [];
        let bitBuffer = 0, bitMask = 128;
        const putbit1 = () => {
            bitBuffer |= bitMask;
            if ((bitMask >>= 1) === 0) { out.push(bitBuffer); bitBuffer = 0; bitMask = 128; }
        };
        const putbit0 = () => {
            if ((bitMask >>= 1) === 0) { out.push(bitBuffer); bitBuffer = 0; bitMask = 128; }
        };
        const output1 = (c) => {
            putbit1();
            let mask = 256;
            while ((mask >>= 1)) { if (c & mask) putbit1(); else putbit0(); }
        };
        const output2 = (x, y) => {
            putbit0();
            let mask = LZ_N;
            while ((mask >>= 1)) { if (x & mask) putbit1(); else putbit0(); }
            mask = 1 << LZ_EJ;
            while ((mask >>= 1)) { if (y & mask) putbit1(); else putbit0(); }
        };
        const buffer = new Uint8Array(LZ_N * 2);
        let pos = 0, i;
        for (i = 0; i < LZ_N - LZ_F; i++) buffer[i] = 0x20;
        for (i = LZ_N - LZ_F; i < LZ_N * 2 && pos < input.length; i++) buffer[i] = input[pos++];
        let bufferend = i, r = LZ_N - LZ_F, s = 0;
        while (r < bufferend) {
            const f1 = LZ_F <= bufferend - r ? LZ_F : bufferend - r;
            let x = 0, y = 1;
            const c = buffer[r];
            for (i = r - 1; i >= s; i--) {
                if (buffer[i] === c) {
                    let j;
                    for (j = 1; j < f1; j++) { if (buffer[i + j] !== buffer[r + j]) break; }
                    if (j > y) { x = i; y = j; }
                }
            }
            if (y <= LZ_P) output1(c);
            else output2(x & (LZ_N - 1), y - 2);
            r += y; s += y;
            if (r >= LZ_N * 2 - LZ_F) {
                buffer.copyWithin(0, LZ_N, LZ_N * 2);
                bufferend -= LZ_N; r -= LZ_N; s -= LZ_N;
                while (bufferend < LZ_N * 2 && pos < input.length) buffer[bufferend++] = input[pos++];
            }
        }
        if (bitMask !== 128) out.push(bitBuffer);
        return Buffer.from(out);
    }

    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(buf) {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    function bin2ota(binBuf) {
        const payload = lzssEncode(binBuf);
        const magicBuf = Buffer.alloc(4);
        magicBuf.writeUInt32LE(MAGIC_UNOR4WIFI, 0);
        const version = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0x40]);
        const complete = Buffer.concat([magicBuf, version, payload]);
        const header = Buffer.alloc(8);
        header.writeUInt32LE(complete.length, 0);
        header.writeUInt32LE(crc32(complete), 4);
        return Buffer.concat([header, complete]);
    }

    // --- Toolchain discovery --------------------------------------------------

    function arduinoDir() {
        const candidates = [];
        try {
            if (process.resourcesPath) {
                candidates.push(path.join(path.dirname(process.resourcesPath), 'arduino'));
            }
        } catch (e) {}
        try { candidates.push(path.join(process.cwd(), 'arduino')); } catch (e) {}
        candidates.push('C:\\matrixblock-r4\\arduino');
        for (const c of candidates) {
            try {
                if (fs.existsSync(path.join(c, 'arduino-cli.exe')) ||
                    fs.existsSync(path.join(c, 'arduino-cli'))) return c;
            } catch (e) {}
        }
        return null;
    }

    // --- Sketch generation ----------------------------------------------------

    function workspace() {
        return Blockly.getMainWorkspace ? Blockly.getMainWorkspace()
                                        : Blockly.mainWorkspace;
    }

    function generateSketch() {
        const ws = workspace();
        if (!ws) throw new Error('no workspace');
        if (ws.getAllBlocks && ws.getAllBlocks(false).length === 0) {
            const e = new Error(tr('emptyWorkspace'));
            e.empty = true;
            throw e;
        }
        if (Blockly.Arduino && typeof Blockly.Arduino.workspaceToCode === 'function') {
            return Blockly.Arduino.workspaceToCode(ws);
        }
        throw new Error('Blockly.Arduino.workspaceToCode unavailable');
    }

    // --- Compilation ----------------------------------------------------------

    function compileSketch(code, onOutput) {
        return new Promise((resolve, reject) => {
            const dir = arduinoDir();
            if (!dir) {
                reject(new Error(fmt(tr('cliMissing'), 'resources/../arduino')));
                return;
            }
            const cli = fs.existsSync(path.join(dir, 'arduino-cli.exe'))
                ? path.join(dir, 'arduino-cli.exe')
                : path.join(dir, 'arduino-cli');

            const buildRoot = path.join(os.tmpdir(), 'mbr4_wifi_build');
            const sketchDir = path.join(buildRoot, 'mbr4_wifi');
            const outDir    = path.join(buildRoot, 'out');
            fs.mkdirSync(sketchDir, { recursive: true });
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(sketchDir, 'mbr4_wifi.ino'), code, 'utf8');

            // cwd MUST be the arduino dir: arduino-cli.yaml uses relative
            // data/user directories (same contract as the USB flow).
            const args = ['--config-file', 'arduino-cli.yaml', 'compile',
                          '--fqbn', FQBN, '--output-dir', outDir, sketchDir];
            const child = spawn(cli, args, { cwd: dir, windowsHide: true });
            let output = '';
            const grab = (d) => {
                const s = d.toString();
                output += s;
                if (onOutput) onOutput(s);
            };
            child.stdout.on('data', grab);
            child.stderr.on('data', grab);
            child.on('error', reject);
            child.on('close', (codeNum) => {
                if (codeNum !== 0) {
                    const err = new Error(tr('compileFail'));
                    err.output = output;
                    reject(err);
                    return;
                }
                const bin = path.join(outDir, 'mbr4_wifi.ino.bin');
                if (!fs.existsSync(bin)) {
                    const err = new Error('compile ok but .bin missing');
                    err.output = output;
                    reject(err);
                    return;
                }
                // Surface the flash/RAM usage line in the UI (size feedback
                // the fork's footer bar gives for USB builds).
                const m = output.match(/Sketch uses [^\n]*/);
                resolve({ binPath: bin, sizeLine: m ? m[0] : '', output });
            });
        });
    }

    // --- Discovery (UDP broadcast) --------------------------------------------

    function broadcastTargets() {
        const targets = new Set(['255.255.255.255', '192.168.4.255']);
        try {
            const ifs = os.networkInterfaces();
            for (const name of Object.keys(ifs)) {
                for (const info of ifs[name]) {
                    if (info.family !== 'IPv4' || info.internal) continue;
                    const ip = info.address.split('.').map(Number);
                    const mask = info.netmask.split('.').map(Number);
                    const bcast = ip.map((oct, i) => (oct & mask[i]) | (~mask[i] & 0xff));
                    targets.add(bcast.join('.'));
                }
            }
        } catch (e) {}
        return Array.from(targets);
    }

    function discover(timeoutMs) {
        return new Promise((resolve) => {
            const robots = new Map();   // mac -> announce
            let sock;
            try {
                sock = dgram.createSocket('udp4');
            } catch (e) {
                resolve([]);
                return;
            }
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
                const buf = Buffer.from(DISCOVER_MSG);
                const targets = broadcastTargets();
                // Fire twice (0 ms / 400 ms) — UDP broadcast is lossy.
                for (const delay of [0, 400]) {
                    setTimeout(() => {
                        for (const t of targets) {
                            try { sock.send(buf, UDP_DISCOVERY_PORT, t); } catch (e) {}
                        }
                    }, delay);
                }
                setTimeout(finish, timeoutMs || 1500);
            });
        });
    }

    // --- TCP NDJSON client ----------------------------------------------------

    class RobotClient {
        constructor(ip) {
            this.ip = ip;
            this.sock = null;
            this.buffer = '';
            this.onFrame = null;      // every parsed frame
            this.onClose = null;
            this._waiters = [];       // { match, resolve, timer }
        }
        connect(timeoutMs) {
            return new Promise((resolve, reject) => {
                const sock = net.createConnection({ host: this.ip, port: TCP_COMMAND_PORT });
                const timer = setTimeout(() => {
                    sock.destroy();
                    reject(new Error('timeout'));
                }, timeoutMs || 4000);
                sock.once('connect', () => {
                    clearTimeout(timer);
                    this.sock = sock;
                    sock.setNoDelay(true);
                    sock.on('data', (d) => this._onData(d));
                    sock.on('close', () => { if (this.onClose) this.onClose(); });
                    sock.on('error', () => {});
                    resolve(this);
                });
                sock.once('error', (e) => {
                    clearTimeout(timer);
                    reject(e);
                });
            });
        }
        get localAddress() {
            return this.sock ? this.sock.localAddress : null;
        }
        _onData(d) {
            this.buffer += d.toString('utf8');
            let idx;
            while ((idx = this.buffer.indexOf('\n')) >= 0) {
                const line = this.buffer.slice(0, idx).trim();
                this.buffer = this.buffer.slice(idx + 1);
                if (!line) continue;
                let obj;
                try { obj = JSON.parse(line); } catch (e) { continue; }
                if (this.onFrame) { try { this.onFrame(obj); } catch (e) {} }
                for (let i = 0; i < this._waiters.length; i++) {
                    if (this._waiters[i].match(obj)) {
                        const w = this._waiters.splice(i, 1)[0];
                        clearTimeout(w.timer);
                        w.resolve(obj);
                        break;
                    }
                }
            }
        }
        send(obj) {
            if (!this.sock) throw new Error('not connected');
            this.sock.write(JSON.stringify(obj) + '\n');
        }
        request(obj, match, timeoutMs) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    const i = this._waiters.findIndex((w) => w.timer === timer);
                    if (i >= 0) this._waiters.splice(i, 1);
                    reject(new Error('timeout'));
                }, timeoutMs || 5000);
                this._waiters.push({ match, resolve, timer });
                this.send(obj);
            });
        }
        close() {
            if (this.sock) { try { this.sock.destroy(); } catch (e) {} }
            this.sock = null;
        }
    }

    // --- Ephemeral HTTP server ------------------------------------------------

    function serveFile(buf, allowedIp) {
        return new Promise((resolve, reject) => {
            const token = Math.random().toString(36).slice(2, 10);
            const urlPath = '/' + token + '.ota';
            const server = http.createServer((req, res) => {
                const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
                if (req.url !== urlPath || (allowedIp && remote !== allowedIp)) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': buf.length,
                });
                res.end(buf);
            });
            server.on('error', () => {
                // Preferred port taken (another IDE instance?) — let the OS pick.
                server.listen(0, '0.0.0.0');
            });
            server.listen(HTTP_PREFERRED_PORT, '0.0.0.0');
            server.once('listening', () => {
                resolve({
                    port: server.address().port,
                    urlPath,
                    stop: () => { try { server.close(); } catch (e) {} },
                });
            });
            setTimeout(() => reject(new Error('http listen timeout')), 4000);
        });
    }

    // --- Upload orchestration -------------------------------------------------

    let busy = false;

    async function uploadTo(robot, ui) {
        const t0 = Date.now();

        ui.phase(tr('phase_generate'));
        const code = generateSketch();

        ui.phase(tr('phase_compile'));
        const { binPath, sizeLine } = await compileSketch(code, ui.consoleOut);
        if (sizeLine) ui.log(fmt(tr('compiledOK'), sizeLine), 'ok');

        ui.phase(tr('phase_convert'));
        const bin = fs.readFileSync(binPath);
        const ota = bin2ota(bin);
        ui.log(fmt(tr('otaSize'), ota.length, Math.round((ota.length / bin.length) * 100)), 'ok');

        ui.phase(fmt(tr('phase_send'), robot.name || robot.ip));
        const client = new RobotClient(robot.ip);
        try {
            await client.connect(4000);
        } catch (e) {
            throw new Error(fmt(tr('connectFail'), robot.ip, TCP_COMMAND_PORT, e.message));
        }

        let httpHandle = null;
        try {
            await client.request({ t: 'ping' }, (o) => o.t === 'pong', 4000);

            ui.phase(tr('phase_serve'));
            httpHandle = await serveFile(ota, robot.ip);
            const myIp = client.localAddress;
            const url = 'http://' + myIp + ':' + httpHandle.port + httpHandle.urlPath;

            // Stream OTA status into the modal. The apply phase ends with the
            // hub rebooting, which closes the socket — that's success, not an
            // error, so track the last phase seen.
            let lastPhase = '';
            let otaFailed = null;
            const statusDone = new Promise((resolveStatus) => {
                client.onFrame = (o) => {
                    if (o.t !== 'ota_status') return;
                    lastPhase = o.phase;
                    if (o.phase === 'download') {
                        ui.phase(fmt(tr('phase_download'), o.pct || 0), o.pct || 0);
                    } else if (o.phase === 'verify') {
                        ui.phase(tr('phase_verify'), 100);
                    } else if (o.phase === 'apply') {
                        ui.phase(tr('phase_apply'));
                        resolveStatus();
                    } else if (o.phase === 'error') {
                        otaFailed = o;
                        resolveStatus();
                    }
                };
                client.onClose = () => resolveStatus();
            });

            client.send({
                t: 'ota',
                url,
                size: ota.length,
                crc: crc32(ota).toString(16),
            });
            await statusDone;

            if (otaFailed) {
                throw new Error(fmt(tr('otaError'), otaFailed.phase !== 'error'
                    ? otaFailed.phase : (otaFailed.detail || '?'), otaFailed.code || 0));
            }
            if (lastPhase !== 'apply') {
                throw new Error('connection lost during ' + (lastPhase || 'setup'));
            }
        } finally {
            client.close();
        }

        // Reboot + re-announce. The modem keeps the .ota; flashing takes a
        // few seconds, then the wrapper brings the network back up.
        ui.phase(tr('phase_reboot'));
        const deadline = Date.now() + 60000;
        let back = null;
        while (Date.now() < deadline && !back) {
            const robots = await discover(2000);
            back = robots.find((r) => robot.mac ? r.mac === robot.mac : r.ip === robot.ip) || null;
        }
        if (httpHandle) httpHandle.stop();
        if (!back) throw new Error(tr('rebootTimeout'));

        ui.log(fmt(tr('done'), back.name || back.ip, Math.round((Date.now() - t0) / 1000)), 'ok');
        return back;
    }

    async function sendViaWiFi(robot, ui) {
        if (busy) return;
        busy = true;
        try {
            try {
                await uploadTo(robot, ui);
            } catch (e) {
                if (e && e.empty) { ui.log(e.message, 'error'); return; }
                if (e && e.output) ui.consoleOut(e.output);
                ui.log(fmt(tr('retrying'), e.message), 'error');
                await uploadTo(robot, ui);   // single automatic retry
            }
        } catch (e) {
            if (e && e.output) ui.consoleOut(e.output);
            ui.log((e && e.message) || String(e), 'error');
        } finally {
            busy = false;
        }
    }

    // --- Modal UI -------------------------------------------------------------

    let modalEl = null;

    function ensureModal() {
        if (modalEl && document.body.contains(modalEl)) return modalEl;
        modalEl = document.createElement('div');
        modalEl.id = 'wifiControlModal';
        modalEl.style.cssText =
            'position:fixed;inset:0;display:none;align-items:center;' +
            'justify-content:center;background:rgba(0,0,0,.45);' +
            'z-index:100000;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;';
        modalEl.innerHTML =
            '<div style="background:#fff;color:#111;border-radius:8px;' +
            'width:520px;max-width:94vw;max-height:88vh;overflow:auto;' +
            'padding:18px 20px;box-shadow:0 8px 32px rgba(0,0,0,.35);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
                '<h5 id="wifiModalTitle" style="margin:0;font:600 16px/1.2 inherit;"></h5>' +
                '<button id="wifiModalClose" type="button" style="background:none;border:0;font-size:20px;cursor:pointer;color:#555;">&times;</button>' +
              '</div>' +
              '<div id="wifiRobotList"></div>' +
              '<div id="wifiSettingsPane" style="display:none;"></div>' +
              '<div id="wifiProgressWrap" style="display:none;margin:12px 0;">' +
                '<div id="wifiPhaseText" style="font-weight:600;margin-bottom:6px;"></div>' +
                '<div style="background:#e5e7eb;border-radius:6px;height:10px;overflow:hidden;">' +
                  '<div id="wifiProgressBar" style="background:#008184;height:100%;width:0%;transition:width .2s;"></div>' +
                '</div>' +
              '</div>' +
              '<div id="wifiModalLog" style="margin:12px 0;padding:8px 10px;background:#f4f4f5;' +
                'border-radius:4px;font-family:monospace;font-size:12px;color:#333;' +
                'max-height:180px;overflow:auto;white-space:pre-wrap;"></div>' +
              '<details id="wifiCliOutWrap" style="display:none;margin:8px 0;">' +
                '<summary style="cursor:pointer;font-size:12px;color:#666;">arduino-cli</summary>' +
                '<pre id="wifiCliOut" style="max-height:160px;overflow:auto;background:#111;color:#ddd;' +
                  'padding:8px;border-radius:4px;font-size:11px;"></pre>' +
              '</details>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
                '<button id="wifiModalRefresh" type="button" style="padding:6px 14px;border:0;background:#008184;color:#fff;border-radius:4px;cursor:pointer;"></button>' +
                '<button id="wifiModalCancel" type="button" style="padding:6px 14px;border:1px solid #64748b;background:#fff;color:#64748b;border-radius:4px;cursor:pointer;"></button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(modalEl);
        modalEl.addEventListener('click', (ev) => {
            if (ev.target === modalEl && !busy) closeModal();
        });
        document.getElementById('wifiModalClose').addEventListener('click', () => {
            if (!busy) closeModal();
        });
        document.getElementById('wifiModalRefresh').addEventListener('click', () => refreshList());
        document.getElementById('wifiModalCancel').addEventListener('click', () => {
            if (!busy) closeModal();
        });
        return modalEl;
    }

    function closeModal() {
        if (modalEl) modalEl.style.display = 'none';
    }

    function modalUi() {
        const logEl  = document.getElementById('wifiModalLog');
        const cliEl  = document.getElementById('wifiCliOut');
        const cliWrap = document.getElementById('wifiCliOutWrap');
        const wrap   = document.getElementById('wifiProgressWrap');
        const phase  = document.getElementById('wifiPhaseText');
        const bar    = document.getElementById('wifiProgressBar');
        return {
            log: (msg, cls) => {
                const line = document.createElement('div');
                if (cls === 'error') line.style.color = '#dc2626';
                if (cls === 'ok')    line.style.color = '#059669';
                line.textContent = msg;
                logEl.appendChild(line);
                logEl.scrollTop = logEl.scrollHeight;
                console.log('[WiFi] ' + msg);
            },
            phase: (msg, pct) => {
                wrap.style.display = 'block';
                phase.textContent = msg;
                if (typeof pct === 'number') bar.style.width = pct + '%';
            },
            consoleOut: (s) => {
                cliWrap.style.display = 'block';
                cliEl.textContent += s;
                cliEl.scrollTop = cliEl.scrollHeight;
            },
        };
    }

    function robotRow(robot) {
        const row = document.createElement('div');
        row.style.cssText =
            'display:flex;align-items:center;gap:10px;padding:10px 12px;' +
            'border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px;';
        const modeKey = robot.mode === 'ap' ? 'robotMode_ap' : 'robotMode_sta';
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        info.innerHTML =
            '<div style="font-weight:600;">' + escapeHtml(robot.name || robot.ip) + '</div>' +
            '<div style="font-size:12px;color:#666;">' +
                escapeHtml(robot.ip) + ' · ' + tr(modeKey) +
                ' · ' + tr('battery') + ' ' + escapeHtml(String(robot.batt != null ? robot.batt : '?')) + ' V' +
                ' · fw ' + escapeHtml(robot.fw || '?') +
            '</div>';
        const cfg = document.createElement('button');
        cfg.type = 'button';
        cfg.textContent = tr('settings');
        cfg.style.cssText =
            'padding:6px 10px;border:1px solid #64748b;background:#fff;color:#64748b;' +
            'border-radius:4px;cursor:pointer;';
        cfg.addEventListener('click', () => openSettings(robot));
        const send = document.createElement('button');
        send.type = 'button';
        send.textContent = tr('send');
        send.style.cssText =
            'padding:6px 14px;border:0;background:#008184;color:#fff;' +
            'border-radius:4px;cursor:pointer;font-weight:600;';
        send.addEventListener('click', () => {
            document.getElementById('wifiRobotList').style.display = 'none';
            sendViaWiFi(robot, modalUi()).finally(() => {
                const list = document.getElementById('wifiRobotList');
                if (list) list.style.display = 'block';
            });
        });
        row.appendChild(info);
        row.appendChild(cfg);
        row.appendChild(send);
        return row;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    async function refreshList() {
        ensureModal();
        const list = document.getElementById('wifiRobotList');
        const ui = modalUi();
        list.innerHTML = '';
        list.style.display = 'block';
        document.getElementById('wifiSettingsPane').style.display = 'none';
        ui.log(tr('searching'));
        const robots = await discover(1800);
        list.innerHTML = '';
        if (!robots.length) {
            ui.log(tr('noneFound'), 'error');
            return;
        }
        ui.log(fmt(tr('found'), robots.length), 'ok');
        robots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        for (const r of robots) list.appendChild(robotRow(r));
    }

    function openSettings(robot) {
        const pane = document.getElementById('wifiSettingsPane');
        const list = document.getElementById('wifiRobotList');
        list.style.display = 'none';
        pane.style.display = 'block';
        pane.innerHTML =
            '<div style="font-weight:600;margin-bottom:10px;">' +
                escapeHtml(fmt(tr('settingsTitle'), robot.name || robot.ip)) + '</div>' +
            '<label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">' + tr('nameLabel') + '</label>' +
            '<div style="display:flex;gap:6px;margin-bottom:2px;">' +
              '<input id="wifiCfgName" type="text" maxlength="24" value="' + escapeHtml(robot.name || '') + '"' +
                ' style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font:inherit;" />' +
              '<button id="wifiCfgNameSave" type="button" style="padding:6px 12px;border:0;background:#059669;color:#fff;border-radius:4px;cursor:pointer;">' + tr('saveName') + '</button>' +
            '</div>' +
            '<div style="font-size:11px;color:#666;margin-bottom:12px;">' + tr('nameHint') + '</div>' +
            '<label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">' + tr('wifiLabel') + '</label>' +
            '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">' +
              '<input id="wifiCfgSsid" type="text" maxlength="32" placeholder="' + tr('ssidPh') + '"' +
                ' style="padding:6px 8px;border:1px solid #ccc;border-radius:4px;font:inherit;" />' +
              '<div style="display:flex;gap:6px;">' +
                '<input id="wifiCfgPass" type="text" maxlength="63" placeholder="' + tr('passPh') + '"' +
                  ' style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font:inherit;" />' +
                '<button id="wifiCfgWifiSave" type="button" style="padding:6px 12px;border:0;background:#059669;color:#fff;border-radius:4px;cursor:pointer;">' + tr('saveWifi') + '</button>' +
              '</div>' +
              '<div style="font-size:11px;color:#666;">' + tr('wifiHint') + '</div>' +
            '</div>' +
            '<label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">' + tr('apPassLabel') + '</label>' +
            '<div style="display:flex;gap:6px;margin-bottom:2px;">' +
              '<input id="wifiCfgApPass" type="text" maxlength="63" placeholder="' + tr('apPassPh') + '"' +
                ' style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font:inherit;" />' +
              '<button id="wifiCfgApPassSave" type="button" style="padding:6px 12px;border:0;background:#059669;color:#fff;border-radius:4px;cursor:pointer;">' + tr('saveApPass') + '</button>' +
            '</div>' +
            '<div style="font-size:11px;color:#666;margin-bottom:12px;">' + tr('apPassHint') + '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button id="wifiCfgBack" type="button" style="padding:6px 14px;border:1px solid #64748b;background:#fff;color:#64748b;border-radius:4px;cursor:pointer;">' + tr('back') + '</button>' +
              '<button id="wifiCfgReboot" type="button" style="padding:6px 14px;border:1px solid #d97706;background:#fff;color:#d97706;border-radius:4px;cursor:pointer;">' + tr('rebootBtn') + '</button>' +
              '<button id="wifiCfgFactory" type="button" style="padding:6px 14px;border:1px solid #dc2626;background:#fff;color:#dc2626;border-radius:4px;cursor:pointer;">' + tr('factoryBtn') + '</button>' +
            '</div>';

        const ui = modalUi();
        const doCommand = async (cmd, matchCmd) => {
            const client = new RobotClient(robot.ip);
            try {
                await client.connect(4000);
                const rsp = await client.request(cmd,
                    (o) => o.t === 'ack' && o.cmd === matchCmd, 5000);
                ui.log(rsp.ok ? tr('saved') : tr('saveFail'), rsp.ok ? 'ok' : 'error');
                return !!rsp.ok;
            } catch (e) {
                ui.log(fmt(tr('connectFail'), robot.ip, TCP_COMMAND_PORT, e.message), 'error');
                return false;
            } finally {
                client.close();
            }
        };
        document.getElementById('wifiCfgNameSave').addEventListener('click', async () => {
            const name = document.getElementById('wifiCfgName').value.trim();
            if (await doCommand({ t: 'setname', name }, 'setname')) robot.name = name;
        });
        document.getElementById('wifiCfgWifiSave').addEventListener('click', () => {
            const ssid = document.getElementById('wifiCfgSsid').value.trim();
            const pass = document.getElementById('wifiCfgPass').value;
            doCommand({ t: 'setwifi', ssid, pass }, 'setwifi');
        });
        document.getElementById('wifiCfgApPassSave').addEventListener('click', () => {
            const pass = document.getElementById('wifiCfgApPass').value;
            doCommand({ t: 'setappass', pass }, 'setappass');
        });
        document.getElementById('wifiCfgReboot').addEventListener('click', async () => {
            if (await doCommand({ t: 'reboot' }, 'reboot')) ui.log(tr('rebootSent'), 'ok');
        });
        document.getElementById('wifiCfgFactory').addEventListener('click', () => {
            if (window.confirm(tr('factoryConfirm'))) {
                doCommand({ t: 'factory' }, 'factory');
            }
        });
        document.getElementById('wifiCfgBack').addEventListener('click', () => {
            pane.style.display = 'none';
            list.style.display = 'block';
        });
    }

    function openModal() {
        ensureModal();
        refreshAllLabels();
        document.getElementById('wifiModalLog').textContent = '';
        document.getElementById('wifiCliOut').textContent = '';
        document.getElementById('wifiCliOutWrap').style.display = 'none';
        document.getElementById('wifiProgressWrap').style.display = 'none';
        modalEl.style.display = 'flex';
        refreshList();
    }

    function refreshAllLabels() {
        const set = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.textContent = tr(key);
        };
        set('wifiModalTitle', 'modalTitle');
        set('wifiModalRefresh', 'refresh');
        set('wifiModalCancel', 'close');
        const span = document.getElementById('wifiUploadButton');
        if (span) span.innerHTML = '&nbsp;' + tr('btnLabel');
        const link = document.getElementById('wifiUploadNavLink');
        if (link) link.title = tr('btnTitle');
    }

    // --- Nav button -----------------------------------------------------------

    function installButtons() {
        const uploadLink = document.getElementById('uploadNavLink');
        if (!uploadLink) return;
        const parent = uploadLink.parentNode;

        if (!document.getElementById('wifiUploadNavLink')) {
            const s = document.createElement('a');
            s.className = 'nav-link d-flex align-items-center active';
            s.id = 'wifiUploadNavLink';
            s.title = tr('btnTitle');
            s.style.cursor = 'pointer';
            s.innerHTML =
                '<i class="bi bi-wifi"></i>' +
                '<span id="wifiUploadButton">&nbsp;' + tr('btnLabel') + '</span>';
            s.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                openModal();
            });
            parent.insertBefore(s, uploadLink.nextSibling);
        }

        // Track locale flips (the IDE switches language without a reload).
        if (!window.__wifiLocaleWatcherStarted) {
            window.__wifiLocaleWatcherStarted = true;
            let last = locale();
            setInterval(() => {
                if (locale() !== last) {
                    last = locale();
                    refreshAllLabels();
                }
            }, 1000);
        }
    }

    // Exposed for e2e tests and future phases (telemetry HUD port).
    window.MBR4WiFi = {
        discover,
        RobotClient,
        bin2ota,
        lzssEncode,
        crc32,
        openModal,
        _uploadTo: uploadTo,
    };

    console.log('[WiFi] wifi_upload.js module loaded');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installButtons);
    } else {
        installButtons();
    }
    setTimeout(installButtons, 1500);
    setTimeout(installButtons, 3000);
    setTimeout(installButtons, 5000);
})();
