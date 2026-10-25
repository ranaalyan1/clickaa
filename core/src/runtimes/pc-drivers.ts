/**
 * PC host native drivers — platform implementations behind the runtime contract.
 *
 * Windows (first-class, per HeyClicky lessons): PowerShell + .NET, no
 * compiled dependencies. Linux: standard tools (xdotool/wmctrl/scrot),
 * graceful errors when absent. A FakeDriver powers tests and dry runs.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface WindowInfo {
  windowId: string;
  title: string;
  app: string;
}

export interface NativeDriver {
  readonly platform: 'windows' | 'linux' | 'macos' | 'fake';
  /** Cheap probe: does this driver actually work on the current machine? */
  available(): Promise<boolean>;
  listWindows(): Promise<WindowInfo[]>;
  screenshot(windowId?: string): Promise<string>; // PNG base64
  click(target: { windowId?: string; x?: number; y?: number }): Promise<void>;
  typeText(windowId: string, text: string): Promise<void>;
  pressKey(windowId: string, keys: string): Promise<void>;
  launchApp(appId: string): Promise<void>;
  readFile(path: string, maxBytes: number): Promise<string>;
}

/* ------------------------------------------------------------------ */
/* Windows — PowerShell driver                                         */
/* ------------------------------------------------------------------ */

const PS_SNIPPETS: Record<string, string> = {
  screenshot: `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
$g.Dispose(); $bmp.Dispose()`,
  listWindows: `
Add-Type -AssemblyName System.Windows.Forms
Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object {
  "{0}|{1}|{2}" -f $_.Id, $_.MainWindowTitle, $_.ProcessName
}`,
  click: `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Click {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
[Click]::SetCursorPos(__X__, __Y__)
[Click]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Click]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)`,
  typeText: `
Add-Type -AssemblyName System.Windows.Forms
$wshell = New-Object -ComObject wscript.shell
$null = $wshell.AppActivate(__WIN__)
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait(__TEXT__)`,
  pressKey: `
Add-Type -AssemblyName System.Windows.Forms
$wshell = New-Object -ComObject wscript.shell
$null = $wshell.AppActivate(__WIN__)
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait(__TEXT__)`,
  launchApp: 'Start-Process __APP__',
};

export class WindowsPowerShellDriver implements NativeDriver {
  readonly platform = 'windows' as const;

  async available(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
      await exec('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async listWindows(): Promise<WindowInfo[]> {
    const { stdout } = await this.pwsh(PS_SNIPPETS.listWindows);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [id, title, app] = l.split('|');
        return { windowId: id, title: title ?? '', app: app ?? '' };
      });
  }

  async screenshot(): Promise<string> {
    const { stdout } = await this.pwsh(PS_SNIPPETS.screenshot);
    return stdout.trim();
  }

  async click(target: { x?: number; y?: number }): Promise<void> {
    if (target.x === undefined || target.y === undefined) {
      throw new Error('coordinate clicks only on Windows driver for now');
    }
    await this.pwsh(PS_SNIPPETS.click.replace('__X__', String(Math.trunc(target.x))).replace('__Y__', String(Math.trunc(target.y))));
  }

  async typeText(windowId: string, text: string): Promise<void> {
    await this.pwsh(
      PS_SNIPPETS.typeText.replace('__WIN__', jsStringToPs(windowId)).replace('__TEXT__', jsStringToPs(sendKeysEscape(text))),
    );
  }

  async pressKey(windowId: string, keys: string): Promise<void> {
    // "ctrl+s" -> "^s" in SendKeys notation.
    const mapped = keys
      .split('+')
      .map((k) => k.trim().toLowerCase())
      .map((k) => SENDKEYS_KEYS[k] ?? k)
      .join('');
    await this.pwsh(PS_SNIPPETS.pressKey.replace('__WIN__', jsStringToPs(windowId)).replace('__TEXT__', jsStringToPs(mapped)));
  }

  async launchApp(appId: string): Promise<void> {
    await this.pwsh(PS_SNIPPETS.launchApp.replace('__APP__', jsStringToPs(appId)));
  }

  async readFile(path: string, maxBytes: number): Promise<string> {
    const { stdout } = await this.pwsh(
      `$bytes = [System.IO.File]::ReadAllBytes(${jsStringToPs(path)}); ` +
        `if ($bytes.Length -gt ${Math.trunc(maxBytes)}) { $bytes = $bytes[0..${Math.trunc(maxBytes)}-1] }; ` +
        `[System.Text.Encoding]::UTF8.GetString($bytes)`,
    );
    return stdout;
  }

  private async pwsh(script: string): Promise<{ stdout: string }> {
    return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 20_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  }
}

const SENDKEYS_KEYS: Record<string, string> = {
  ctrl: '^',
  shift: '+',
  alt: '%',
  win: '',
  enter: '{ENTER}',
  tab: '{TAB}',
  esc: '{ESC}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  del: '{DEL}',
  backspace: '{BS}',
  home: '{HOME}',
  end: '{END}',
  pgup: '{PGUP}',
  pgdn: '{PGDN}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
  f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
  f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
};

/** Escape a JS string into a PS single-quoted literal. */
function jsStringToPs(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** SendKeys treats +^%~(){} specially. */
function sendKeysEscape(text: string): string {
  return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`);
}

/* ------------------------------------------------------------------ */
/* Linux — standard X11 tools                                          */
/* ------------------------------------------------------------------ */

export class LinuxX11Driver implements NativeDriver {
  readonly platform = 'linux' as const;

  async available(): Promise<boolean> {
    if (process.platform !== 'linux') return false;
    try {
      await exec('which', ['xdotool']);
      return true;
    } catch {
      return false;
    }
  }

  async listWindows(): Promise<WindowInfo[]> {
    try {
      const { stdout } = await exec('wmctrl', ['-l'], { timeout: 5000 });
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const parts = l.split(/\s+/);
          return { windowId: parts[0], app: parts[parts.length - 1] ?? '', title: parts.slice(3, -1).join(' ') };
        });
    } catch {
      throw new Error('wmctrl not available; install wmctrl');
    }
  }

  async screenshot(): Promise<string> {
    const { stdout } = await exec('import', ['-window', 'root', 'png:-'], {
      timeout: 10_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'binary',
    });
    return Buffer.from(stdout, 'binary').toString('base64');
  }

  async click(target: { x?: number; y?: number }): Promise<void> {
    if (target.x !== undefined && target.y !== undefined) {
      await exec('xdotool', ['mousemove', String(target.x), String(target.y), 'click', '1']);
    } else {
      await exec('xdotool', ['click', '1']);
    }
  }

  async typeText(_windowId: string, text: string): Promise<void> {
    await exec('xdotool', ['type', '--delay', '20', text]);
  }

  async pressKey(_windowId: string, keys: string): Promise<void> {
    await exec('xdotool', ['key', keys.replace(/\+/g, '+')]);
  }

  async launchApp(appId: string): Promise<void> {
    await exec(appId, [], { timeout: 5000 }).catch(() => {
      throw new Error(`cannot launch ${appId}`);
    });
  }

  async readFile(path: string, maxBytes: number): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(path);
    return buf.subarray(0, maxBytes).toString('utf8');
  }
}

/* ------------------------------------------------------------------ */
/* Fake driver — tests, dry runs, demos                                 */
/* ------------------------------------------------------------------ */

export class FakeDriver implements NativeDriver {
  readonly platform = 'fake' as const;
  public calls: { op: string; args: unknown }[] = [];

  async available(): Promise<boolean> {
    return true;
  }
  async listWindows(): Promise<WindowInfo[]> {
    this.calls.push({ op: 'listWindows', args: {} });
    return [{ windowId: 'w1', title: 'Demo Window', app: 'demo' }];
  }
  async screenshot(): Promise<string> {
    this.calls.push({ op: 'screenshot', args: {} });
    return Buffer.from('fake-png').toString('base64');
  }
  async click(target: { x?: number; y?: number }): Promise<void> {
    this.calls.push({ op: 'click', args: target });
  }
  async typeText(windowId: string, text: string): Promise<void> {
    this.calls.push({ op: 'typeText', args: { windowId, text } });
  }
  async pressKey(windowId: string, keys: string): Promise<void> {
    this.calls.push({ op: 'pressKey', args: { windowId, keys } });
  }
  async launchApp(appId: string): Promise<void> {
    this.calls.push({ op: 'launchApp', args: { appId } });
  }
  async readFile(path: string): Promise<string> {
    this.calls.push({ op: 'readFile', args: { path } });
    return `contents of ${path}`;
  }
}

/** Pick the best driver for the current machine, or undefined. */
export async function detectDriver(): Promise<NativeDriver | undefined> {
  const candidates: NativeDriver[] = [new WindowsPowerShellDriver(), new LinuxX11Driver()];
  for (const driver of candidates) {
    if (await driver.available()) return driver;
  }
  return undefined;
}
