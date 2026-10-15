# compact-ui

A Claude Code mod that gives the transcript an opencode-style compact look.

![compact-ui in a Claude Code session](docs/screenshot.png)

- Tool calls between two replies fold into one line: `+ 3 commands, 2 edits, 1 thought +78 -7`.
- Lines changed show as `+N -M`, on the folded line and on each call. Edits count from their patch; in a git repo, so do Bash commands, from the work tree before and after.
- Click the line to list each call and thought; click a call to open Claude Code's own row for it, and click the call's line again to fold it. A thought shows a few words; clicked, its full text.
- `/fold` expands or folds every run at once.
- Your prompts get a purple left bar.
- The turn line gains model, effort, tok/s and cost: `✻ Baked for 16s · done 9:21 AM · Opus 5.5 high · 19.5 tok/s · $0.42`.

Clicking needs Claude Code's fullscreen mode.

## Install

At the prompt of a terminal session:

```
/plugin install compact-ui --marketplace wKich/compact-ui
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install compact-ui --marketplace wKich/compact-ui
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `wKich/compact-ui`, then Add plugin.
