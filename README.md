# Server Box

Painel de status para servidor caseiro em Android (Termux) — ou qualquer máquina Node.

Mostra numa página só: uptime, carga, bateria, RAM, cron, processos do app e saúde do news digest. Zero dependências: só Node puro, sem `npm install`.

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

Um PIN de 4 dígitos é gerado na primeira execução e salvo em `.j5-pin` (use `cat .j5-pin` pra ver). A página pede o PIN uma vez.

## Deixar rodando sempre

No Termux, com o cron ativo (`sv-enable crond`), agende o boot:

```bash
crontab -e
```

Adicione a linha (ajuste o caminho se o projeto não estiver em `~/app`):

```
@reboot sh ~/app/server-box/run.sh
```

## O que o painel mostra

| Bloco | O que lê |
|---|---|
| Sistema | `/proc/uptime`, load average, hostname |
| Bateria | `sysfs` (nível, status carregando/descarregando) |
| Memória | `/proc/meminfo` |
| Cron | `crontab -l` + processos vivos |
| Apps | processos `node` em execução |
| News digest | estado do `~/newsdigest` (opcional — some se não existir) |

A página atualiza sozinha e tem tema claro/escuro.

## Testes

```bash
node --test test/*.test.mjs
```

## Segurança

- PIN de 4 dígitos em `.j5-pin` (gitignored) — protege a página
- Headers de segurança básicos (nosniff, frame deny, referrer)
- Sem dependências externas, sem internet fora da sua rede (a menos que você abra via Tailscale)
- Não abra porta no roteador: use Tailscale pra acesso remoto