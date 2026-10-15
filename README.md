# compact-ui

A Claude Code mod that gives the transcript an opencode-style compact look.

- Tool calls between two replies fold into one line: `+ 3 commands, 2 edits, 1 thought`.
- Click the line to list each call and thought; click a call to see Claude Code's full row, and `▾` to fold it again. Clicking a thought shows its text; clicking the text folds it.
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
