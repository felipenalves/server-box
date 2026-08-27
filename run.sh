#!/bin/sh
# Server box — monitor do Android; o Mac só prepara o código.
# LAN:  http://<ip-do-aparelho>:8080  (qualquer dispositivo na rede)
# Fora: http://<ip-tailscale>:8080 (com Tailscale)
cd "$(dirname "$0")"
exec node server.js
