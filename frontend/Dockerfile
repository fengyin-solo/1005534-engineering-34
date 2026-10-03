FROM node:20-alpine
WORKDIR /srv/web
# 连同 lockfile 一起拷贝，装出与 lockfile 一致的依赖；换机器构建结果可复现。
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
