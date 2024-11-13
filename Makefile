ASSETS ?= $(shell pwd)/.dev

ARGOCD_VERSION ?= 2.12.4
CILIUM_VERSION ?= 0.16.9
CLOUDFLARED_VERSION ?= 2024.3.0
HELM_VERSION ?= 3.14.3
K9S_VERSION ?= 0.32.6
KUBERNETES_VERSION ?= 1.30.5
KUBESEAL_VERSION ?= 0.26.2
MC_VERSION ?= RELEASE.2024-04-18T16-45-29Z
TALOS_VERSION ?= 1.8.2
VELERO_VERSION ?= 1.14.0

ARCH = $(shell arch)
ifeq ($(ARCH),aarch64)
	ARCH = arm64
else ifeq ($(ARCH),x86_64)
	ARCH = amd64
endif

ARGOCD = $(ASSETS)/argocd
ARGOCD_URL = https://github.com/argoproj/argo-cd/releases/download/v$(ARGOCD_VERSION)/argocd-linux-$(ARCH)
CILIUM = $(ASSETS)/cilium
CILIUM_URL = https://github.com/cilium/cilium-cli/releases/download/v$(CILIUM_VERSION)/cilium-linux-$(ARCH).tar.gz
CLOUDFLARED = $(ASSETS)/CLOUDFLARED
CLOUDFLARED_URL = https://github.com/cloudflare/cloudflared/releases/download/$(CLOUDFLARED_VERSION)/cloudflared-linux-$(ARCH)
HELM = $(ASSETS)/helm
HELM_URL = https://get.helm.sh/helm-v$(HELM_VERSION)-linux-$(ARCH).tar.gz
K9S = $(ASSETS)/k9s
K9S_URL = https://github.com/derailed/k9s/releases/download/v$(K9S_VERSION)/k9s_Linux_$(ARCH).tar.gz
KUBECTL = $(ASSETS)/kubectl
KUBECTL_URL = https://dl.k8s.io/release/v$(KUBERNETES_VERSION)/bin/linux/$(ARCH)/kubectl
KUBESEAL = $(ASSETS)/kubeseal
KUBESEAL_URL = https://github.com/bitnami-labs/sealed-secrets/releases/download/v$(KUBESEAL_VERSION)/kubeseal-$(KUBESEAL_VERSION)-linux-$(ARCH).tar.gz
MC = $(ASSETS)/mc
MC_URL = https://dl.min.io/client/mc/release/linux-$(ARCH)/archive/mc.$(MC_VERSION)
TALOSCTL = $(ASSETS)/talosctl
TALOSCTL_URL = https://github.com/siderolabs/talos/releases/download/v$(TALOS_VERSION)/talosctl-linux-$(ARCH)
VELERO = $(ASSETS)/velero
VELERO_URL = https://github.com/vmware-tanzu/velero/releases/download/v$(VELERO_VERSION)/velero-v$(VELERO_VERSION)-linux-$(ARCH).tar.gz

.PHONY: clean
clean:
	# delete assets folder
	rm -rf $(ASSETS)

$(ASSETS):
	mkdir -p $(ASSETS)

.PHONY: install-tools
install-tools: $(ARGOCD) $(CILIUM) $(CLOUDFLARED) $(HELM) $(K9S) $(KUBECTL) $(KUBESEAL) $(MC) $(TALOSCTL) $(VELERO)

$(ARGOCD): | $(ASSETS)
	# install argocd
	# download
	curl -fsSL -o $(ARGOCD) $(ARGOCD_URL)
	# make executable
	chmod +x $(ARGOCD)

$(CILIUM): | $(ASSETS)
	# install cilium
	# create temp folder
	rm -rf $(ASSETS)/tmp && mkdir -p $(ASSETS)/tmp
	# download
	curl -fsSL -o $(ASSETS)/tmp/file.tar.gz $(CILIUM_URL)
	# extract
	tar xvzf $(ASSETS)/tmp/file.tar.gz -C $(ASSETS)/tmp
	# copy
	cp $(ASSETS)/tmp/cilium $(CILIUM)
	# remove temp folder
	rm -rf $(ASSETS)/tmp

$(CLOUDFLARED): | $(ASSETS)
	# install cloudflared
	# download
	curl -fsSL -o $(CLOUDFLARED) $(CLOUDFLARED_URL)
	# make executable
	chmod +x $(CLOUDFLARED)

$(HELM): | $(ASSETS)
	# install helm
	# create temp folder
	mkdir -p $(ASSETS)/tmp
	# download
	curl -fsSL -o $(ASSETS)/tmp/file.tar.gz $(HELM_URL)
	# extract
	tar xvzf $(ASSETS)/tmp/file.tar.gz -C $(ASSETS)/tmp --strip-components=1
	# copy
	cp $(ASSETS)/tmp/helm $(HELM)
	# remove temp folder
	rm -rf $(ASSETS)/tmp

$(K9S): | $(ASSETS)
	# install k9s
	# create temp folder
	mkdir -p $(ASSETS)/tmp
	# download
	curl -fsSL -o $(ASSETS)/tmp/file.tar.gz $(K9S_URL)
	# extract
	tar xvzf $(ASSETS)/tmp/file.tar.gz -C $(ASSETS)/tmp
	# copy
	cp $(ASSETS)/tmp/k9s $(K9S)
	# remove temp folder
	rm -rf $(ASSETS)/tmp

$(KUBECTL): | $(ASSETS)
	# install kubectl
	# download
	curl -fsSL -o $(KUBECTL) $(KUBECTL_URL)
	# make executable
	chmod +x $(KUBECTL)

$(KUBESEAL): | $(ASSETS)
	# install kubeseal
	# create temp folder
	mkdir -p $(ASSETS)/tmp
	# download
	curl -fsSL -o $(ASSETS)/tmp/file.tar.gz $(KUBESEAL_URL)
	# extract
	tar xvzf $(ASSETS)/tmp/file.tar.gz -C $(ASSETS)/tmp
	# copy
	cp $(ASSETS)/tmp/kubeseal $(KUBESEAL)
	# remove temp folder
	rm -rf $(ASSETS)/tmp

$(MC): | $(ASSETS)
	# install mc
	# download
	curl -fsSL -o $(MC) $(MC_URL)
	# make executable
	chmod +x $(MC)

$(TALOSCTL): | $(ASSETS)
	# install talosctl
	# download
	curl -fsSL -o $(TALOSCTL) $(TALOSCTL_URL)
	# make executable
	chmod +x $(TALOSCTL)

$(VELERO): | $(ASSETS)
	# install velero
	# create temp folder
	mkdir -p $(ASSETS)/tmp
	# download
	curl -fsSL -o $(ASSETS)/tmp/file.tar.gz $(VELERO_URL)
	# extract
	tar xvzf $(ASSETS)/tmp/file.tar.gz -C $(ASSETS)/tmp --strip-components=1
	# copy
	cp $(ASSETS)/tmp/velero $(VELERO)
	# remove temp folder
	rm -rf $(ASSETS)/tmp
