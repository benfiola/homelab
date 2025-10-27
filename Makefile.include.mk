define tool-from-package-manager
install-tools: install-tools__$(1)
.PHONY: install-tools__$(1)
install-tools__$(1): $$(BIN)/$(1)
$$(BIN)/$(1): | $$(BIN)
	# update package index
	apt -y update
	# install $(2)
	DEBIAN_FRONTEND=noninteractive apt -y install $(2)
	# symlink $(1)
	ln -fs /usr/bin/$(1) $$(BIN)/$(1)
endef

define tool-from-tar-gz
install-tools: install-tools__$(1)
.PHONY: install-tools__$(1)
install-tools__$(1): $$(BIN)/$(1)
$$(BIN)/$(1): $$(BIN)/bsdtar $$(BIN)/curl | $$(BIN)
	# clean temp paths
	rm -rf $$(BIN)/.extract $$(BIN)/.archive.tar.gz && mkdir -p $$(BIN)/.extract
	# download $(1) archive
	curl -o $$(BIN)/.archive.tar.gz -fsSL $(2)
	# extract $(1)
	bsdtar xvzf $$(BIN)/.archive.tar.gz --strip-components $(3) -C $$(BIN)/.extract
	# move $(1)
	mv $$(BIN)/.extract/$(1) $$(BIN)/$(1)
	# clean temp paths
	rm -rf $$(BIN)/.extract $$(BIN)/.archive.tar.gz 
endef

define tool-from-url
install-tools: install-tools__$(1)
.PHONY: install-tools__$(1)
install-tools__$(1): $$(BIN)/$(1)
$$(BIN)/$(1): $$(BIN)/curl | $$(BIN)
	# download $(1) archive
	curl -o $$(BIN)/$(1) -fsSL $(2)
	# make $(1) executable
	chmod +x $$(BIN)/$(1)
endef

define tool-from-zip
install-tools: install-tools__$(1)
.PHONY: install-tools__$(1)
install-tools__$(1): $$(BIN)/$(1)
$$(BIN)/$(1): $$(BIN)/bsdtar $$(BIN)/curl | $$(BIN)
	# clean temp paths
	rm -rf $$(BIN)/.extract $$(BIN)/.archive.zip && mkdir -p $$(BIN)/.extract
	# download $(1) archive
	curl -o $$(BIN)/.archive.zip -fsSL $(2)
	# extract $(1)
	bsdtar xvf $$(BIN)/.archive.zip --strip-components $(3) -C $$(BIN)/.extract
	# move $(1)
	mv $$(BIN)/.extract/$(1) $$(BIN)/$(1)
	# clean temp paths
	rm -rf $$(BIN)/.extract $$(BIN)/.archive.zip 
endef