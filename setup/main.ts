import { spawnSync } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { errorMessage } from '../shared/json.js';
import { renderBinary } from '../harness/graph/local-agent.js';
import { hyperframesBin, packageRoot } from '../harness/runtime/paths.js';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

interface Command { command: string; args: string[] }

function available(command: string, args: string[] = ['--version']): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 8_000, windowsHide: true, shell: command.endsWith('.cmd') });
  return result.status === 0;
}

function run({ command, args }: Command): void {
  console.log(`\nRunning: ${[command, ...args].join(' ')}`);
  // `.cmd` shims need a shell on Windows; every argument here is a fixed string, never user input.
  const result = spawnSync(command, args, { cwd: packageRoot(), stdio: 'inherit', windowsHide: true, shell: command.endsWith('.cmd') });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.error?.message}.`);
}

function systemInstall(packages: string[]): Command | null {
  if (process.platform === 'linux' && available('apt-get', ['--version'])) {
    const prefix = process.getuid?.() === 0 ? [] : ['sudo'];
    return prefix.length ? { command: 'sudo', args: ['apt-get', 'install', '-y', ...packages] } : { command: 'apt-get', args: ['install', '-y', ...packages] };
  }
  if (process.platform === 'darwin' && available('brew', ['--version'])) return { command: 'brew', args: ['install', ...packages] };
  return null;
}

/** Runs the machine-level part of setup: system tools, a provider CLI, and the HyperFrames browser. */
export async function runSetup(argv: string[]): Promise<number> {
  const checkOnly = argv.includes('--check');
  let terminal: Interface | undefined;

  /** Shows what would run and executes it only on an explicit yes. Never installs in check mode. */
  async function approve(description: string, install: Command): Promise<boolean> {
    if (checkOnly) return false;
    if (!stdin.isTTY) throw new Error('Run npm run setup in an interactive terminal to approve installations.');
    terminal ||= createInterface({ input: stdin, output: stdout });
    const answer = (await terminal.question(`${description}\n  ${[install.command, ...install.args].join(' ')}\nInstall now? [y/N] `)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') return false;
    terminal.close();
    terminal = undefined;
    run(install);
    return true;
  }

  try {
    console.log(`YouIAgent setup · Node ${process.versions.node}${checkOnly ? ' · check only' : ''}`);
    const missing: string[] = [];
    const git = available('git');
    const ffmpegPath = renderBinary('ffmpeg', process.env['FFMPEG_BIN']);
    const ffprobePath = renderBinary('ffprobe', process.env['FFPROBE_BIN']);
    const ffmpeg = available(ffmpegPath, ['-version']) && available(ffprobePath, ['-version']);
    console.log(`Git: ${git ? 'ready' : 'missing'}`);
    console.log(`FFmpeg and FFprobe: ${ffmpeg ? `ready (${ffmpegPath}, ${ffprobePath})` : 'missing'}`);
    if (!git || !ffmpeg) {
      if (process.platform === 'win32' && available('winget', ['--version'])) {
        for (const [needed, id] of [[!git, 'Git.Git'], [!ffmpeg, 'Gyan.FFmpeg']] as const) {
          if (needed && !await approve(`Install ${id} with WinGet?`, { command: 'winget', args: ['install', '--id', id, '--exact'] })) missing.push(id);
        }
      } else {
        const packages = [...(!git ? ['git'] : []), ...(!ffmpeg ? ['ffmpeg'] : [])];
        const install = systemInstall(packages);
        if (!install || !await approve(`Install ${packages.join(' and ')} with the system package manager?`, install)) missing.push(...packages);
      }
    }
    const codex = available('codex');
    const claude = available('claude');
    console.log(`Generation CLI: ${[codex && 'Codex', claude && 'Claude Code'].filter(Boolean).join(' and ') || 'missing'}`);
    if (!codex && !claude) {
      if (checkOnly) missing.push('Codex or Claude Code CLI');
      else {
        if (!stdin.isTTY) throw new Error('Run npm run setup in an interactive terminal to choose a generation provider.');
        terminal ||= createInterface({ input: stdin, output: stdout });
        const choice = (await terminal.question('Install a generation CLI: [1] Codex, [2] Claude Code, [Enter] skip: ')).trim();
        const provider = choice === '1' ? '@openai/codex@latest' : choice === '2' ? '@anthropic-ai/claude-code@latest' : null;
        if (!provider || !await approve(`Install ${provider} globally for your user account?`, { command: npm, args: ['install', '-g', provider] })) missing.push('Codex or Claude Code CLI');
      }
    }
    if (checkOnly) {
      console.log(missing.length ? `Missing: ${missing.join(', ')}` : 'System tools and a provider CLI are ready.');
      return missing.length ? 1 : 0;
    }
    if (!await approve('Download the browser runtime used to check and render films?', { command: process.execPath, args: [hyperframesBin(), 'browser', 'ensure'] })) missing.push('HyperFrames browser runtime');
    if (!available('git')) missing.push('Git is not available in this terminal');
    if (!available(renderBinary('ffmpeg', process.env['FFMPEG_BIN']), ['-version']) || !available(renderBinary('ffprobe', process.env['FFPROBE_BIN']), ['-version'])) missing.push('FFmpeg and FFprobe are not available in this terminal');
    if (!available('codex') && !available('claude')) missing.push('Codex or Claude Code CLI is not available in this terminal');
    terminal?.close();
    if (missing.length) {
      console.error(`Setup is incomplete: ${[...new Set(missing)].join(', ')}. Reopen your terminal if a package manager just changed PATH, then rerun npm run setup:check.`);
      return 1;
    }
    console.log('Setup complete. Run npm start, open http://127.0.0.1:4174, then connect your Codex or Claude Code account in the browser.');
    return 0;
  } catch (error) {
    terminal?.close();
    console.error(`Setup failed: ${errorMessage(error)}`);
    return 1;
  }
}
