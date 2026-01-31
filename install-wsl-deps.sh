#!/bin/bash
# Install required Electron dependencies for WSL

echo "Installing Electron dependencies for WSL..."
echo "This requires sudo privileges."
echo ""

sudo apt-get update
sudo apt-get install -y \
  libnss3 \
  libnspr4 \
  libnssutil3 \
  libsmime3 \
  libasound2 \
  libgconf-2-4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libgdk-pixbuf2.0-0 \
  libgtk-3-0 \
  libgbm-dev

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "Next steps:"
echo "1. Ensure X server is running (for GUI)"
echo "2. Run: npm run dev"
