const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Creates a properly formatted DMG with background and Applications symlink
 * Works around electron-builder arm64 DMG bug
 */
function createDmg(appPath, outputPath, options = {}) {
  const {
    volumeName = 'Pocket Agent',
    background = null,
    iconSize = 80,
    windowWidth = 540,
    windowHeight = 380,
    appX = 130,
    appY = 190,
    applicationsX = 410,
    applicationsY = 190,
  } = options;

  const tempDir = `/tmp/dmg-staging-${Date.now()}`;
  const tempDmg = `/tmp/dmg-temp-${Date.now()}.dmg`;

  try {
    // Create staging directory
    fs.mkdirSync(tempDir, { recursive: true });

    // Copy app
    console.log(`[createDmg] Copying app to staging...`);
    execSync(`cp -R "${appPath}" "${tempDir}/"`, { stdio: 'inherit' });

    // Create Applications symlink
    execSync(`ln -s /Applications "${tempDir}/Applications"`, { stdio: 'inherit' });

    // Copy background if provided
    if (background && fs.existsSync(background)) {
      fs.mkdirSync(`${tempDir}/.background`, { recursive: true });
      execSync(`cp "${background}" "${tempDir}/.background/background.png"`, { stdio: 'inherit' });
    }

    // Create writable DMG
    console.log(`[createDmg] Creating temporary DMG...`);
    const sizeOutput = execSync(`du -sm "${tempDir}" | cut -f1`).toString().trim();
    const sizeMb = parseInt(sizeOutput) + 50; // Add 50MB buffer

    execSync(`hdiutil create -srcfolder "${tempDir}" -volname "${volumeName}" -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format UDRW -size ${sizeMb}m "${tempDmg}"`, { stdio: 'inherit' });

    // Mount the DMG
    console.log(`[createDmg] Mounting DMG for customization...`);
    const mountOutput = execSync(`hdiutil attach "${tempDmg}" -readwrite -noverify -noautoopen`).toString();
    const mountPoint = mountOutput.match(/\/Volumes\/.+$/m)?.[0]?.trim();

    if (!mountPoint) {
      throw new Error('Failed to mount DMG');
    }

    console.log(`[createDmg] Mounted at: ${mountPoint}`);

    // Apply Finder settings using AppleScript
    const appName = path.basename(appPath);
    const appleScript = `
tell application "Finder"
  tell disk "${volumeName}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {100, 100, ${100 + windowWidth}, ${100 + windowHeight}}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to ${iconSize}
    ${background ? `set background picture of viewOptions to file ".background:background.png"` : ''}
    set position of item "${appName}" of container window to {${appX}, ${appY}}
    set position of item "Applications" of container window to {${applicationsX}, ${applicationsY}}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
`;

    try {
      execSync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`, { stdio: 'inherit', timeout: 30000 });
    } catch (e) {
      console.log('[createDmg] AppleScript customization failed, continuing with basic layout');
    }

    // Hide .background folder and remove .fseventsd
    console.log(`[createDmg] Hiding system folders...`);
    try {
      // Set hidden flag on .background
      execSync(`SetFile -a V "${mountPoint}/.background"`, { stdio: 'pipe' });
    } catch (e) {
      // SetFile might not be available, try chflags
      try {
        execSync(`chflags hidden "${mountPoint}/.background"`, { stdio: 'pipe' });
      } catch (e2) {
        console.log('[createDmg] Could not hide .background folder');
      }
    }

    // Remove .fseventsd if it exists
    const fseventsd = path.join(mountPoint, '.fseventsd');
    if (fs.existsSync(fseventsd)) {
      fs.rmSync(fseventsd, { recursive: true, force: true });
    }

    // Remove .Trashes if it exists
    const trashes = path.join(mountPoint, '.Trashes');
    if (fs.existsSync(trashes)) {
      fs.rmSync(trashes, { recursive: true, force: true });
    }

    // Unmount
    console.log(`[createDmg] Unmounting...`);
    execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: 'inherit' });

    // Convert to compressed read-only DMG
    console.log(`[createDmg] Converting to compressed DMG...`);
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    execSync(`hdiutil convert "${tempDmg}" -format UDZO -imagekey zlib-level=9 -o "${outputPath}"`, { stdio: 'inherit' });

    console.log(`[createDmg] Created: ${outputPath}`);

  } finally {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempDmg)) {
      fs.unlinkSync(tempDmg);
    }
  }
}

// Export for use as module
module.exports = { createDmg };

// Allow running directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node createDmg.js <appPath> <outputPath> [backgroundPath]');
    process.exit(1);
  }

  createDmg(args[0], args[1], {
    background: args[2] || null,
  });
}
