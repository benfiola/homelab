CDK8S_VERSION ?= 2.203.1
CILIUM_VERSION ?= 1.18.5
CILIUMCLI_VERSION ?= 0.18.9
FLUX_VERSION ?= 2.7.3
HELM_VERSION ?= 4.0.0
JB_VERSION ?= 0.6.0
K9S_VERSION ?= 0.50.16
KUBECTL_VERSION ?= 1.34.2
TALOSCTL_VERSION ?= 1.11.5
TSX_VERSION ?= 4.20.6
VAULT_VERSION ?= 1.21.1

ARCH ?= $(shell uname -m)
BIN ?= ./.bin
DIST ?= ./.dist

arch := $(ARCH)
ifeq ($(arch),aarch64)
    arch := arm64
else ifeq ($(arch),x86_64)
    arch := amd64
endif

bin := $(abspath $(BIN))
dist := $(abspath $(DIST))
project := $(abspath $(dir $(MAKEFILE_LIST)))

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

.PHONY: build-docs
build-docs: install-docs
	# build docs
	cd docs && npm run build -- --out-dir=$(dist)

.PHONY: dev-docs
dev-docs: install-docs
	# run docs dev server
	cd docs && npm run start

.PHONY: install-docs
install-docs:
	# install doc dependencies
	cd docs && npm install

.PHONY: install-project
install-project:
	# install homelab project (and dependencies)
	npm install
	# link homelab project to global installation
	npm link

.PHONY: install-tools
install-tools:

$(eval $(call tool-from-apt,bsdtar,libarchive-tools))
$(eval $(call tool-from-apt,curl,curl))
$(eval $(call tool-from-apt,git,git))
$(eval $(call tool-from-apt,jsonnet,jsonnet))
$(eval $(call tool-from-npm,cdk8s,cdk8s-cli))
$(eval $(call tool-from-npm,tsx,tsx))

ciliumcli_arch := $(arch)
ciliumcli_url := https://github.com/cilium/cilium-cli/releases/download/v$(CILIUMCLI_VERSION)/cilium-linux-$(ciliumcli_arch).tar.gz
$(eval $(call tool-from-tar-gz,cilium,$(ciliumcli_url),0))

flux_arch := $(arch)
flux_url := https://github.com/fluxcd/flux2/releases/download/v$(FLUX_VERSION)/flux_$(FLUX_VERSION)_linux_$(flux_arch).tar.gz
$(eval $(call tool-from-tar-gz,flux,$(flux_url), 0))

gcloud_arch := $(arch)
ifeq ($(gcloud_arch),arm64)
	gcloud_arch := arm
else ifeq ($(gcloud_arch),amd64)
	gcloud_arch := x86_64
endif
gcloud_url := https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-$(gcloud_arch).tar.gz
install-tools: install-tools__gcloud
.PHONY: install-tools__gcloud
install-tools__gcloud: $(bin)/gcloud
$(bin)/gcloud: $(bin)/bsdtar $(bin)/curl | $(bin)
	# clean temp paths
	rm -rf $(bin)/.gcloud $(bin)/.archive.tar.gz && mkdir -p $(bin)/.gcloud
	# download gcloud archive
	curl -o $(bin)/.archive.tar.gz -fsSL $(gcloud_url)
	# extract gcloud
	bsdtar xvzf $(bin)/.archive.tar.gz -C $(bin)/.gcloud
	# symlink gcloud
	ln -sf $(bin)/.gcloud/google-cloud-sdk/bin/gcloud $(bin)/gcloud
	# clean temp paths
	rm -rf $(bin)/.archive.tar.gz

helm_arch := $(arch)
helm_url := https://get.helm.sh/helm-v$(HELM_VERSION)-linux-$(helm_arch).tar.gz
$(eval $(call tool-from-tar-gz,helm,$(helm_url), 1))

hubble_arch := $(arch)
hubble_url := https://github.com/cilium/hubble/releases/download/v$(CILIUM_VERSION)/hubble-linux-$(hubble_arch).tar.gz
$(eval $(call tool-from-tar-gz,hubble,$(hubble_url),0))

jb_arch := $(arch)
jb_url := https://github.com/jsonnet-bundler/jsonnet-bundler/releases/download/v$(JB_VERSION)/jb-linux-$(jb_arch)
$(eval $(call tool-from-url,jb,$(jb_url)))

k9s_arch := $(arch)
k9s_url := https://github.com/derailed/k9s/releases/download/v$(K9S_VERSION)/k9s_Linux_$(k9s_arch).tar.gz
$(eval $(call tool-from-tar-gz,k9s,$(k9s_url), 0))

kubectl_arch := $(arch)
kubectl_url := https://dl.k8s.io/release/v$(KUBECTL_VERSION)/bin/linux/$(kubectl_arch)/kubectl
$(eval $(call tool-from-url,kubectl,$(kubectl_url)))

talosctl_arch := $(arch)
talosctl_url := https://github.com/siderolabs/talos/releases/download/v$(TALOSCTL_VERSION)/talosctl-linux-$(talosctl_arch)
$(eval $(call tool-from-url,talosctl,$(talosctl_url)))

vault_arch := $(arch)
vault_url := https://releases.hashicorp.com/vault/$(VAULT_VERSION)/vault_$(VAULT_VERSION)_linux_$(vault_arch).zip
$(eval $(call tool-from-zip,vault,$(vault_url),0))

$(bin):
	# create bin folder
	mkdir -p $(bin)