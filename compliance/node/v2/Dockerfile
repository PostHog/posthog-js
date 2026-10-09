ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
ENV CI=true HUSKY=0 PREK=0 TURBO_TELEMETRY_DISABLED=1
WORKDIR /source
COPY . .
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"
RUN pnpm install --frozen-lockfile --filter posthog-node...
ARG SOURCE_REVISION
ENV SOURCE_REVISION=${SOURCE_REVISION}
RUN node compliance/node/v2/build-packages.mjs /output
RUN POSTHOG_NODE_CONSUMER=/output/consumer node --test compliance/node/v2/*.test.mjs

FROM scratch AS packages
COPY --from=build /output/ /

FROM ${NODE_IMAGE} AS adapter
WORKDIR /adapter
COPY --from=build /output/consumer /consumer
COPY --from=build /output/build.json /build.json
COPY compliance/node/v2/binding.mjs compliance/node/v2/server.mjs compliance/node/v2/worker.mjs ./
ENV POSTHOG_NODE_CONSUMER=/consumer HOST=0.0.0.0 PORT=8080 POSTHOG_CAPTURE_MODE=v0 POSTHOG_NODE_MODULE=cjs
USER node
ENTRYPOINT ["node", "/adapter/server.mjs"]
