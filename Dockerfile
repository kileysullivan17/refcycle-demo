# RefCycle whole app: one container, two processes. The pinned engine listens on 127.0.0.1:3000 inside the
# container and is never reachable from outside; the app listens on PORT and is the only thing the host
# sends visitors to. The engine's code is used as it is.
# Node 26 is the version the tests were run on.
FROM node:26-slim

WORKDIR /srv/refcycle

# Packages first, so a change to the code does not reinstall them. Both run their TypeScript with tsx,
# which is a dev dependency, so the full install is needed. No browser is downloaded.
COPY engine/code/package.json engine/code/package-lock.json engine/code/
RUN cd engine/code && npm ci --no-audit --no-fund
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci --no-audit --no-fund

COPY engine engine
COPY app app
COPY scripts/start-host.sh scripts/start-host.sh

# The spending ledger lives in app/logs; on the host a volume is mounted there so a restart or a new
# deploy does not set the daily count back to zero.
RUN mkdir -p app/logs engine/logs

ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["sh", "scripts/start-host.sh"]
