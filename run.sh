#!/bin/sh
# Server box — monitor do J5 + Mac.
# LAN:  http://<ip-do-mac>:8080  (qualquer device na rede)
# Fora: http://<ip-tailscale>:8080 (app Tailscale em qualquer device)
node server.js
