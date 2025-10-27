KUBECTL_VERSION := 1.33.2
TALOSCTL_VERSION := 1.11.3

PWD := $(shell pwd)
ARCH := $(shell uname -m)
BIN ?= $(PWD)/.bin

include Makefile.include.mk

.PHONY: default
default: list-targets

list-targets:
	@echo "available targets:"
	@LC_ALL=C $(MAKE) -pRrq -f $(firstword $(MAKEFILE_LIST)) : 2>/dev/null \
		| awk -v RS= -F: '/(^|\n)# Files(\n|$$$$)/,/(^|\n)# Finished Make data base/ {if ($$$$1 !~ "^[#.]") {print $$$$1}}' \
		| sort \
		| grep -E -v -e '^[^[:alnum:]]' -e '^$$@$$$$' \
		| sed 's/^/\t/'

.PHONY: install-tools
install-tools:

$(eval $(call tool-from-package-manager,bsdtar,libarchive-tools))
$(eval $(call tool-from-package-manager,curl,curl))
$(eval $(call tool-from-package-manager,git,git))

KUBECTL_ARCH := $(ARCH)
ifeq ($(ARCH),x86_64) 
	KUBECTL_ARCH := amd64
else ifeq ($(ARCH),aarch64)
	KUBECTL_ARCH := arm64
endif
KUBECTL_URL := https://dl.k8s.io/release/v$(KUBECTL_VERSION)/bin/linux/$(KUBECTL_ARCH)/kubectl
$(eval $(call tool-from-url,kubectl,$(KUBECTL_URL)))

TALOSCTL_ARCH := $(ARCH)
ifeq ($(ARCH),x86_64) 
	TALOSCTL_ARCH := amd64
else ifeq ($(ARCH),aarch64)
	TALOSCTL_ARCH := arm64
endif
TALOSCTL_URL := https://github.com/siderolabs/talos/releases/download/v1.11.3/talosctl-linux-$(TALOSCTL_ARCH)
$(eval $(call tool-from-url,talosctl,$(TALOSCTL_URL)))

$(BIN):
	# create bin folder
	mkdir -p $(BIN)