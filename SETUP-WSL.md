# WSL Setup Guide for Pocket Agent

This guide covers setting up Pocket Agent in Windows Subsystem for Linux (WSL).

## Changes Made for Cross-Platform Compatibility

The application has been updated to work on both macOS and Linux:

### 1. PATH Configuration
- Updated `src/main/index.ts` to detect platform and use appropriate paths
- macOS: Homebrew paths (`/opt/homebrew/bin`, `/usr/local/bin`)
- Linux: Standard Linux paths (`/usr/local/bin`, `/usr/bin`)

### 2. System Tray Icons
- Made `setTemplateImage()` calls conditional (macOS only)
- Linux uses standard PNG icons for tray

### 3. Permissions Module
- `src/permissions/macos.ts` now handles Linux gracefully
- Returns `true` for permissions on non-macOS platforms (no special permissions needed)

### 4. Build Configuration
- Added Linux build targets to `package.json`
- Supports AppImage and .deb packages for x64 and arm64

## Required Dependencies

### Missing Electron Libraries
The following libraries need to be installed on WSL:

```bash
sudo apt-get update
sudo apt-get install -y \
  libnss3 \
  libnspr4 \
  libnssutil3 \
  libsmime3 \
  libasound2
```

### X11 Display Server
WSL needs an X server to run GUI applications. Options:

1. **WSLg (Recommended for Windows 11)**
   - Built into Windows 11
   - Automatically configured
   - Check with: `echo $DISPLAY`

2. **VcXsrv (Windows 10)**
   - Download from: https://sourceforge.net/projects/vcxsrv/
   - Run XLaunch with "Disable access control" checked
   - Set DISPLAY: `export DISPLAY=:0`

3. **X410 (Windows Store - Paid)**
   - Available in Microsoft Store
   - Automatic configuration

### Setting DISPLAY Variable
Add to `~/.bashrc` or `~/.zshrc`:

```bash
# For VcXsrv or X410
export DISPLAY=:0

# Or for WSLg (automatic on Windows 11)
# DISPLAY is set automatically
```

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
# Build TypeScript
npm run build

# Run built app
npm run electron
```

### Create Linux Package
```bash
# AppImage and .deb packages
npm run dist:linux
```

## Build Status

✅ Dependencies installed
✅ Native modules rebuilt for Linux
✅ TypeScript compiled successfully
✅ Code quality checks passed (typecheck + lint)
⚠️  Missing system libraries (see above)

## Next Steps

1. Install missing libraries with the command above
2. Set up X server (if not using WSLg)
3. Run `npm run dev` to start the app

## Platform-Specific Notes

### macOS
- All original functionality preserved
- Dock icons, permissions, and system tray work as before

### Linux/WSL
- System tray works in desktop environments (GNOME, KDE, etc.)
- No special permissions needed (unlike macOS sandboxing)
- Better-sqlite3 automatically rebuilt for Linux architecture

### Windows (native)
- Not yet tested, but code includes Windows checks
- Would need separate testing and possibly more adjustments

## Troubleshooting

### "cannot open shared object file"
Install missing libraries with apt-get command above.

### "cannot open display"
Ensure X server is running and DISPLAY is set correctly.

### "Error: ENOENT: no such file or directory"
Check that workspace directory exists:
```bash
mkdir -p ~/Documents/Pocket-agent
```

### Better-sqlite3 errors
Rebuild native modules:
```bash
npm run rebuild:native
```
