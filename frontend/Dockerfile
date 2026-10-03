# 构建阶段：卡口（依赖校验 + 类型检查）不过，镜像直接构建失败，发布被拦在门外
FROM node:20-alpine AS build
WORKDIR /srv/web
# 只拷依赖清单，利用构建缓存；仓库无 package-lock.json，使用 npm install
COPY package.json ./
RUN npm install
COPY . .
# 上线卡口 + 生产构建，任一不过整行非零退出
RUN npm run preflight && npm run build

# 运行阶段：只放构建产物，部署的就是卡口验过的那一份
FROM nginx:alpine
COPY --from=build /srv/web/dist /usr/share/nginx/html
EXPOSE 80
