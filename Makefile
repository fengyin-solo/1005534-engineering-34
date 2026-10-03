.PHONY: install frontend build preflight release rollback releases

install:
	cd frontend && npm ci

frontend:
	cd frontend && npm run dev

# 类型检查 + 依赖校验 + 绝对路径扫描的上线卡口
preflight:
	cd frontend && npm run preflight

# 卡口通过才构建，构建成功自动归档，供 rollback 回退旧版
release:
	cd frontend && npm run release

# 回退到上一发布归档；make rollback VERSION=release-YYYYMMDD-HHMMSS 可指定版本
rollback:
	cd frontend && npm run rollback -- $(VERSION)

releases:
	cd frontend && npm run releases

build:
	cd frontend && npm run build
