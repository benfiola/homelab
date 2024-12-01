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
	# clean extract files
	rm -rf /tmp/extract /tmp/archive.tar.gz && mkdir -p /tmp/extract
	# download $(1) archive
	curl -o /tmp/archive.tar.gz -fsSL $$($(1)_url)
	# extract $(1)
	tar xzf /tmp/archive.tar.gz --strip-components $(2) -C /tmp/extract
	# move $(1)
	mv /tmp/extract/$(1) $$($(1))
	# clean extract files
	rm -rf /tmp/extract /tmp/archive.tar.gz
endef