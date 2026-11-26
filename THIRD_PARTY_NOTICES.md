# Third-Party Notices

game-agent includes source code adapted from the projects listed below. Each adapted file names its origin in its file header.

## DeepSeek Harness

- Source: <https://github.com/deepseek-ai/deepseek-harness> (commit `4b399c39`)
- Adapted files:
  - `packages/util/errors/src/index.ts` from `packages/util/error/src/index.ts`
  - `packages/util/deque/src/index.ts` from `packages/util/deque/src/index.ts`
  - `packages/util/atomic-write/src/index.ts` from `packages/util/atomic-write/src/index.ts`
- The DeepSeek Harness bundle in `packages/bundle/dsh` follows the plugin, preset, and tool registration conventions documented by DeepSeek Harness.

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime dependencies

Installed from npm and not copied into this repository; their licenses ship with the packages.

| Package | License | Used by |
|---|---|---|
| `@deepseek-ai/cordis` | MIT | `packages/boot/app`, `packages/bundle/dsh`, `apps/cli` |
| `@modelcontextprotocol/client` | Apache-2.0 | `packages/transport/transport-mcp` |
