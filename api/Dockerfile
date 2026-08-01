FROM node:22-alpine
WORKDIR /app

# ── AI Coach: the provider CLI ships inside the image ──────────────────────────
# Self-hosters install nothing and run nothing: `docker compose pull && up -d` is the whole
# story, and the Coach is switched on (and signed in to) from the admin dashboard afterwards.
#
# The version is pinned rather than floating because two things depend on knowing exactly
# which CLI is in here: the flags the adapter passes it (api/coach/adapters/claude.js) and the
# OAuth client parameters the connect flow uses (api/coach/oauth.js). Bumping this line means
# re-checking both — which is also why `claude --version` runs here. A CLI that cannot start
# is a failed build, not a support ticket from someone whose Coach never worked.
#
# libgcc/libstdc++ cover the native bits Node addons expect on musl; without them a
# glibc-built optional dependency fails at require time rather than at install time.
ARG CLAUDE_CLI_VERSION=2.1.212
RUN apk add --no-cache libgcc libstdc++ \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION} \
 && npm cache clean --force \
 && claude --version

# Coach jobs run as this user, which is not root and cannot read /data (chmod 0700 at boot).
# The CLI therefore sees its job's temp directory and nothing else — no state files, no
# db.json, no session secret, no provider credential.
RUN addgroup -S coach && adduser -S -G coach -H -s /sbin/nologin coach

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY coach/ ./coach/
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
