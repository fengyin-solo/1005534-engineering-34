.PHONY: install frontend build preflight release rollback

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

# 干净构建：换台机器克隆到空目录、装好依赖后，make build 也必须一次过
build:
	cd frontend && npm run build

# 上线卡口：依赖校验 + 类型检查，任一不过拦住发布
preflight:
	cd frontend && npm run preflight

# 发布：先过卡口再构建，产物收进 frontend/releases/<版本号>/
release:
	cd frontend && npm run release

# 回退旧版：make rollback VERSION=20261003120000；不传 VERSION 回退上一个版本
rollback:
	cd frontend && npm run rollback -- $(VERSION)
