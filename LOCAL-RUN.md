# Run the app on your computer

Install **Node.js 24 or later** from <https://nodejs.org>. Download the project ZIP from this branch and extract it before starting. An Internet connection is needed for the first dependency installation.

## Windows

Double-click **start-windows.cmd** in the extracted folder. It creates private local settings, installs the pinned application dependencies and starts the app. Keep the command window open.

## macOS or Linux

Open a terminal in the extracted folder and run:

```sh
bash start-local.sh
```

## Sign in

Open **http://127.0.0.1:8080** in your browser. The username is **admin**. Open the local **.env** file in a text editor and use the value after `ADMIN_PASSWORD=` as the password. The launcher generates a unique password on first use; it never prints it to the terminal or includes it in Git.

The launcher preserves existing settings and records. Changing `ADMIN_PASSWORD` after an account has been created does not reset that account's password. Store `.env` privately and back it up along with your database. If another app uses port 8080, change `PORT` in `.env` before starting.

Press **Ctrl+C** in the command window to stop the app. Run the same launcher to start it again. Settings are in `.env`, and normal plant records are in `data/trolley.sqlite`.

## Try the 128-trolley sample plant

From a terminal in the extracted folder:

```bat
start-windows.cmd --demo
```

On macOS or Linux:

```sh
bash start-local.sh --demo
```

Open **http://127.0.0.1:8081**. Sign in with **admin** and the same configured password. The sample plant uses `data/demo.sqlite`, keeping normal plant records separate. Sample roles and reset instructions are in [docs/DEMO_DATA.md](docs/DEMO_DATA.md).

## Other launch options

Run `node scripts/start-local.mjs --setup-only` to prepare dependencies and settings without starting the server. `npm run local` and `npm run local:demo` provide the same launchers from a terminal. Dependencies are refreshed automatically when the lockfile or Node major version changes, or a required package is missing.

Windows launcher execution requires Windows and was not tested in the Linux cloud environment. The shared Node launcher and Bash launcher are validated on Linux.
