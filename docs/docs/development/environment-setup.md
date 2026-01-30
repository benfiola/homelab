---
title: Environment Setup
sidebar_position: 1
---

This guide provides instructions for setting up a development environment and contributing to the homelab project.

## Prerequisites

Before getting started, ensure you have:

- **Node.js** (22.21.0 recommended)
- **Git** for version control
- **Make** for development automation
- **Docker** (optional, if using devcontainers)
- A code editor (VSCode recommended)

## Quick Start

### Option 1: Using Devcontainers (Recommended)

The project includes a devcontainer configuration that sets up a complete development environment.

1. **Open the project in VSCode** with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

2. **Reopen in Container**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and select "Dev Containers: Reopen in Container"

3. **Wait for setup**: The devcontainer will automatically run the `post-create.sh` script which installs dependencies and tooling

### Option 2: Local Development Setup

If you prefer local development without devcontainers:

1. **Install Node.js** and **Make**

2. **Install project dependencies**:

```bash
make install-project
```

This installs npm dependencies and links the homelab CLI globally.

3. **Install tooling** (required for some operations):

:::tip Non-standard PATH
By default, this Makefile target installs to the local `.bin` folder. This directory will need to be added to your system `PATH`.

Alternatively, use `BIN=/usr/local/bin make install-tools` to install tools to a system location.
:::

```bash
make install-tools
```

4. **Install documentation dependencies** (if working on docs):

```bash
make install-docs
```

## Running the CLI

Use the homelab CLI command:

```bash
homelab [command] [options]
```

View all available commands:

```bash
homelab --help
```

## Documentation Development

The project uses [Docusaurus](https://docusaurus.io/) for documentation.

### Local Documentation Server

Start the development server:

```bash
make dev-docs
```

This starts a local server on `localhost:3000` with live reloading.

## Code Formatting

The project uses [Prettier](https://prettier.io/) for code formatting. Format on save is configured automatically in devcontainers.

## Next Steps

Once your environment is set up:

- See [Architecture](/category/architecture/) docs to understand the project structure and design decisions
- See [Configuration](/category/configuration/) docs to learn about configuration files and options
- See [Operations](/category/operations/) docs for cluster administration tasks
