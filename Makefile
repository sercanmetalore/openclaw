SHELL := /bin/bash

# Override if you prefer a different global update command, e.g.:
# make OPENCLAW_UPDATE_CMD='pnpm add -g .'
OPENCLAW_UPDATE_CMD ?= npm i -g . --force
EXTENSIONS_UPDATE_CMD ?= openclaw plugins update --all

.PHONY: all build ui-build update extensions-sync restart sync-local

all: sync-local

build:
	pnpm build

ui-build:
	pnpm ui:build

update:
	$(OPENCLAW_UPDATE_CMD)

extensions-sync:
	$(EXTENSIONS_UPDATE_CMD)

restart:
	openclaw gateway restart

sync-local: build ui-build update extensions-sync restart
	@echo "Local OpenClaw sync complete."
