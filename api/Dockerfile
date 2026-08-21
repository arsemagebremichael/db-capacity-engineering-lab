# Node.js API image for the Regional Health service.
#
# C5 image hardening:
#   * base pinned by DIGEST, not tag — a tag can be re-pointed at a different
#     image under the same name; a digest cannot. Dependabot bumps it via PR.
#   * multi-stage, so npm never reaches the runtime layer. npm carries its own
#     unpatchable deps (brace-expansion, ip-address, tar, minimatch) and the
#     app runs `node server.js` — it has no use for a package manager.
#   * non-root at runtime (DS-0002).
#   * HEALTHCHECK on /healthz.

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build

WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

# The seed script (run inside this container) needs the mysql CLI.
# apt-get upgrade pulls the security-patched OS packages the base ships stale;
# removing npm/npx drops the last vulnerable node packages from the image.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends default-mysql-client bash \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --chown=node:node . .

# The seed script lives in ../data-seed and is bind-mounted at runtime by
# docker-compose to /usr/local/bin/seed.sh (it is outside this build context,
# so it cannot be COPYed here).

# Drop root for the runtime process. node:22-bookworm-slim ships a non-root
# `node` user, so this needs no useradd. It sits after npm install (which needs
# root to write into the image) and before CMD, so only the app is unprivileged.
USER node

EXPOSE 3000

# Liveness from inside the container. Uses node rather than curl/wget so the
# runtime image needs no extra packages — each one is more CVE surface.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
