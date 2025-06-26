include Includes.mk

ARGOCD_VERSION ?= 2.12.4
CILIUM_VERSION ?= 0.16.9
CLOUDFLARED_VERSION ?= 2024.3.0
GCLOUD_VERSION ?= 502.0.0
HELM_VERSION ?= 3.14.3
K9S_VERSION ?= 0.32.6
KUBERNETES_VERSION ?= 1.30.5
KUBESEAL_VERSION ?= 0.26.2
MC_VERSION ?= RELEASE.2024-04-18T16-45-29Z
TALOS_VERSION ?= 1.10.4

pwd = $(shell pwd)
dot_dev = $(pwd)/.dev
arch = $(shell arch)
ifeq ($(arch),aarch64)
	arch = arm64
else ifeq ($(arch),x86_64)
	arch = amd64
endif
gcloudarch = $(arch)
ifeq ($(arch),amd64)
	gcloudarch = x86_64
else ifeq ($(arch),arm64)
	gcloudarch = arm
endif

argocd = $(dot_dev)/argocd
argocd_url = https://github.com/argoproj/argo-cd/releases/download/v$(ARGOCD_VERSION)/argocd-linux-$(arch)
cilium = $(dot_dev)/cilium
cilium_url = https://github.com/cilium/cilium-cli/releases/download/v$(CILIUM_VERSION)/cilium-linux-$(arch).tar.gz
cloudflared = $(dot_dev)/CLOUDFLARED
cloudflared_url = https://github.com/cloudflare/cloudflared/releases/download/$(CLOUDFLARED_VERSION)/cloudflared-linux-$(arch)
gcloud = $(dot_dev)/gcloud
gcloud_url = https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-$(gcloudarch).tar.gz
helm = $(dot_dev)/helm
helm_url = https://get.helm.sh/helm-v$(HELM_VERSION)-linux-$(arch).tar.gz
k9s = $(dot_dev)/k9s
k9s_url = https://github.com/derailed/k9s/releases/download/v$(K9S_VERSION)/k9s_Linux_$(arch).tar.gz
kubectl = $(dot_dev)/kubectl
kubectl_url = https://dl.k8s.io/release/v$(KUBERNETES_VERSION)/bin/linux/$(arch)/kubectl
kubeseal = $(dot_dev)/kubeseal
kubeseal_url = https://github.com/bitnami-labs/sealed-secrets/releases/download/v$(KUBESEAL_VERSION)/kubeseal-$(KUBESEAL_VERSION)-linux-$(arch).tar.gz
mc = $(dot_dev)/mc
mc_url = https://dl.min.io/client/mc/release/linux-$(arch)/archive/mc.$(MC_VERSION)
talosctl = $(dot_dev)/talosctl
talosctl_url = https://github.com/siderolabs/talos/releases/download/v$(TALOS_VERSION)/talosctl-linux-$(arch)

.PHONY: clean
clean:
	# delete assets folder
	rm -rf $(dot_dev)

.PHONY: install-nodejs-project
install-nodejs-project:
	# install yarn
	npm install -g yarn
	# configure yarn
	yarn config set --home enableTelemetry 0
	# install project dependencies
	yarn install
	# symlink homelab cli to node_modules manually
	# NOTE: yarn intermittently fails to place the 'homelab' CLI in the node_modules/.bin folder
	rm -rf $(pwd)/node_modules/.bin/homelab
	ln -s $(pwd)/cli.ts $(pwd)/node_modules/.bin/homelab

.PHONY: download-tools
download-tools:

$(eval $(call create-download-tool-from-binary,argocd))
$(eval $(call create-download-tool-from-binary,cilium))
$(eval $(call create-download-tool-from-binary,cloudflared))
$(eval $(call create-download-tool-from-archive,helm,1))
$(eval $(call create-download-tool-from-archive,k9s,0))
$(eval $(call create-download-tool-from-binary,kubectl))
$(eval $(call create-download-tool-from-archive,kubeseal,0))
$(eval $(call create-download-tool-from-binary,mc))
$(eval $(call create-download-tool-from-binary,talosctl))

download-tools: download-gcloud
download-gcloud: $(gcloud)
$(gcloud): | $(dot_dev)
	# clean gcloud subdirectory
	rm -rf $(dot_dev)/gcloud-extract
	# clean extract files
	rm -rf /tmp/extract /tmp/archive.tar.gz && mkdir -p /tmp/extract
	# download archive
	curl -o /tmp/archive.tar.gz -fsSL $(gcloud_url)
	# extract archive
	tar xzf /tmp/archive.tar.gz --strip-components=1 -C /tmp/extract
	# copy extract folder to .dev folder
	mv /tmp/extract $(dot_dev)/gcloud-extract
	# create symlink
	ln -s $(dot_dev)/gcloud-extract/bin/gcloud $(gcloud)
	# delete archive files
	rm -rf /tmp/extract /tmp/archive.tar.gz

$(dot_dev):
	# create .dev directory
	mkdir -p $(dot_dev)
