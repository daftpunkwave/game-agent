# Third-Party Notices

Portions of game-agent are derived from software distributed under the MIT License. The copyright notices and the license text are reproduced below, as that license requires.

```text
MIT License

Copyright (c) 2026 DeepSeek
Copyright (c) 2021-present Shigma

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
| `@babel/code-frame` | MIT | `packages/boot/hmr`, `packages/kernel/hmr` |
| `@eslint-community/regexpp` | MIT | `packages/boot/app-boot` |
| `@js-temporal/polyfill` | ISC | `packages/util/time` |
| `@modelcontextprotocol/client` | Apache-2.0 | `packages/transport/transport-mcp` |
| `@standard-schema/spec` | MIT | `packages/kernel/kernel`, `packages/kernel/schema` |
| `@vscode/ripgrep` | MIT | `packages/util/ripgrep` |
| `ajv` | MIT | `packages/boot/app-boot` |
| `chokidar` | MIT | `packages/boot/hmr`, `packages/credentials/credentials-local`, `packages/kernel/hmr` |
| `fuzzysort` | MIT | `packages/util/text-search` |
| `koffi` | MIT | `packages/subprocess/subprocess-local`, `packages/subprocess/win32-process` |
| `mime` | MIT | `packages/util/file-drag` |
| `node-addon-require-builtin` | MIT | `packages/boot/app-boot`, `packages/boot/hmr`, `packages/kernel/loader` |
| `node-pty` | MIT | `packages/subprocess/subprocess-local` |
| `picomatch` | MIT | `packages/boot/hmr`, `packages/kernel/hmr` |
| `resolve.exports` | MIT | `packages/boot/app-boot` |
| `rrule` | BSD-3-Clause | `packages/util/time` |
| `semver` | ISC | `packages/boot/app-boot` |
| `supports-color` | MIT | `packages/kernel/logger-console` |
| `undici` | MIT | `packages/util/http-proxy` |
| `yaml` | ISC | `packages/boot/config-editor`, `packages/credentials/credentials-local`, `packages/kernel/include` |
| `zod` | MIT | `packages/llm/llm`, `packages/storage/storage-domain`, `packages/typert/protocol`, `packages/typert/registry`, `packages/util/chunked-list` |
