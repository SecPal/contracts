#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025-2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

echo "🔧 Setting up pre-commit hooks for SecPal..."

# Check if pre-commit is installed
if ! command -v pre-commit &>/dev/null; then
	echo "❌ pre-commit is not installed."
	echo ""
	echo "Install it using one of the following methods:"
	echo ""
	echo "  # Using pip:"
	echo "  pip install pre-commit"
	echo ""
	echo "  # Using brew (macOS):"
	echo "  brew install pre-commit"
	echo ""
	echo "  # Using apt (Debian/Ubuntu):"
	echo "  sudo apt install pre-commit"
	echo ""
	exit 1
fi

# Install the locked Node toolchain used by local formatter hooks.
if ! command -v npm &>/dev/null; then
	echo "❌ npm is not installed. Install Node.js and npm before setting up hooks."
	exit 1
fi

echo "📦 Installing locked Node dependencies..."
npm ci

# Install pre-commit hooks
echo "📦 Installing pre-commit hooks..."
pre-commit install --install-hooks

# Run hooks on all files to verify setup
echo "🧪 Running hooks on all files to verify setup..."
if pre-commit run --all-files; then
	echo ""
	echo "✅ Pre-commit hooks installed successfully!"
	echo ""
	echo "Hooks will now run automatically on git commit."
	echo "To run manually: pre-commit run --all-files"
	echo "To update hooks: pre-commit autoupdate"
else
	echo ""
	echo "⚠️  Some hooks failed. Please fix the issues above."
	echo ""
	exit 1
fi
