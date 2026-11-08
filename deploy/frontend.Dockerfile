FROM node:24-alpine AS build
WORKDIR /app
COPY my-app/package.json my-app/package-lock.json ./
RUN npm ci
COPY my-app/ ./
# Public routing only. Credentials must never be build arguments or VITE_* values.
ENV VITE_API_BASE_URL=""
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx-backend.conf /etc/nginx/includes/backend.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
