# Server Box

Painel de status do teu servidor de bolso. Feito pra rodar em qualquer celular Android (Termux) e ver, numa página só, se o aparelho tá vivo:

- **Sistema** — uptime, carga, hostname
- **Bateria** — nível, carregando ou descarregando
- **Memória e disco** — RAM, uso de disco
- **Operação** — server-box ativo e rotinas automáticas configuradas
- **Cron** — horários e próxima execução de cada rotina
- **Digest** — painel opcional; só aparece quando `~/newsdigest` existe

Zero dependências: Node puro, sem `npm install`, sem internet pra fora da tua rede.

> Feito pra acompanhar o guia [Como Transformar um Celular Velho em Servidor Pessoal](https://inovadigitalid.com/guia/servidor-j5-prime). MIT.

O painel não exige um J5 Prime: identifica o modelo pelo próprio Android. A bateria é lida pelo sistema; se o aparelho não expuser essa informação, ele tenta usar o Termux:API.

## Como rodar

No aparelho (Termux):

```bash
pkg install nodejs
cd ~/app
git clone https://github.com/felipenalves/server-box.git
cd server-box
node server.js
```

Abre no navegador:

- rede local: `http://SEU_IP:8080`
- de fora (com Tailscale): `http://100.x.y.z:8080`

### Como ler o painel

- **Sistema** mostra os recursos atuais do aparelho: memória, disco, bateria, carga e tempo ligado.
- **Operação** é o espaço para os teus crons. Crons são tarefas automáticas configuradas no Termux; se ainda não existir nenhum, o painel informa isso sem tratar como erro.
- **Digest** não faz parte da instalação básica. Ele só aparece depois que o módulo `~/newsdigest` existir.

Se a bateria aparecer sem leitura, instale o pacote `termux-api` no Termux e o aplicativo Termux:API correspondente. O painel tenta `termux-battery-status` como alternativa.

## Deixar rodando sempre

Com o cron ativo no Termux (`sv-enable crond`):

```bash
crontab -e
```

Adicione a linha (ajuste o caminho se o projeto não estiver em `~/app`):

```
@reboot sh ~/app/server-box/run.sh
```

Essa linha mantém apenas o painel no ar. Outras rotinas são opcionais e podem ser adicionadas no mesmo `crontab`.

## Testes

```bash
node --test test/*.test.mjs
```

## Segurança

- Acesso só pela tua rede (local ou Tailscale). Não abra porta no roteador.
- Headers de segurança básicos (nosniff, frame deny, referrer policy).
- Sem PIN de propósito: a proteção é a rede, não uma senha de 4 dígitos.
