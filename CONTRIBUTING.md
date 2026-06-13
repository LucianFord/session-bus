# Contributing to session-bus

Thank you for your interest in contributing! Here's how to get started.

## Development setup

```bash
git clone https://github.com/LucianFord/session-bus.git
cd session-bus
npm install
npm run build
npm test
```

All 46 tests must pass before submitting a PR.

## Workflow

1. **Fork** the repository and create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. **Make your changes.** Keep commits focused and atomic.
3. **Add or update tests** for any new behaviour. The test suite lives in `tests/` and uses [Vitest](https://vitest.dev/).
4. **Run the full suite** to confirm nothing is broken:
   ```bash
   npm run build && npm test
   ```
5. **Open a pull request** against `main` with a clear description of the change and the motivation.

## Code style

- TypeScript strict mode is enabled. All new code must type-check without errors (`npm run build`).
- Keep public API surface small. Prefer adding internals to `src/` over exporting from the entry point.
- Comment only where the *why* is non-obvious. Avoid restating what the code already says.

## Commit messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add maxContentLength config option
fix: avoid double-enqueue on agent_end for Discord sessions
docs: expand architecture section in README
```

## Reporting bugs

Open a [GitHub issue](https://github.com/LucianFord/session-bus/issues) with:

- OpenClaw version
- Plugin version
- A minimal reproduction (config + steps)
- Observed vs. expected behaviour
- Relevant log output (set `LOG_LEVEL=debug` in OpenClaw)

## Feature requests

Open an issue tagged `enhancement` and describe the use case before implementing. For significant design changes, discuss first so effort is not wasted on an approach that won't be merged.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
