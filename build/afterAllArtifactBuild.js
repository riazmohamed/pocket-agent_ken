const fs = require('fs');
const path = require('path');
const { createDmg } = require('./createDmg');

/**
 * electron-builder afterAllArtifactBuild hook
 * Fixes broken arm64 DMG by recreating it properly
 */
exports.default = async function(context) {
  const { outDir, artifactPaths } = context;

  for (const artifactPath of artifactPaths) {
    // Only process arm64 DMG files
    if (!artifactPath.endsWith('.dmg') || !artifactPath.includes('arm64')) {
      continue;
    }

    console.log(`[afterAllArtifactBuild] Checking DMG: ${path.basename(artifactPath)}`);

    // Check if DMG is suspiciously small (< 10MB means it's broken)
    const stats = fs.statSync(artifactPath);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB < 10) {
      console.log(`[afterAllArtifactBuild] DMG is only ${sizeMB.toFixed(2)}MB - rebuilding...`);

      // Find the corresponding .app
      const appDir = path.join(outDir, 'mac-arm64');
      const appPath = path.join(appDir, 'Pocket Agent.app');

      if (!fs.existsSync(appPath)) {
        console.error(`[afterAllArtifactBuild] App not found at: ${appPath}`);
        continue;
      }

      // Get background image path
      const backgroundPath = path.join(__dirname, 'background.png');
      const hasBackground = fs.existsSync(backgroundPath);

      // Recreate the DMG
      try {
        createDmg(appPath, artifactPath, {
          volumeName: 'Pocket Agent',
          background: hasBackground ? backgroundPath : null,
          iconSize: 80,
          windowWidth: 540,
          windowHeight: 380,
          appX: 130,
          appY: 190,
          applicationsX: 410,
          applicationsY: 190,
        });

        const newStats = fs.statSync(artifactPath);
        const newSizeMB = newStats.size / (1024 * 1024);
        console.log(`[afterAllArtifactBuild] Rebuilt DMG: ${newSizeMB.toFixed(2)}MB`);
      } catch (error) {
        console.error(`[afterAllArtifactBuild] Failed to rebuild DMG:`, error.message);
      }
    } else {
      console.log(`[afterAllArtifactBuild] DMG size OK: ${sizeMB.toFixed(2)}MB`);
    }
  }

  return artifactPaths;
};
