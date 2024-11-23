define create-download-tool-from-binary
download-tools: download-$(1)
.PHONY: download-$(1)
download-$(1): $$($(1))
$$($(1)): | $$(dot_dev)
	# download $(1)
	curl -o $$($(1)) -fsSL $$($(1)_url)
	# make $(1) executable
	chmod +x $$($(1))
endef

define create-download-tool-from-archive
download-tools: download-$(1)
.PHONY: download-$(1)
download-$(1): $$($(1))
$$($(1)): | $$(dot_dev)
	# clean extract directory
	rm -rf $$(dot_dev)/.tmp
	# create extract directory
	mkdir -p $$(dot_dev)/.tmp
	# download $(1) archive
	curl -o $$(dot_dev)/.tmp/archive.tar.gz -fsSL $$($(1)_url)
	# extract $(1)
	tar xzf $$(dot_dev)/.tmp/archive.tar.gz --strip-components $(2) -C $$(dot_dev)/.tmp
	# move $(1)
	mv $$(dot_dev)/.tmp/$(1) $$($(1))
	# clean extract directory
	rm -rf $$(dot_dev)/.tmp
endef