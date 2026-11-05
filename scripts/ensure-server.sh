#!/usr/bin/env bash
# Veille Lumo — garantit que le serveur Next.js répond sur le port 3000.
# Idempotent : ne fait rien si tout va déjà bien, sinon démarre + préchauffe.
set -u
cd /home/z/my-project
LOG=scripts/ensure-server.log

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# 1) Serveur déjà vivant ?
if curl -s -o /dev/null --max-time 5 http://localhost:3000/; then
  say OK
  exit 0
fi

# 2) Sinon : nettoyage des restes éventuels puis démarrage propre
say "serveur absent — démarrage"
pkill -f "next dev -p 3000" 2>/dev/null
sleep 1
nohup bun run dev > /dev/null 2>&1 &

# 3) Attendre la disponibilité (60 s max) — le dernier GET préchauffe la page
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 3 http://localhost:3000/; then
    say STARTED
    exit 0
  fi
  sleep 1
done

say "ECHEC du démarrage — voir dev.log"
exit 1
