# Roadmap — Features pós-TCP/OTA

> Este roadmap lista as features planejadas **depois** da conclusão da base descrita em
> [MANUAL_WIFI_TCP_OTA.md](MANUAL_WIFI_TCP_OTA.md) (branch `feature/wifi-tcp-ota`).
> Todas dependem da infraestrutura daquela branch (discovery UDP, protocolo TCP NDJSON,
> pipeline `bin2ota`, wrapper `MiniR4WiFiRuntime`) — **não iniciar nenhuma antes de o manual
> atingir seus critérios de aceitação.**
>
> Como o manual, este documento é autossuficiente para um agente de IA (Claude Opus ou
> similar) trabalhar sem acesso às conversas que o originaram. A ordem abaixo é a ordem de
> prioridade decidida pelo mantenedor. Cada feature deve virar uma branch própria a partir de
> `feature/wifi-tcp-ota` (ou de `master` após o merge).

---

## R1. Multi-missão sem PC (slots de programa no ESP32-S3)

**Prioridade: 1 (feature-assinatura do fork). Branch sugerida: `feature/mission-slots`**

O arquivo `.ota` é armazenado no filesystem do **ESP32-S3 (8 MB)** antes de o RA4M1 ser
regravado. Logo, o hub pode guardar **vários programas completos** e alternar entre eles sem
computador:

- App ganha o conceito de "slots": enviar programa para o slot N (`/mission1.ota` …
  `/missionN.ota` no fs do modem) com nome amigável.
- No hub, um gesto (ex.: segurar BTN_DOWN no boot) abre um **menu no OLED** navegável com
  UP/DOWN listando os slots; confirmar chama `OTAUpdate.update("/missionN.ota")` → o hub se
  regrava sozinho em ~10–20 s e reinicia na missão escolhida.
- Metadados dos slots (nomes, tamanhos, data) guardados num arquivo índice no fs do modem,
  lidos/escritos via comandos TCP novos (`slots_list`, `slot_write`, `slot_delete`).

**Caso de uso alvo:** WRO — equipe leva o robô para a mesa com todas as missões gravadas,
troca de programa **nativo completo** (não bytecode) entre rodadas, sem notebook.

**Validar primeiro (POC):** `ota.update(file_path)` aceita qualquer path do fs do modem;
quantos arquivos cabem; tempo real de regravação; comportamento com arquivo corrompido
(`verify()` por slot antes de aplicar).

**Aceite:** 3 missões gravadas → alternar entre as 3 pelo OLED sem PC, 10x seguidas, sem falha;
slot corrompido é detectado e recusado sem brickar (fallback: USB continua funcionando).

---

## R2. Modo duplo de envio: botão "Rápido (VM)" + botão "Gravar (OTA)" — com debug de bloco ao vivo

**Prioridade: 2. Branch sugerida: `feature/dual-upload-vm-tcp`**

Reaproveita a VM de bytecode da branch `feature/always-on-ble-runtime` trocando o transporte
Web Bluetooth (~40 B/s) por TCP (o bytecode de ≤6 KB sobe em milissegundos):

- **"Enviar (rápido)"**: compila blocos → bytecode (pipeline existente em
  `ide_patch/blockly-core/bytecode.js` + `generator_bytecode/`) → envia via TCP → VM executa.
  Iteração instantânea, sem arduino-cli. Sujeito às limitações conhecidas da VM (teto de 6 KB,
  handlers incompletos — ver `SESSION_2026-07-18_ALWAYS_ON_BLE.md` na branch BLE).
- **"Gravar (completo)"**: fluxo OTA do manual. Sem limites, para o programa de competição.
- Auto-sugestão: se o workspace usa blocos sem handler na VM ou excede o teto, o app
  desabilita o modo rápido com tooltip explicando o porquê.
- O firmware precisa carregar VM **e** runtime WiFi juntos (medir flash/RAM; a VM+BLE usava
  126.904 B / 63% RAM — sem o stack BLE deve haver folga, confirmar).

**Debug de bloco ao vivo (o diferencial):** a VM conhece o program counter. Adicionar:

- Mapa opcode→blockId emitido pelo gerador de bytecode junto com o programa.
- VM reporta PC via TCP (frame `{"t":"pc","addr":N}`, throttled ~20 Hz).
- IDE acende o bloco em execução no Blockly (highlight estilo Scratch), com pausa/step e
  leitura de variáveis (`{"t":"vars"}` → dump da tabela de variáveis da VM).

**Aceite:** editar um bloco e ver o efeito no robô em <2 s; highlight ao vivo acompanhando a
execução; breakpoint em um bloco pausa o robô; modo OTA continua intacto.

---

## R3. Console remoto (printf sem cabo)

**Prioridade: 3 — quase grátis, fazer junto ou logo após o manual. Pode viver na própria `feature/wifi-tcp-ota`.**

- Gerador redireciona os blocos de `Serial.print/println` para
  `WiFiRuntime.log(...)` que espelha no Serial USB **e** publica frame TCP
  `{"t":"log","s":"..."}` (buffer circular, descarte silencioso se desconectado).
- O console existente do app (que hoje lê a serial USB) ganha a fonte TCP — mesmo painel,
  mesma UI de gráfico/texto, só muda a origem dos dados.

**Aceite:** programa com prints rodando sem cabo mostra os logs no console do app em tempo
real; desconectar o app não trava nem atrasa o robô.

---

## R4. Espelho do OLED no app

**Prioridade: 4 — barato, alto valor didático. Branch sugerida: `feature/oled-mirror` (ou junto do R3).**

- O framebuffer do SSD1306 (128×64 mono = 1 KB) vive na RAM do RA4M1
  (classe `MiniR4OLED`/Adafruit_SSD1306 — o buffer é acessível).
- Comando TCP `{"t":"oled","on":true,"hz":5}` → runtime envia o buffer (1 KB, opcionalmente
  RLE) a ~5 Hz → app renderiza num canvas escalado ("o que o robô está pensando"), útil para o
  professor projetar a tela do robô no telão.

**Aceite:** animação no OLED físico aparece no app com atraso imperceptível (<300 ms) sem
degradar a telemetria.

---

## R5. Tuning ao vivo (PID, thresholds, constantes)

**Prioridade: 5. Branch sugerida: `feature/live-tuning`**

- Novo bloco "parâmetro ajustável" (nome + valor inicial + min/max): o gerador registra cada
  parâmetro numa tabela no firmware (nome → ponteiro/valor).
- Comandos TCP: `{"t":"params"}` (lista) e `{"t":"set","k":"kp","v":1.8}` (escreve).
- Painel no app com sliders gerados automaticamente a partir da lista; alterações aplicam sem
  regravar. Persistência opcional do último valor na dataflash para sobreviver ao reboot.
- Caso de uso âncora: tunar PID do DriveDC vendo o gráfico da telemetria (setpoint × encoder)
  ao lado dos sliders.

**Aceite:** ajustar Kp com o robô rodando e ver a resposta no gráfico sem recompilar; valores
persistem após reboot quando o usuário salvar.

---

## R6. Controle remoto virtual + teach-in

**Prioridade: 6. Branch sugerida: `feature/remote-drive`**

- **Dirigir pelo app:** joystick/WASD na UI → frames TCP `{"t":"drive","l":N,"r":N}` (~20 Hz)
  → runtime aciona os motores quando em "modo remoto" (entrado por comando, saído por timeout
  de 500 ms sem frames — failsafe obrigatório: parar motores).
- **Teach-in:** o app grava a sequência de comandos com timestamps e converte em blocos de
  movimento (`runFor`/`turn`) inseridos no workspace — pilotou, virou programa autônomo
  editável.

**Aceite:** dirigir o robô pelo app com latência aceitável (<150 ms percebida); perda de
conexão para os motores em ≤500 ms; gravação de 30 s vira programa que reproduz o trajeto
aproximado.

---

## R7. Deploy em turma + telemetria multi-robô ("modo professor")

**Prioridade: 7. Branch sugerida: `feature/classroom`**

- O discovery UDP já enxerga todos os robôs da rede. UI nova: lista de robôs com checkbox →
  **enviar o mesmo programa para N robôs** (fila de OTAs sequenciais com progresso por robô).
- Painel professor: telemetria resumida de todos (bateria, estado, último log) em grade.
- Evolução natural (fase 2 desta feature): broker MQTT embutido no app (ex.: Aedes, npm puro)
  e o runtime publicando telemetria via PubSubClient — só migrar para MQTT se o fan-in TCP
  simples (N sockets) mostrar limite prático; começar pelo simples.

**Aceite:** 5 robôs recebem o mesmo programa em sequência sem intervenção; painel mostra os 5
ao vivo; falha em um robô não interrompe a fila.

---

## R8. Dashboard no celular (página web servida pelo app)

**Prioridade: 8. Branch sugerida: `feature/phone-dashboard`**

- O app já roda um servidor HTTP para o OTA; expandi-lo (porta separada, ex.: 47803) para
  servir uma SPA mínima (HTML único, sem build) com: telemetria ao vivo (WebSocket → ponte
  para o TCP do robô), botão START/STOP, cronômetro de rodada.
- Aluno abre `http://<ip-do-notebook>:47803` no celular — nada para instalar.
- Atenção: page é só leitura + start/stop; nenhum comando destrutivo/upload pela página.

**Aceite:** celular na mesma rede vê telemetria ao vivo e dispara START; dois celulares
simultâneos funcionam.

---

## R9. Visualizador OpenMV integrado

**Prioridade: 9 — módulo independente, pode andar em paralelo a qualquer outra. Branch sugerida: `feature/openmv-viewer`**

Não embutir o OpenMV IDE (Qt, GPL, manutenção pesada). Em vez disso, falar o **protocolo de
debug USB aberto** da OpenMV, cuja implementação de referência é `pyopenmv.py` (repositório
`openmv/openmv`, pasta `tools/`): conexão serial, envio de script MicroPython, streaming do
framebuffer.

- Portar o essencial de `pyopenmv.py` para JS sobre o `@serialport` **já empacotado** no app.
- Nova aba "Câmera": stream do framebuffer ao vivo (canvas) + editor do script MicroPython
  usando o **Monaco já integrado** (modo C++ do fork) + botões rodar/parar/salvar na câmera.
- Escopo mínimo deliberado: ver imagem + editar/rodar script. Sem depurador MicroPython, sem
  gerenciador de pacotes — para isso existe o OpenMV IDE oficial.
- Vídeo **através do hub** está fora de escopo (UART do hub limita a ~1 fps inútil); a câmera
  conecta direto no USB do PC. No robô, a OpenMV conversa com o hub por UART apenas com
  mensagens de detecção (via `SmartCamReader`/protocolo próprio), como hoje.

**Aceite:** plugar OpenMV no USB → aba Câmera mostra vídeo ao vivo; editar script e rodar sem
abrir o OpenMV IDE; desconectar a câmera não afeta o resto do app.

---

## R10. Gerenciador de firmware do hub

**Prioridade: 10 (qualidade de vida). Branch sugerida: `feature/firmware-manager`**

Painel "Firmware do Hub" com a versão de cada camada e botão de atualização:

| Camada | Versão via | Atualização |
|---|---|---|
| Sketch/runtime do usuário | comando TCP `info` (campo `fw`) | OTA (já existe) |
| Biblioteca MatrixMiniR4 empacotada | `library.properties` local | junto do app |
| ESP32-S3 usb-bridge | `WiFi.firmwareVersion()` reportado no `info` | USB, orquestrando `arduino-fwuploader` (empacotar no app, como o arduino-cli) |
| STM32F103 (MMLower) | protocolo interno MMLower (investigar em `Modules/MMLower.cpp`) | USB/DFU — embrulhar o fluxo existente da pasta `dfu/` (STM32_Programmer_CLI) numa UI com changelog |

- Investigação registrada à parte: atualização *wireless* do STM32 via RA4M1 (bootloader UART
  do F103) — **não prometida**; documentar viabilidade em `docs/STM32_OTA_FINDINGS.md` antes
  de qualquer implementação.

**Aceite:** painel mostra as 4 versões corretas; atualizar o usb-bridge e o MMLower pelo app
sem ferramentas externas; qualquer falha deixa instruções de recuperação na tela.

---

## Fora do roadmap (decisões registradas)

- **Overlay de detecções da HuskyLens na telemetria** — considerado e descartado por ora: o
  mantenedor não possui a câmera para testar. Reavaliar se o hardware ficar disponível; o
  design está descrito na conversa de origem (retângulos/IDs via telemetria TCP, sem vídeo).
- **Portar a VM para dentro da branch TCP/OTA base** — não; a VM entra apenas via R2.
- **MQTT como transporte primário** — não; entra no máximo como evolução interna do R7.
