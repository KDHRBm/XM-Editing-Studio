// Produce a reviewable patch; never overwrite a running installation here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as asar from '@electron/asar';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [installDirectory, outputDirectory] = process.argv.slice(2).map(value => path.resolve(value));
if (!installDirectory || !outputDirectory || installDirectory === outputDirectory) throw new Error('Usage: node scripts/prepare-fork-coexistence.mjs FORK_INSTALL STAGING_OUTPUT');
const input = path.join(installDirectory, 'resources/app.asar');
const metadata = JSON.parse(asar.extractFile(input, 'package.json').toString());
if (metadata.name !== 'xm-editing-studio-kirota-fork') throw new Error('Only the isolated fork installation is supported.');
await fs.mkdir(outputDirectory, { recursive: true });
await fs.mkdir(path.join(root, '.generated'), { recursive: true });
const stage = await fs.mkdtemp(path.join(root, '.generated', 'fork-coexist-'));
try {
  asar.extractAll(input, stage);
  const mainFile = path.join(stage, 'electron/main.mjs');
  let main = await fs.readFile(mainFile, 'utf8');
  if (!main.includes("app.setName('XM剪辑台 Fork')") || !main.includes('sideBySide: true')) throw new Error('Fork profile/updater isolation is missing; refusing to replace it.');
  if (!main.includes('startLocalService')) {
    main = main.replace('import { app,', 'import { session, net, app,')
      .replace('import { createDesktopServer }', 'import { startLocalService } from "./local-service.mjs";\nimport { createDesktopServer }')
      .replace('localServer = await createDesktopServer({', 'localServer = await startLocalService({ createServer: createDesktopServer, protocol: session.defaultSession.protocol, externalFetch: request => net.fetch(request, { bypassCustomProtocolHandlers: true }), log: logStartup, options: {')
      .replace('      musicLibrary,\n    });', '      musicLibrary,\n    } });');
    if (!main.includes('externalFetch: request => net.fetch')) throw new Error('Unsupported fork bootstrap; inspect it before patching.');
  }
  main = main.replace('    if (mainWindow.isMinimized()) mainWindow.restore();\n    mainWindow.focus();', '    if (mainWindow.isMinimized()) mainWindow.restore();\n    mainWindow.show();\n    mainWindow.focus();')
    .replace('    if (mainWindow) {\n      mainWindow.focus();', '    if (mainWindow) {\n      if (mainWindow.isMinimized()) mainWindow.restore();\n      mainWindow.show();\n      mainWindow.focus();');
  await fs.writeFile(mainFile, main);
  const helperFile = path.join(stage, 'electron/period-keeper.mjs');
  let helper = await fs.readFile(helperFile, 'utf8');
  if (!helper.includes("processHandle.stdin.on('error'")) helper = helper.replace('      child = processHandle;', "      child = processHandle;\n      processHandle.stdin.on('error', () => failPending('标点组件连接已断开，请稍后重试。'));");
  await fs.writeFile(helperFile, helper);
  await fs.copyFile(path.join(root, 'app/electron/local-service.mjs'), path.join(stage, 'electron/local-service.mjs'));
  await asar.createPackage(stage, path.join(outputDirectory, 'app.asar'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/refresh-asar-integrity.mjs'), path.join(installDirectory, 'XM剪辑台-Fork.exe'), path.join(outputDirectory, 'app.asar'), path.join(outputDirectory, 'XM剪辑台-Fork.exe')], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Unable to refresh fork executable integrity.');
  console.log(outputDirectory);
} finally {
  if (path.dirname(stage) !== path.join(root, '.generated') || !path.basename(stage).startsWith('fork-coexist-')) throw new Error('Invalid temporary folder');
  await fs.rm(stage, { recursive: true, force: true });
}
