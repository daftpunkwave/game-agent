/** Successful subprocess fixture for the Loader-smoke runtime. */

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => { input += chunk })
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    configPath: process.argv[2],
    args: process.argv.slice(2),
    execArgv: process.execArgv,
    cwd: process.cwd(),
    gameAgentHome: process.env.GAME_AGENT_HOME,
    agentsHome: process.env.GAME_AGENT_AGENTS_HOME,
    marker: process.env.LOADER_SMOKE_MARKER,
    input,
  }))
  console.error('fixture stderr')
})
