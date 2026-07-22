# Manual de Implementação — Upload WiFi (TCP + OTA real) e Telemetria

> **Para quem é este documento:** um agente de IA (Claude Opus ou similar) ou desenvolvedor humano
> que vá implementar esta feature **sem acesso à conversa que a originou**. Ele é autossuficiente:
> contém contexto do projeto, decisão de arquitetura, especificação de protocolos, fases de
> implementação, riscos conhecidos e critérios de aceitação.
>
> **Branch de trabalho:** `feature/wifi-tcp-ota` (esta branch). **Não** modificar
> `feature/always-on-ble-runtime` — ela permanece como fallback.

---

## 1. Contexto do projeto

Este repositório é um fork comunitário (Equipe AstroGenius, Brasil) do **MATRIXblock Mini R4
v1.0.8**, software oficial da MATRIX Robotics para o hub **MATRIX Mini R4**. Público-alvo:
robótica educacional de competição (WRO etc.).

### 1.1 Hardware do hub (fatos relevantes)

- Núcleo: **Arduino UNO R4 WiFi** — MCU principal Renesas **RA4M1** (256 KB flash, 32 KB RAM)
  + **ESP32-S3** como modem WiFi/BLE, ligado ao RA4M1 por SPI ("usb-bridge firmware").
- Coprocessador **STM32F103** para motores/encoders (comunicação interna, irrelevante aqui).
- A lib `arduino/libraries/MatrixMiniR4/` expõe tudo: motores M1–M4 c/ encoder e PID, servos
  RC1–RC4, IMU, OLED (SSD1306 @0x3D), buzzer, RGB, 2 botões, 4 portas I2C, sensores MATRIX.
- **WiFi via `WiFiS3.h`** (já incluída no `MatrixMiniR4.h`). Suporta modo station e
  **modo AP** (`WiFi.beginAP`) e **UDP multicast/broadcast** (`WiFiUDP`).
- **Restrição importante:** WiFi (WiFiS3) e BLE (ArduinoBLE) compartilham o modem ESP32-S3 e
  **não funcionam bem simultaneamente**. Esta feature usa somente WiFi; o runtime BLE não deve
  estar ativo no mesmo sketch.
- **Dataflash de 8 KB** (do RA4M1) com layout já definido pela branch BLE:
  - Bloco 0: calibração IMU (reservado)
  - Blocos 1–4: bytecode VM (usado só pela branch BLE)
  - Bloco 5: flag BLE-enable (usado só pela branch BLE)
  - **Blocos 6–7: livres — usar para credenciais WiFi + flags desta feature.**

### 1.2 Software (arquitetura do app)

- App **Electron** (fork do oficial). O código-fonte patchado vive em `resources/app_src/`
  (`app.compressed.js` ≈ 100 KB é o main+renderer bundlado; `blockly-core/` tem blocos e
  geradores; `views/main.html` é a UI).
- O build injeta os arquivos de `app_src/` dentro de `resources/app.asar` via
  **`node patch_asar.js`** (abordagem de patch cirúrgico — não é um app Electron "normal" com
  package.json próprio; respeite esse fluxo).
- Smoke test: **`node test_app.js`** (Playwright).
- Pipeline de programação: Blockly → gerador C++ (`blockly-core/generator/`) → sketch `.ino` →
  **`arduino/arduino-cli.exe`** (empacotado, com core `arduino:renesas_uno`) compila → upload
  USB serial.
- A branch `feature/always-on-ble-runtime` adicionou uma **VM de bytecode** (77 opcodes,
  `MiniR4VM.cpp`, `MiniR4BLERuntime.cpp`, gerador em `ide_patch/blockly-core/bytecode.js` e
  `generator_bytecode/`) com upload por Web Bluetooth a ~40 B/s. Limitações documentadas em
  `arduino/libraries/MatrixMiniR4/examples/6-VM Runtime/SESSION_2026-07-18_ALWAYS_ON_BLE.md`:
  teto empírico de **6 KB de bytecode** (~600–1000 blocos), handlers incompletos (strings,
  ultrassônico, DriveDC), starvation do stack BLE quando o código do usuário bloqueia,
  ausência de device picker, throughput baixíssimo.

### 1.3 Decisão de arquitetura (já tomada — não rediscutir)

**Substituir o transporte BLE por WiFi TCP e substituir a VM por upload de firmware real (OTA).**

| Critério | VM + BLE (atual) | OTA + WiFi TCP (esta feature) |
|---|---|---|
| Velocidade de upload | ~40 B/s (100 s p/ 4 KB) | dezenas–centenas de KB/s |
| Limite de programa | 6 KB bytecode (~600–1000 blocos) | flash de 256 KB do RA4M1 (~milhares de blocos; na prática ilimitado) |
| Cobertura de blocos | ~36 handlers, faltam strings/US/DriveDC | **100%** — roda o C++ real gerado |
| Robustez de conexão | starvation → queda de conexão | TCP tolera bloqueios (buffer) |
| Lado do app | Web Bluetooth (flaky no Electron) | sockets nativos Node (`net`, `dgram`, `http`) |
| Multi-robô | nomes duplicados, sem picker | IP único + discovery UDP + picker |
| Custo | iteração instantânea (14 B/bloco) | recompilação arduino-cli (~15–30 s por envio) |

O único ponto em que a VM ganha (iteração instantânea) não compensa as limitações. A VM
permanece disponível na branch dela como modo alternativo futuro; **não portar a VM para cá**.

**Mecanismo de OTA escolhido:** biblioteca oficial **`OTAUpdate`** do core
`arduino:renesas_uno` (ArduinoCore-renesas, `libraries/OTAUpdate`). API:

```cpp
#include <OTAUpdate.h>
OTAUpdate ota;
ota.begin("/update.bin");              // path no filesystem do ESP32-S3
ota.download(url, "/update.bin");      // o MODEM (ESP32-S3) baixa via HTTP(S)
ota.verify();                          // valida header + CRC do .ota
ota.update("/update.bin");             // reflasha o RA4M1 e reinicia
```

Pontos-chave: o arquivo `.ota` fica no flash do **ESP32-S3** (não consome flash do RA4M1 —
sem limite de "metade da flash" da alternativa JAndrassy/ArduinoOTA); o formato `.ota` é o da
Arduino Cloud (header + payload **LZSS**); o app Electron servirá o arquivo via **HTTP na LAN**.

---

## 2. Arquitetura alvo

```
┌────────────────────── App Electron ──────────────────────┐
│ Blockly → C++ (gerador existente, SEM bytecode)          │
│ arduino-cli compile → sketch.bin                         │
│ bin2ota (novo, Node) → sketch.ota                        │
│ HTTP server efêmero (porta 47800) servindo sketch.ota    │
│ UDP discovery client (broadcast porta 47801)             │
│ TCP command client (porta 47802 do robô)                 │
│ UI: botão "Enviar via WiFi", picker de robôs, progresso  │
└──────────────────────────────────────────────────────────┘
                    │ WiFi (AP do robô OU rede local)
┌────────────────────── Firmware (wrapper) ────────────────┐
│ MiniR4WiFiRuntime (novo módulo da lib MatrixMiniR4):     │
│  - conecta WiFi (credenciais na dataflash) ou cria AP    │
│  - responde discovery UDP (nome, IP, versão, bateria)    │
│  - servidor TCP 47802: comandos NDJSON                   │
│  - telemetria: push NDJSON no mesmo socket               │
│  - comando OTA → OTAUpdate.download/verify/update        │
│  - poll não-bloqueante chamado do loop() (wrapper)       │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Protocolo de discovery (UDP, porta 47801)

- App envia broadcast (`255.255.255.255:47801` e, em modo AP, `192.168.4.255`):
  `{"t":"MBR4_DISCOVER","v":1}`
- Cada robô responde unicast para o remetente:
  `{"t":"MBR4_HERE","v":1,"name":"<nome>","mac":"<suffix4>","ip":"x.x.x.x","fw":"<versão wrapper>","batt":<volts>,"mode":"ap"|"sta"}`
- `name` default: `MBR4-<4 últimos hex do MAC>` — resolve o problema de nomes duplicados
  documentado na branch BLE. Nome customizável persistido na dataflash.

### 2.2 Protocolo de comando (TCP, porta 47802, NDJSON — 1 JSON por linha)

Requests do app → robô:

| Comando | Payload | Resposta |
|---|---|---|
| `{"t":"ping"}` | — | `{"t":"pong","fw":"...","uptime":ms}` |
| `{"t":"info"}` | — | nome, versões, bateria, portas I2C detectadas |
| `{"t":"telemetry","on":true,"hz":10}` | liga/desliga stream | frames `{"t":"tm",...}` contínuos |
| `{"t":"ota","url":"http://<ip-app>:47800/sketch.ota","size":N,"crc":"..."}` | inicia OTA | `{"t":"ota_status","phase":"download"|"verify"|"apply","pct":N}` e por fim reboot |
| `{"t":"setname","name":"..."}` | grava na dataflash | ack |
| `{"t":"setwifi","ssid":"...","pass":"..."}` | grava credenciais (dataflash blocos 6–7) | ack |

Frames de telemetria (robô → app, mesmo socket): reutilizar **exatamente o formato/campos que a
telemetria BLE do fork já envia** (ver implementação em
`arduino/libraries/MatrixMiniR4/src/Modules/MiniR4BLERuntime.cpp` e o consumidor no
`app_src/app.compressed.js`) para que o dashboard existente funcione sem mudanças, apenas com a
fonte trocada.

### 2.3 Fluxo de upload completo

1. Usuário clica **"Enviar via WiFi"**.
2. App compila com arduino-cli (fluxo existente do upload USB — reusar; flag
   `--export-binaries` já produz `.bin`).
3. App converte `.bin` → `.ota` (módulo `bin2ota.js`, ver Fase 1).
4. App sobe HTTP server efêmero na porta 47800 servindo o `.ota`.
5. App envia `{"t":"ota","url":...}` via TCP ao robô selecionado.
6. Robô responde progresso; o modem baixa o arquivo; `verify()`; `update()` → reboot.
7. Novo sketch (que embute o wrapper de novo) volta a anunciar-se via UDP; app reconecta e
   confirma nova versão (`fw` muda) → sucesso na UI.
8. App derruba o HTTP server.

### 2.4 Wrapper de sketch (gerador)

Igual em espírito ao `arduino_ble_wrapper.js` da branch BLE (referência de como envolver
`userSetup`/`userLoop`), mas **sem VM**: o código do usuário roda nativo.

```cpp
#include <MatrixMiniR4.h>
#include "MiniR4WiFiRuntime.h"

void userSetup() { /* setup() gerado dos blocos */ }
void userLoop()  { /* loop() gerado dos blocos */ }

void setup() {
    MiniR4.begin();
    WiFiRuntime.begin();   // WiFi + discovery + TCP server; não bloqueia se não conectar
    userSetup();
}
void loop() {
    WiFiRuntime.poll();    // não-bloqueante
    userLoop();
}
```

Mitigações do problema de starvation (documentado na branch BLE — vale para qualquer transporte):

- Gerador substitui `delay(x)` dos blocos por `WiFiRuntime.safeDelay(x)` (fatia em passos de
  ~20 ms chamando `poll()` entre eles). O generator C++ existente centraliza a emissão de
  `delay` — modificar lá.
- **Modo de recuperação (obrigatório):** segurar **BTN_UP no boot** ⇒ `begin()` entra em loop
  só de rede (não chama `userLoop`), OLED mostra "OTA MODE" + IP. Garante que um sketch de
  usuário travado nunca tire o robô do ar — o pior caso vira: reiniciar segurando o botão.
- Fallback final continua sendo o upload USB normal (inalterado).

---

## 3. Fases de implementação

Implementar **nesta ordem**; cada fase tem entregável testável. Commits em inglês, estilo do
repo (`feat(...)`, `fix(...)`, `docs(...)` — ver `git log`). Após alterar `app_src`, rodar
`node patch_asar.js` e `node test_app.js`.

### Fase 0 — Prova de conceito manual (sem tocar no app) ⚠️ FAZER PRIMEIRO

Valida as 3 incógnitas desta feature antes de escrever código de produto:

1. Atualizar o firmware do usb-bridge (ESP32-S3) do hub para a versão mais recente
   (Arduino IDE → Firmware Updater, ou `arduino-fwuploader`). OTA depende de firmware de modem
   recente.
2. Sketch de teste baseado no exemplo oficial
   `ArduinoCore-renesas/libraries/OTAUpdate/examples/OTA/OTA.ino`, adaptado para baixar de um
   **servidor HTTP local** (ex.: `python -m http.server` servindo um `.ota`).
3. Gerar o `.ota` de um blink com a ferramenta de referência da Arduino (script
   `bin2ota.py` + `lzss.py` no repo `arduino/ArduinoIoTCloud`, pasta `extras/tools/`, ou
   `arduino-cloud-cli ota encode`). Anotar bytes do header gerado (servirá de fixture p/ Fase 1).
4. **Responder e registrar em `docs/POC_OTA_FINDINGS.md`:**
   - `ota.download()` aceita `http://` puro (sem TLS)? (Se **não**: plano B = servir via HTTPS
     com certificado fixo do app embutido via `setCACert`, gerado uma vez e commitado; o robô
     só confia nele.)
   - Tamanho do sketch mínimo `MatrixMiniR4 + WiFiS3 + OTAUpdate` (couber com folga em 256 KB;
     a branch BLE mediu 126.904 B com VM — sem VM deve cair).
   - Tempo total download+verify+update para um sketch de ~150 KB.
   - OTA funciona em **modo AP**? (o download é feito pelo modem; testar com o app na rede do
     AP do robô servindo o arquivo). Se não funcionar em AP, documentar e exigir modo station
     (hotspot do celular/roteador da sala) para OTA, mantendo AP para telemetria.

### Fase 1 — `bin2ota` em Node

- Novo arquivo `tools/bin2ota.js` (CommonJS, sem dependências externas): porta fiel de
  `bin2ota.py` + `lzss.py` da Arduino (formato: header com length/CRC32/magic number do board —
  para UNO R4 WiFi o magic deriva de VID/PID `0x2341`/`0x1002` — seguido do binário comprimido
  **LZSS**; confirmar campos exatos lendo os scripts de referência na Fase 0).
- Teste: `tools/bin2ota.test.js` compara byte a byte a saída com o fixture `.ota` gerado pela
  ferramenta oficial na Fase 0. **Não prosseguir sem igualdade binária.**

### Fase 2 — Firmware: `MiniR4WiFiRuntime`

- Novos arquivos: `arduino/libraries/MatrixMiniR4/src/Modules/MiniR4WiFiRuntime.{h,cpp}`.
- Implementa: credenciais/nome na dataflash (blocos 6–7), STA com fallback AP
  (`MBR4-<mac4>` / senha padrão documentada), discovery UDP (§2.1), servidor TCP NDJSON
  (§2.2), `safeDelay()`, modo de recuperação BTN_UP, handler de OTA chamando `OTAUpdate`.
- Parser JSON: mínimo/manual (mensagens são pequenas e planas — não adicionar ArduinoJson, para
  poupar flash/RAM; RAM já era 63% na branch BLE).
- Exemplo compilável: `examples/7-WiFi Runtime/MiniR4_WiFi_Runtime.ino`.
- Telemetria: extrair a serialização dos frames de `MiniR4BLERuntime.cpp` para um helper
  compartilhado (ou duplicar com comentário, se extrair exigir mexer na branch BLE — preferir
  duplicar aqui a tocar no código BLE).

### Fase 3 — App Electron: transporte + UI

- Novo `resources/app_src/blockly-core/wifi_upload.js` (espelho do `ble_upload.js` da branch
  BLE, que serve só de referência de integração): discovery UDP (`dgram`), cliente TCP (`net`),
  servidor HTTP efêmero (`http` — servir o `.ota` de um path aleatório, aceitar só o IP do robô
  alvo, derrubar ao fim), orquestração do fluxo §2.3 com timeout e retry (1 retry automático).
- **Processo:** `dgram`/`net`/`http` rodam no **main process**; UI conversa via IPC (seguir o
  padrão de IPC que o `app.compressed.js` já usa para o serialport).
- Wrapper do gerador: `arduino_wifi_wrapper.js` (§2.4) aplicado quando o alvo é WiFi.
- UI em `views/main.html` + `app.compressed.js`:
  - Botão **"Enviar via WiFi"** ao lado do upload USB e do BLE.
  - **Picker de robôs**: modal listando respostas do discovery (nome, IP, bateria, fw) com
    refresh e cancelamento — corrige na origem as pendências P2 da branch BLE.
  - Barra de progresso com fases (compilando / convertendo / enviando / gravando / reiniciando).
  - Diálogo de configuração: nome do robô e credenciais WiFi (`setname`/`setwifi`).
- Strings novas em pt-BR **e** en (o fork tem locale pt-BR em `blockly-core/msg/scratch_msgs.js`).

### Fase 4 — Telemetria via TCP

- Ligar o dashboard de telemetria existente à fonte TCP: comando `telemetry on` ao conectar,
  mesmo parsing de frames de hoje. Seleção de fonte (BLE/WiFi) onde o app hoje escolhe o BLE.
- Meta: ≥10 Hz estável com todos os sensores, sem perda visível em 10 min (a folga de banda é
  grande; o limitante é o poll no firmware).

### Fase 5 — Testes e ferramentas

- `tools/stress_upload_wifi.py` (adaptar `tools/stress_upload.py` da branch BLE): N uploads OTA
  consecutivos medindo tempo e taxa de sucesso. Meta: **20/20 uploads** de um sketch ≥100 KB.
- Teste e2e Playwright (padrão de `test_app.js`): abrir app → botão WiFi visível → picker abre
  → estados de erro (nenhum robô encontrado) renderizam.
- Atualizar `README.md` (seção da feature), `CHANGELOG.md`, e criar
  `docs/WIFI_UPLOAD.md` (guia do usuário final: como configurar a rede da sala, modo AP,
  recuperação com BTN_UP, solução de problemas).

---

## 4. Riscos conhecidos e decisões de contorno

1. **HTTP puro no `ota.download()`** — risco nº 1; por isso a Fase 0 existe. Plano B descrito lá.
2. **OTA em modo AP** — incógnita nº 2; verificar na Fase 0. Pior caso: OTA exige station
   (hotspot de celular resolve em sala/pit) e AP fica só para telemetria/discovery.
3. **Flash/RAM** — sem a VM sobra mais espaço que na branch BLE, mas medir na Fase 0 e imprimir
   o uso no log de compilação da UI (o fork já tem "footer size bar"; reusar).
4. **Firewall do Windows** — primeiro `dgram`/`http` do Electron dispara prompt do firewall;
   documentar no guia do usuário e detectar timeout de discovery com mensagem explicativa.
5. **Robô some após sketch do usuário travar** — coberto pelo modo de recuperação BTN_UP
   (Fase 2; é requisito, não opcional).
6. **Regras de competição** proíbem wireless durante rodadas — feature é de pit/treino/sala;
   deixar claro no `docs/WIFI_UPLOAD.md` e oferecer bloco/toggle "desligar rádio".
7. **Não usar** `WiFiS3` + `ArduinoBLE` no mesmo sketch (modem compartilhado).
8. **MQTT fica fora desta branch** — telemetria multi-robô via broker (modo professor) é feature
   futura separada; o protocolo TCP daqui não deve impedi-la (por isso NDJSON tipado com `"t"`).

## 5. Critérios de aceitação da branch

- [ ] Upload OTA de um programa Blockly de **>2000 blocos** (impossível na VM) funciona ponta a ponta.
- [ ] Tempo total "clicar → robô rodando" ≤ 60 s (dominado pela compilação, não pela rede).
- [ ] 20/20 uploads consecutivos sem falha (stress test).
- [ ] Dois robôs ligados simultaneamente: picker distingue e envia para o certo.
- [ ] Robô com sketch travado é recuperado via BTN_UP + novo OTA (sem USB).
- [ ] Telemetria ≥10 Hz por 10 min sem queda.
- [ ] Upload USB original continua intacto.
- [ ] `node patch_asar.js` e `node test_app.js` passam; docs atualizados.

## 6. Referências

- Exemplo oficial OTA: `github.com/arduino/ArduinoCore-renesas` → `libraries/OTAUpdate/examples/OTA/OTA.ino`
- Ferramenta de referência `.ota`: `github.com/arduino/ArduinoIoTCloud` → `extras/tools/bin2ota.py` e `lzss.py` (ou `arduino-cloud-cli ota encode`)
- Análise das limitações BLE/VM: `arduino/libraries/MatrixMiniR4/examples/6-VM Runtime/SESSION_2026-07-18_ALWAYS_ON_BLE.md` (branch `feature/always-on-ble-runtime`)
- Wrapper BLE de referência: `.../6-VM Runtime/ide_patch/blockly-core/arduino_ble_wrapper.js` (mesma branch)
- Alternativa descartada (limite de metade da flash): `github.com/JAndrassy/ArduinoOTA`
