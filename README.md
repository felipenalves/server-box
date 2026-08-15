# Server Box

Painel de status do teu servidor de bolso. Feito pra rodar num celular Android velho (Termux) e ver, numa página só, se o troço tá vivo:

- **Sistema** — uptime, carga, hostname
- **Bateria** — nível, carregando ou descarregando
- **Memória e disco** — RAM, uso de disco
- **Cron** — o que tá agendado e rodando
- **Apps** — processos `node` vivos
- **News digest** — estado do `~/newsdigest` (some se não existir)

Zero dependências: Node puro, sem `npm install`, sem internet pra fora da tua rede.

> Feito pra acompanhar o guia [Como Transformar um Celular Velho em Servidor Pessoal](https://inovadigitalid.com/guia/servidor-j5-prime). MIT.

## Como rodar

No aparelho (Termux):

```bash
cd ~/app
git clone https://github.com/felipenalves/server-box.git
cd server-box
node server.js
```

Abre no navegador:

- rede local: `http://SEU_IP:8080`
- de fora (com Tailscale): `http://100.x.y.z:8080`

## Deixar rodando sempre

Com o cron ativo no Termux (`sv-enable crond`):

```bash
crontab -e
```

Adicione a linha (ajuste o caminho se o projeto não estiver em `~/app`):

```
@reboot sh ~/app/server-box/run.sh
```

## Testes

```bash
node --test test/*.test.mjs
```

## Segurança

- Acesso só pela tua rede (local ou Tailscale). Não abra porta no roteador.
- Headers de segurança básicos (nosniff, frame deny, referrer policy).
- Sem PIN de propósito: a proteção é a rede, não uma senha de 4 dígitos.